const dotenv = require('dotenv')
dotenv.config()
const {Client, MessageAttachment} = require('discord.js')
const reocgi = require('reolink-cgi')
const tf = require('@tensorflow/tfjs-node')
const cocoSsd = require('@tensorflow-models/coco-ssd');
const EventEmitter = require('events');
const cv = require("opencv4nodejs-prebuilt")
const ffmpeg = require('fluent-ffmpeg')
const { VideoCapture } = require('./util')
const tmpDir = './.tmp';
const { CommandHandler, ArgType } = require('./cmd')

/*
Commands:

!snap
!snap [time]
!detect
!detect [time]
!detect cooldown [time]
!detect snooze [time]

*/

class ReolinkBot extends EventEmitter {

  constructor(client){
    super()
    this.client = client
    this.discord = new Client()
    this.intervals = []
  }

  initDiscord() {
    this.discord.on('ready', () => {
      console.log(`Logged in as ${this.discord.user.tag}!`)
    });

    this.discord.on('message', msg => {
      this.emit('message', msg)
    });
    
    this.discord.login(process.env.DISCORD_TOKEN)
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
    if(!this.model){
      this.model = await cocoSsd.load()
    }

    let tensor = tf.tensor(img.getData(), [img.rows, img.cols, img.channels])

    let predictions = await this.model.detect(tensor)
    predictions = predictions.filter((p) => !exclude.includes(p.class))
    if (predictions.length == 0){
      return []
    }

    if(drawRectangles){
      for(let prediction of predictions){
        let r = new cv.Rect(...prediction.bbox)
        img.drawRectangle(r, new cv.Vec(0, 255, 0), 3, cv.LINE_8)
      }
    }
    
    return predictions.map(p => p.class)
  }

  async detectObjects(exclude) {
    let buffer = await this.client.snap()
    let img = await cv.imdecode(buffer)

    let objects = await this.objects(img, exclude)

    if(objects.length > 0) {
      return {
        msg: objects,
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
    await this.client.saveSnap(tmpDir+'/snap.jpg')
    return {
      attachment: tmpDir+'/snap.jpg'
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
      return false
    }

    if(drawRectangles){
      let img = images[1]
      for(let c of contours) {
        let r = c.boundingRect()
        r = r.rescale(1/scale)
        img.drawRectangle(r, new cv.Vec(0, 255, 0), 3, cv.LINE_8)
      }
    }

    return true
  }

  async motionDetect(minArea, thresh, delay, blur, width){
    let images = []
    let size = [1920, 1080]  
    await this.getVC(size, delay).capture(2, (frame) => {
      images.push(new cv.Mat(Buffer.from(frame), size[1], size[0], cv.CV_8UC3).cvtColor(cv.COLOR_BGR2RGB))
    })

    let motion = await this.motion(images, true, minArea, thresh, delay, blur, width)

    if (motion) {
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
    await this.getVC(size, delay).capture(2, (frame) => {
      images.push(new cv.Mat(Buffer.from(frame), size[1], size[0], cv.CV_8UC3).cvtColor(cv.COLOR_BGR2RGB))
    })

    let motion = await this.motion(images, false)
    if(!motion){
      return
    }

    let objects = await this.objects(images[1], exclude)
    if(objects.length == 0){
      return
    }

    return {
      msg: objects,
      attachment: cv.imencode('.jpg', images[1])
    }
  }

  async setInterval(cmd, channel, interval, filter){
    
    let msg = {
      content: cmd,
      channel: {
        send: async (message, attachment) => {
          if(filter && !attachment){
            return
          }
          let ch = await this.discord.channels.fetch(channel)
          return ch.send(message, attachment)
        }
      }
    }

    let id = setInterval(() => {
      this.emit('message', msg)
    }, interval*1000)

    this.intervals.push({cmd, channel, interval, id})
  }

  async clearInterval(index){
    let interval = this.intervals.splice(index, 1)[0]
    if(interval){
      clearInterval(interval.id)
    }
  }

  async listIntervals(){
    return {
      msg: (this.intervals.length > 0) ? this.intervals.map((int, i) => `${i}: ${int.cmd}, ${int.channel}, ${int.interval}s`).join('\n') : 'no intervals'
    }
  }

}



async function initReolinkBot(){
  let reoclient = new reocgi.Client(process.env.REOLINK_HOST)
  await reoclient.login(process.env.REOLINK_USER, process.env.REOLINK_PASSWORD)
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
    .addArgument('filter', ArgType.Bool, {default: false})
    //.addArgument('cooldown', ArgType.Time, {default: 5})

    cmd.register('clear-interval', bot.clearInterval.bind(bot), {
      description: 'clear interval'
    })
    .addArgument('i', ArgType.Number, {default: 0})

    cmd.register('intervals', bot.listIntervals.bind(bot), {
      description: 'list intervals'
    })

    cmd.register('help', (name) => {
      return { msg: cmd.help(name) }
    })
    .addArgument('name', ArgType.String, {required: true})

    bot.on('message', (msg) => {
      (function (msg){  
        cmd.execute(msg.content).then((res) => {
          if(!res){
            return
          }

          let message = (res && res.msg) ? res.msg : null
          let attachment = (res && res.attachment) ? new MessageAttachment(res.attachment) : null

          return msg.channel.send(message, attachment)

        }).catch((err) => {
          console.log(err.toString(), err.stack)
          return msg.channel.send(err.toString())
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