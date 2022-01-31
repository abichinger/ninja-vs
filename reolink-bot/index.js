const dotenv = require('dotenv')
dotenv.config()
const {Client, MessageAttachment} = require('discord.js')
const reocgi = require('reolink-cgi')
const EventEmitter = require('events');
const cv = require("@u4/opencv4nodejs")
const { VideoCapture, resizeToSquare, unwrapYOLOv5 } = require('./util')
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
  async objects(img, exclude=[], drawRectangles=true) {
    if(!this.net){
      this.net = await cv.readNetFromONNX(process.env.RLB_ONNX_FILE || "dnn/yolov5s.onnx")
    }

    let net = this.net
    
    let imgResized = resizeToSquare(img, 640)

    let inputBlob = cv.blobFromImage(imgResized, 1/255, new cv.Size(640, 640), new cv.Vec3(0, 0, 0), true, false);
    net.setInput(inputBlob);

    let outputBlob = net.forward();
    outputBlob = outputBlob.flattenFloat(outputBlob.sizes[1], outputBlob.sizes[2])

    let {boxes, classNames, confidences} = unwrapYOLOv5(outputBlob, Math.max(img.cols, img.rows)/640)
    let predictions = classNames.map((name, i) => {
      return {
        class: name,
        box: boxes[i],
        confidence: confidences[i]
      }
    })

    predictions = predictions.filter((p) => !exclude.includes(p.class))
    if (predictions.length == 0){
      return []
    }

    if(drawRectangles){
      for(let p of predictions){
        img.drawRectangle(p.box, new cv.Vec(0, 255, 0), 3, cv.LINE_8)
      }
    }

    return predictions
  }

  async detectObjects(exclude) {
    let buffer = await this.client.snap()
    let img = await cv.imdecode(buffer)

    let predictions = await this.objects(img, exclude)

    if(predictions.length > 0) {
      return {
        msg: predictions.map((p) => `${p.class}(${p.confidence})`).join(', '),
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

  async motion(images, drawRectangles=true, minArea=0.003, thresh=20, blur=11, width=1000) {
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

    let kernel = new cv.Mat(7, 7, cv.CV_8UC1, 255)

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

  async motionDetect(minArea, thresh, delay, blur, width){
    let images = []
    let size = [1920, 1080]
    try {
      await this.getVC(size, delay).capture(2, (frame) => {
        images.push(new cv.Mat(Buffer.from(frame), size[1], size[0], cv.CV_8UC3).cvtColor(cv.COLOR_BGR2RGB))
      })
    } catch(err) {
      console.log(err)
      return
    }

    let boxes = await this.motion(images, true, minArea, thresh, blur, width)

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

  async detect(exclude){

    let images = []
    let size = [1920, 1080]   
    let delay = 100   
    try {
      await this.getVC(size, delay).capture(2, (frame) => {
        images.push(new cv.Mat(Buffer.from(frame), size[1], size[0], cv.CV_8UC3).cvtColor(cv.COLOR_BGR2RGB))
      })
    } catch(err) {
      console.log(err)
      return
    }

    let boxes = await this.motion(images)
    if(boxes.length == 0){
      return
    }

    let predictions = await this.objects(images[1], exclude)
    if(predictions.length == 0){
      return
    }

    return {
      msg: predictions.map((p) => `${p.class}(${p.confidence})`).join(', '),
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
            console.log('can\'t keep up')
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

    cmd.register('objects', bot.detectObjects.bind(bot), {
      description: 'object detection'
    })
    .addArgument('exclude', ArgType.List, {default: []})

    cmd.register('motion', bot.motionDetect.bind(bot), {
      description: 'motion detection'
    })
    .addArgument('area', ArgType.Float, {default: 0.001})
    .addArgument('thresh', ArgType.Number, {default: 20})
    .addArgument('delay', ArgType.Number, {default: 100})
    .addArgument('blur', ArgType.Number, {default: 11})
    .addArgument('width', ArgType.Number, {default: 1000})

    cmd.register('detect', bot.detect.bind(bot), {
      description: 'combined motion and object detection'
    })
    .addArgument('exclude', ArgType.List, {default: []})

    cmd.register('set-interval', bot.setInterval.bind(bot), {
      description: 'executes a command periodically'
    })
    .addArgument('cmd', ArgType.String, {required: true})
    .addArgument('channel', ArgType.String, {required: true})
    .addArgument('interval', ArgType.Time, {required: true})
    .addArgument('cooldown', ArgType.Time, {default: 10})
    .addArgument('filter', ArgType.Bool, {default: false})
    //.addArgument('cooldown', ArgType.Time, {default: 5})

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