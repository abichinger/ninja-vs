const dotenv = require('dotenv')
dotenv.config()
const {Client, MessageAttachment} = require('discord.js')
const reocgi = require('reolink-cgi')
const EventEmitter = require('events');
const cv = require("@u4/opencv4nodejs")
const { VideoCapture, resizeToSquare, unwrapYOLOv5, getOption, boxesIntersection } = require('./util')
const tmpDir = './.tmp';
const { CommandHandler, ArgType } = require('./cmd')
const crypto = require("crypto");

class ReolinkBot extends EventEmitter {

  constructor(client){
    super()
    this.client = client
    this.discord = new Client()
    this.intervals = new Map()
  }

  initDiscord() {
    this.discord.on('ready', () => {
      console.log(`Logged in as ${this.discord.user.tag}!`)
    });

    this.discord.on('message', msg => {
      this.emit('message', msg)
    });
    
    this.discord.login(process.env.RLB_DISCORD_TOKEN)
  }

  getVC(size, delay){
    if (!this.vc) {
      let rtsp = this.client.rtspMain()
      this.vc = new VideoCapture(rtsp, delay, size) //TODO: fix delay and size
    }
    return this.vc
  }

  /**
   * 
   * @param {Message} msg 
   * @param {boolean} silent 
   */
  async objects(img, drawRectangles, exclude, confidenceThreshold) {
    if(!this.net){
      this.net = await cv.readNetFromONNX(process.env.RLB_ONNX_FILE || "dnn/yolov5s.onnx")
    }

    let net = this.net
    
    let imgResized = resizeToSquare(img, 640)

    let inputBlob = cv.blobFromImage(imgResized, 1/255, new cv.Size(640, 640), new cv.Vec3(0, 0, 0), true, false);
    net.setInput(inputBlob);

    let outputBlob = net.forward();
    outputBlob = outputBlob.flattenFloat(outputBlob.sizes[1], outputBlob.sizes[2])

    let unwrapped = unwrapYOLOv5(outputBlob, Math.max(img.cols, img.rows)/640, confidenceThreshold)    
    let res = {boxes:[], confidences: [], classNames: []}
    unwrapped.classNames.forEach((name, i) => {
      if(!exclude.includes(name)){
        res.classNames.push(name)
        res.confidences.push(unwrapped.confidences[i])
        res.boxes.push(unwrapped.boxes[i])
      }
    })

    if (res.classNames.length == 0){
      return res
    }

    if(drawRectangles){
      for(let r of res.boxes){
        img.drawRectangle(r, new cv.Vec(0, 255, 0), 3, cv.LINE_8)
      }
    }

    return res
  }

  async detectObjects(...options) {
    let buffer = await this.client.snap()
    let img = await cv.imdecode(buffer)

    let { classNames, confidences } = await this.objects(img, true, ...options)

    if(classNames.length > 0) {
      return {
        msg: classNames.map((name, i) => `${name}(${confidences[i]})`).join(', '),
        attachment: cv.imencode('.jpg', img)
      }
    }
    else {
      return {
        msg: "no objects detected",
      }
    }
    
  }

  async snap(){
    let buffer = await this.client.snap()
    return {
      attachment: buffer
    }
  }

  async motion(images, drawRectangles, minArea, thresh, blur, width) {
    //inspired by https://www.pyimagesearch.com/2015/05/25/basic-motion-detection-and-tracking-with-python-and-opencv/

    if(images.length != 2){
      throw 'expected two images'
    }

    let scale = 1;
      
    let processed = images.map((img) => {
        scale = width/img.cols
        let h = parseInt(img.rows*scale)
        return img.resize(h, width)
      })
      .map(img => img.cvtColor(cv.COLOR_BGR2GRAY))
      .map(img => img.gaussianBlur(new cv.Size(blur, blur), 0))

    let kernelSize = Math.floor(width*0.007)
    let kernel = new cv.Mat(kernelSize, kernelSize, cv.CV_8UC1, 255)

    let delta = processed[0].absdiff(processed[1])
      .threshold(thresh, 255, cv.THRESH_BINARY)
      .dilate(kernel, new cv.Point(1,1), 2)


    let minPixels = minArea*delta.cols*delta.rows
    let contours = delta.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    contours = contours.filter(c => c.area > minPixels)

    if(contours.length <= 0){
      return []
    }

    let boxes = contours.map((c) => {
      let r = c.boundingRect()
      return r.rescale(1/scale)
    })


    if(drawRectangles){
      let img = images[1]
      for(let r of boxes) {
        img.drawRectangle(r, new cv.Vec(255, 0, 0), 3, cv.LINE_8)
      }
    }

    return boxes
  }

