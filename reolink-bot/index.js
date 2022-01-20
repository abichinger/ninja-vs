const dotenv = require('dotenv')
dotenv.config()
const {Client, MessageAttachment} = require('discord.js')
const reocgi = require('reolink-cgi')
const tf = require('@tensorflow/tfjs-node')
const cocoSsd = require('@tensorflow-models/coco-ssd');
//const execa = require("execa")
const EventEmitter = require('events');
const cv = require("opencv4nodejs-prebuilt")

const util = require('util');
const exec = util.promisify(require('child_process').exec);
//const ffmpeg = require('fluent-ffmpeg')

const tmpDir = './.tmp';

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
    this.intervals = {}
    this.detectCooldown = 0
    this.lastDetect = 0
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

  /**
   * 
   * @param {cv.Mat} img 
   * @returns 
   */
  async getImageData(img) {
    //https://github.com/justadudewhohacks/opencv4nodejs/blob/master/README.md#drawing-a-mat-into-html-canvas
    
    // convert your image to rgba color space
    const matRGBA = img.channels === 1
      ? img.cvtColor(cv.COLOR_GRAY2RGBA)
      : img.cvtColor(cv.COLOR_BGR2RGBA);

    // create new ImageData from raw mat data
    return {
      data: new Uint32Array(matRGBA.getData()),
      width: img.cols,
      height: img.rows
    }
  }

  /**
   * 
   * @param {Message} msg 
   * @param {boolean} silent 
   */
  async detect(silent=false) {
    if(!this.model){
      this.model = await cocoSsd.load()
    }

    let buffer = await this.client.snap()
    let img = await cv.imdecode(buffer)
    //let imgData = await this.getImageData(img)

    let tensor = tf.tensor(img.getData(), [img.rows, img.cols, img.channels])

    let predictions = await this.model.detect(tensor)

    if(silent && predictions.length == 0){
      return
    }

    this.lastDetect = new Date().getTime()

    for(let prediction of predictions){
      let r = new cv.Rect(...prediction.bbox)
      img.drawRectangle(r, new cv.Vec(0, 255, 0), 3, cv.LINE_8)
    }
    
    let response = (predictions.length == 0) ? 'nothing' : predictions.map(p => p.class).join(', ')
    //msg.channel.send(response, new MessageAttachment(tmpDir+'/detect.jpg'))
    return {
      msg: response,
      attachment: cv.imencode('.jpg', img)
    }
  }

  async snap(){
    await this.client.saveSnap(tmpDir+'/snap.jpg')
    return {
      attachment: tmpDir+'/snap.jpg'
    }
  }

  async captureFrames(frames, fps, dst=`${tmpDir}/motion%d.jpg`) {
    let rtsp = this.client.rtspMain()
    await exec(`ffmpeg -y -i ${rtsp} -frames:v ${frames} -vf fps=${fps} ${dst}`)
  }

  async motionDetect(minArea=0.03, width=1000, blur=11, thresh=20){
    //inspired by https://www.pyimagesearch.com/2015/05/25/basic-motion-detection-and-tracking-with-python-and-opencv/

    await this.captureFrames(2, 2)

    let scale = 1;
    let filePaths = [`${tmpDir}/motion1.jpg`, `${tmpDir}/motion2.jpg`]
    let images = filePaths
      .map(path => cv.imread(path))
      
    let processed = images.map((img) => {
        scale = width/img.cols
        let h = parseInt(img.rows*scale)
        return img.resize(h, width)
      })
      .map(img => img.cvtColor(cv.COLOR_BGR2GRAY))
      .map(img => img.gaussianBlur(new cv.Size(blur, blur), 0))

    let kernel = new cv.Mat(3, 3, cv.CV_8UC1, 255)

    let delta = processed[0].absdiff(processed[1])
      .threshold(thresh, 255, cv.THRESH_BINARY)
      .dilate(kernel, new cv.Point(1,1), 2)


    let minPixels = minArea*delta.cols*delta.rows
    let contours = delta.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    contours = contours.filter(c => c.area > minPixels)

    if(contours.length <= 0){
      return {
        msg: "no motion detected"
      }
    }

    let img = images[1]

    for(let c of contours) {
      let r = c.boundingRect()
      r = r.rescale(1/scale)
      img.drawRectangle(r, new cv.Vec(0, 255, 0), 3, cv.LINE_8)
    }

    return {
      msg: "motion detected",
      attachment: cv.imencode('.jpg', img)
    }
  }

  setSnapInterval(msg, time){
    let interval = this.setInterval(`snap-${msg.channel.name}`, time, ((msg)=>{
      return () => {
        this.snap(msg)
      }
    })(msg))
    if(interval != -1){
      msg.channel.send(`snap successfully scheduled every ${time}`)
    }
    else{
      msg.channel.send('snap schedule disabled')
    }
  }

  setDetectInterval(msg, time){
    let interval = this.setInterval(`detect-${msg.channel.name}`, time, ((msg)=>{
      return () => {
        let now = new Date().getTime()
        if(now > this.lastDetect + this.detectCooldown)
          this.detect(msg, true)
      }
    })(msg))
    if(interval != -1){
      msg.channel.send(`detect successfully scheduled every ${time}`)
    }
    else{
      msg.channel.send('detect schedule disabled')
    }
  }

  setInterval(name, time, func){
    if(this.intervals[name]){
      clearInterval(this.intervals[name])
    }

    let seconds = this.parseTime(time)
    if(seconds > 0){
      return this.intervals[name] = setInterval(func, seconds*1000)
    }
    else{
      return -1
    }
  }

  setCooldown(msg, _, time){
    let seconds = this.parseTime(time)
    this.detectCooldown = seconds*1000
    msg.channel.send(`detect cooldown set to ${time}`)
  }

  /**
   * 
   * @param {string} time 
   */
  parseTime(time){
    let multip = 1
    if(time.endsWith('m')){
      multip = 60
    }
    else if(time.endsWith('h')){
      multip = 60*60
    }

    let parsed = parseInt(time)
    if(isNaN(parsed)){
      throw 'invalid time'
    }

    return parsed*multip
  }
}