  async motionDetect(capWidth, capHeight, capDelay, ...options){
    let images = []
    let size = [capWidth, capHeight]
    try {
      await this.getVC(size, capDelay).capture(2, (frame) => {
        images.push(new cv.Mat(Buffer.from(frame), size[1], size[0], cv.CV_8UC3).cvtColor(cv.COLOR_BGR2RGB))
      })
    } catch(err) {
      console.log(err)
      return
    }

    let boxes = await this.motion(images, true, ...options)

    if (boxes.length > 0) {
      return {
        msg: "motion detected",
        attachment: cv.imencode('.jpg', images[1])
      }
    }
    else {
      return {
        msg: "no motion detected",
      }
    }
  }

  async smart(images, drawRectangles, intersect, ...options){
    
    let motionArgs = options.splice(0, this.motion.length-2)
    let objectArgs = options

    let empty = {
      classNames: [],
      confidences: [],
      boxes: [],
      motionBoxes: []
    }

    let motionBoxes = await this.motion(images, false, ...motionArgs)
    if(motionBoxes.length == 0){
      return empty
    }

    let {classNames, confidences, boxes} = await this.objects(images[1], drawRectangles, ...objectArgs)

    if(intersect && !boxesIntersection(motionBoxes, boxes)) {
      return empty
    }

    //draw motion boxes
    if(drawRectangles){
      for(let r of motionBoxes) {
        images[1].drawRectangle(r, new cv.Vec(255, 0, 0), 3, cv.LINE_8)
      }
    }

    return {classNames, confidences, boxes, motionBoxes}
  }


  async smartDetect(intersect, capWidth, capHeight, capDelay, ...options){

    let images = []
    let size = [capWidth, capHeight]   
    let delay = capDelay
    try {
      await this.getVC(size, delay).capture(2, (frame) => {
        images.push(new cv.Mat(Buffer.from(frame), size[1], size[0], cv.CV_8UC3).cvtColor(cv.COLOR_BGR2RGB))
      })
    } catch(err) {
      console.log(err)
      return
    }

    let {classNames, confidences} = await this.smart(images, true, intersect, ...options)

    if (classNames.length == 0){
      return
    }

    return {
      msg: classNames.map((name, i) => `${name}(${confidences[i]})`).join(', '),
      attachment: cv.imencode('.jpg', images[1])
    }
  }

  async setInterval(cmd, channel, interval, cooldown=0, filter=false){
    
    ((cmd, channel, interval, cooldown, filter) => {

      let start = null
      let id = crypto.randomBytes(16).toString('base64')
      let intervalObj = {cmd, channel, interval, cooldown, timeoutId: null}
      let lastAttachment = null

      let fn = () => {
        start = new Date().getTime()
        this.emit('message', msg)
      }

      let msg = {
        content: cmd,
        channel: {
          send: async (message, attachment) => {

            //save timestamp of last attachment
            if(attachment){
              lastAttachment = new Date().getTime()
            }

            //filter messages without attachment
            if(filter && !attachment){
              return
            }

            //send message
            let ch = this.discord.channels.cache.get(channel) || (await this.discord.channels.fetch(channel))
            return ch.send(message, attachment)
          }
        },
        setTimeout: () => {
          if(!this.intervals.has(id)){
            return
          }

          let end = new Date().getTime()
          let execTime = end - start
          let cd = cooldown*1000 - (end - (lastAttachment ? lastAttachment : 0))
          let timeout = interval*1000 + (cd > 0 ? cd : 0) - execTime

          if(timeout < 0){
            //console.log('can\'t keep up')
            timeout = 0
          }

          intervalObj.timeoutId = setTimeout(fn, parseInt(timeout))
        }
      }
  
      intervalObj.timeoutId = setTimeout(fn, 0)
      this.intervals.set(id, intervalObj)

    })(cmd, channel, interval, cooldown, filter)
  }

  async clearInterval(index){
    let id = Array.from(this.intervals.keys())[index]
    if(id && this.intervals.has(id)){
      let timeoutId = this.intervals.get(id).timeoutId
      if(timeoutId) {
        clearTimeout(timeoutId)
      }
      this.intervals.delete(id)
    }
  }

  async listIntervals(){
    return {
      msg: (this.intervals.size > 0) ? Array.from(this.intervals.values()).map((int, i) => `${i}: ${int.cmd}, ${int.channel}, ${int.interval}s`).join('\n') : 'no intervals'
    }
  }

  async send(msg, response, attachment) {
    if(response !== null || attachment !== null){
      await msg.channel.send(response, attachment)
    }
    if(msg.setTimeout){
      msg.setTimeout()
    }
  }

}



async function initReolinkBot(){
  let reoclient = new reocgi.Client(process.env.RLB_REOLINK_HOST)
  await reoclient.login(process.env.RLB_REOLINK_USER, process.env.RLB_REOLINK_PASSWORD)
  return new ReolinkBot(reoclient)
}

function main(){
  initReolinkBot().then((bot) => {
    
    bot.initDiscord()
    let cmd = new CommandHandler('!')


    cmd.register('snap', bot.snap.bind(bot), {
      description: 'takes a snapshot'
    })


    let objectCmd = cmd.register('objects', bot.detectObjects.bind(bot), {
      description: 'object detection'
    })
    .addArgument('exclude', ArgType.List, {default: getOption(process.env, 'RLB_OBJECT_EXCLUDE', []), description: "a list of classes to exclude (e.g.: 'airplane, traffic light')"})
    .addArgument('confidence', ArgType.Float, {default: getOption(process.env, 'RLB_OBJECT_CONFIDENCE', 0.6), description: "confidence threshold"})


    let motionCmd = cmd.register('motion', bot.motionDetect.bind(bot), {
      description: 'motion detection'
    })
    .addArgument('width', ArgType.Number, {default: getOption(process.env, 'RLB_CAPTURE_WIDTH', 2560), description: 'capture width'})
    .addArgument('height', ArgType.Number, {default: getOption(process.env, 'RLB_CAPTURE_HEIGHT', 1440), description: 'capture height'})
    .addArgument('delay', ArgType.Number, {default: getOption(process.env, 'RLB_CAPTURE_DELAY', 100), description: 'delay in ms between images'})
    .addArgument('area', ArgType.Float, {default: getOption(process.env, 'RLB_MOTION_AREA', 0.001), description: 'min size of motion in percent'})
    .addArgument('thresh', ArgType.Number, {default: getOption(process.env, 'RLB_MOTION_THRESHOLD', 20), description: 'threshold value between 0-255'})
    .addArgument('blur', ArgType.Number, {default: getOption(process.env, 'RLB_MOTION_BLUR', 11), description: 'kernel size of gaussian blur, must be odd'})
    .addArgument('pWidth', ArgType.Number, {default: getOption(process.env, 'RLB_MOTION_WIDTH', 1000), description: 'processing width'})


    cmd.register('smart', bot.smartDetect.bind(bot), {
      description: 'combined motion and object detection'
    })
    .addArgument('intersect', ArgType.Bool, {default: true, description: 'whether the boxes of motion and object detection have to overlap'})
    .appendArguments(motionCmd)
    .appendArguments(objectCmd)


    cmd.register('set-interval', bot.setInterval.bind(bot), {
      description: 'executes a command periodically'
    })
    .addArgument('cmd', ArgType.String, {required: true, description: 'command to execute'})
    .addArgument('channel', ArgType.String, {required: true, description: 'channel id'})
    .addArgument('interval', ArgType.Time, {required: true, description: 'delay between runs'})
    .addArgument('cooldown', ArgType.Time, {default: 10, description: 'time to wait after a message was sent'})
    .addArgument('filter', ArgType.Bool, {default: false, description: 'filter messages without attachments'})
    

    cmd.register('clear-interval', bot.clearInterval.bind(bot), {
      description: 'clear interval'
    })
    .addArgument('i', ArgType.Number, {default: 0})


    cmd.register('intervals', bot.listIntervals.bind(bot), {
      description: 'list intervals'
    })


    cmd.register('list', () => {
      return { msg: 'Commands: \n'+cmd.listCommands()}
    }, {
      description: 'lists all commands'
    })


    cmd.register('help', (name) => {
      return { msg: cmd.help(name) }
    }, {
      description: 'prints more information of a command'
    })
    .addArgument('name', ArgType.String, {required: true})


    bot.on('message', (msg) => {
      (function (msg){  
        cmd.execute(msg.content).then((res) => {
          let response = (res && res.msg) ? res.msg : null
          let attachment = (res && res.attachment) ? new MessageAttachment(res.attachment) : null

          return bot.send(msg, response, attachment)

        }).catch((err) => {
          console.log(err.toString(), err.stack)
          return bot.send(msg, err.toString())
        })
      })(msg)
    })
  })
}

if (require.main === module) {
  main();
}

module.exports = { 
  ReolinkBot,
  initReolinkBot,
}