class CommandHandler {

  constructor(prefix){
    this.prefix = prefix
    this.cmds = []
  }

  register(pattern, action, help='') {
      
    this.cmds.push({
      re: RegExp(pattern),
      action: action,
      help: help
    })

  }

  /**
   * 
   * @param {string} command 
   */
  async execute(msg){
    let command = msg.content
    if(!command.startsWith(this.prefix)){
      return
    }
    command = command.substr(this.prefix.length)

    for(let cmd of this.cmds){
      if(command.match(cmd.re)){
        let [_, ...args] = command.split(' ')
        let res = await cmd.action(...args)

        let message = (res && res.msg) ? res.msg : null
        let attachment = (res && res.attachment) ? new MessageAttachment(res.attachment) : null

        return msg.channel.send(message, attachment)
      }
    }

    throw 'invalid command'
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

    cmd.register('^snap$', bot.snap.bind(bot))
    cmd.register('^snap [0-9]+(s|m|h)', bot.setSnapInterval.bind(bot))
    cmd.register('^detect$', bot.detect.bind(bot))
    cmd.register('^detect [0-9]+(s|m|h)', bot.setDetectInterval.bind(bot))
    cmd.register('^detect cooldown [0-9]+(s|m|h)', bot.setCooldown.bind(bot))
    cmd.register('^motion$', bot.motionDetect.bind(bot))

    bot.on('message', (msg) => {
      (function (msg){  
        cmd.execute(msg).then(() => {
          console.log(msg.content + ' processed')
        }).catch((err) => {
          console.log("cmd error: ", err.toString())
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
  initReolinkBot
}