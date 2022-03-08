const dotenv = require('dotenv')
dotenv.config()
const {Client, Intents, MessageButton} = require('discord.js')
const EventEmitter = require('events');
const cv = require("@u4/opencv4nodejs")
const { VideoCapture, resizeToSquare, unwrapYOLOv5, getOption, boxesIntersection, assertEV } = require('./util')
const { CommandHandler, ArgType } = require('./cmd')
const storage = require('node-persist')
const fs = require('fs');
const { PageCollection, CallFunction } = require('./interaction');

class IntervalMessage {

  constructor(msg, channelId, interval, cooldown=0, filter=false){
    this.msg = msg
    this.channelId = channelId
    this.interval = interval
    this.cooldown = cooldown
    this.filter = filter
    this.timeout = null

    this.bot = null

    this.startTS = null
    this.lastAttachmentTS = null

    this.intervalMsg = {
      content: this.msg,
      channel: {
        send: this.send.bind(this)
      },
    }

    this.fn = () => {
      this.startTS = new Date().getTime()
      this.bot.emit('messageCreate', this.intervalMsg)
    }
  }

  ms() {
    let endTS = new Date().getTime()
    let execTime = endTS - this.startTS
    let cd = this.cooldown*1000 - (endTS - (this.lastAttachmentTS ? this.lastAttachmentTS : 0))
    let timeout = this.interval*1000 + (cd > 0 ? cd : 0) - execTime
    return parseInt(timeout)
  }

  async send(message, attachment) {

    //save timestamp of last attachment
    if(attachment){
      this.lastAttachment = new Date().getTime()
    }

    //filter messages without attachment
    if(this.filter && !attachment){
      return
    }

    //send message
    let ch = this.bot.discord.channels.cache.get(this.channelId) || (await this.bot.discord.channels.fetch(this.channelId))
    ch.send(message, attachment)

    //reset timeout
    if(!this.bot) return

    let timeout = this.ms()

    if(timeout < 0){
      timeout = 0
    }

    this.timeout = setTimeout(this.fn, timeout)
  }

  /**
   * 
   * @param {NinjaVS} bot 
   */
  start(bot){
    this.bot = bot
    this.timeout = setTimeout(this.fn, 0)
  }

  stop(){
    this.bot = null
    clearTimeout(this.timeout)
  }

  toJSON(){
    let params = {
      msg: this.msg,
      channelId: this.channelId,
      interval: this.interval,
      cooldown: this.cooldown,
      filter: this.filter
    }
    return params
  }

  toString(){
    return JSON.stringify(this.toJSON())
  }

  /**
   * 
   * @param {string} json 
   */
  static fromObject(params){
    //let params = JSON.parse(json)
    return new IntervalMessage(params.msg, params.channelId, params.interval, params.cooldown, params.filter)
  }

}

class NinjaVS extends EventEmitter {

  constructor(input, onnxPath){
    super()
    this.discord = new Client({intents: [Intents.FLAGS.GUILD_MESSAGES]})
    this.intervals = []
    this.input = input
    this.onnxPath = onnxPath
  }

  login() {
    return new Promise((resolve, reject) => {
      this.discord.on('ready', () => {
        console.log(`Logged in as ${this.discord.user.tag}!`)
        resolve()
      });
  
      this.discord.on('messageCreate', msg => {
        this.emit('messageCreate', msg)
      });
      
      try{
        this.discord.login(process.env.NVS_DISCORD_TOKEN)
      }
      catch(err){
        reject(err)
      }
    })
  }

  destroy() {
    this.discord.destroy()
  }

  getVC(){

    let getParam = (key) => {
      if (process.env[key] !== undefined) {
        let value = parseInt(process.env[key])
        return !isNaN(value) ? value : undefined
      }
    }

    let width = getParam("NVS_CAPTURE_WIDTH")
    let height = getParam("NVS_CAPTURE_HEIGHT")
    let fps = getParam("NVS_CAPTURE_FPS")
     
    if (!this.vc) {
      this.vc = new VideoCapture(this.input, width, height, fps)
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
      this.net = await cv.readNetFromONNX(this.onnxPath)
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
    let img = await this.snap()
    if (img === undefined) return

    let { classNames, confidences } = await this.objects(img, true, ...options)

    if(classNames.length > 0) {
      return {
        content: classNames.map((name, i) => `${name}(${confidences[i]})`).join(', '),
        files: [{attachment: cv.imencode('.jpg', img)}]
      }
    }
    else {
      return {
        content: "no objects detected",
      }
    }
    
  }

  async snap(){
    try {
      let vc = this.getVC()
      return (await vc.read())
    } catch(err) {
      console.log(err)
    }
  }

  async snapWrapper(){
    let img = await this.snap()
    if (img === undefined) return {content: 'sorry, something went wrong'}
    return {
      files: [{attachment: cv.imencode('.jpg', img)}]
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

  async motionDetect(capDelay, ...options){
    let images = []
    try {
      let vc = this.getVC()
      images = await vc.capture(2, capDelay)
    } catch(err) {
      console.log(err)
      return
    }

    let boxes = await this.motion(images, true, ...options)

    if (boxes.length > 0) {
      return {
        content: "motion detected",
        files: [{attachment: cv.imencode('.jpg', images[1])}]
      }
    }
    else {
      return {
        content: "no motion detected",
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


  async smartDetect(intersect, delay, ...options){

    let images = []
    try {
      let vc = this.getVC()
      images = await vc.capture(2, delay)
    } catch(err) {
      console.log(err)
      return
    }

    let {classNames, confidences} = await this.smart(images, true, intersect, ...options)

    if (classNames.length == 0){
      return
    }

    return {
      content: classNames.map((name, i) => `${name}(${confidences[i]})`).join(', '),
      files: [{attachment: cv.imencode('.jpg', images[1])}]
    }
  }

  async setInterval(cmd, channel, interval, cooldown=0, filter=false){
    let imsg = new IntervalMessage(cmd, channel, interval, cooldown, filter)
    imsg.start(this)
    this.intervals.push(imsg)
    this.saveIntervals()
  }

  async clearInterval(index){
    let imsg = this.intervals.splice(index, 1)[0]
    imsg.stop()
    this.saveIntervals()
  }

  async saveIntervals() {
    await storage.setItem('intervals', this.intervals)
  }

  async loadIntervals() {
    let intervals = await storage.getItem('intervals') || []
    for(let params of intervals) {
      let imsg = IntervalMessage.fromObject(params)
      imsg.start(this)
      this.intervals.push(imsg)
    }
  }

  async listIntervals(){
    return {
      content: (this.intervals.length > 0) ? this.intervals.map((int, i) => `${i}: ${int.toString()}`).join('\n') : 'no intervals'
    }
  }

  async send(req, res) {
    let channel = req ? req.channel
      : this.bot.discord.channels.cache.get(this.channelId) || (await this.bot.discord.channels.fetch(this.channelId))
    
    await channel.send(res)
  }

}

let bot;

async function main(){

  assertEV('NVS_INPUT')
  assertEV('NVS_DISCORD_TOKEN')
  assertEV('NVS_CAPTURE_WIDTH')
  assertEV('NVS_CAPTURE_HEIGHT')
  assertEV('NVS_CAPTURE_FPS')
  assertEV('NVS_CHANNEL_ID')

  let onnxPath = getOption(process.env, 'NVS_ONNX_FILE', "dnn/yolov5s.onnx")
  if(!fs.existsSync(onnxPath)){
    throw `${onnxPath} onnx model not found`
  }

  await storage.init({
    dir: getOption(process.env, 'NVS_STORAGE', 'storage')
  })

  bot = new NinjaVS(process.env.NVS_INPUT, onnxPath)
    
  await bot.login()

  let channelId = getOption(process.env, 'NVS_CHANNEL_ID')
  let channel = await bot.discord.channels.fetch(channelId)
  if(channel.type !== 'GUILD_TEXT'){
    throw `NVS_CHANNEL_ID must be a text channel`
  }

  let cmd = new CommandHandler(getOption(process.env, 'NVS_CMD_PREFIX', '!'))

  cmd.register('snap', bot.snapWrapper.bind(bot), {
    description: 'takes a snapshot'
  })

  let objectCmd = cmd.register('objects', bot.detectObjects.bind(bot), {
    description: 'object detection'
  })
  .addArgument('exclude', ArgType.List, {default: getOption(process.env, 'NVS_OBJECT_EXCLUDE', []), description: "a list of classes to exclude (e.g.: 'airplane, traffic light')"})
  .addArgument('confidence', ArgType.Float, {default: getOption(process.env, 'NVS_OBJECT_CONFIDENCE', 0.6), description: "confidence threshold"})


  let motionCmd = cmd.register('motion', bot.motionDetect.bind(bot), {
    description: 'motion detection'
  })
  .addArgument('delay', ArgType.Number, {default: getOption(process.env, 'NVS_MOTION_DELAY', 100), description: 'delay in ms between images'})
  .addArgument('area', ArgType.Float, {default: getOption(process.env, 'NVS_MOTION_AREA', 0.001), description: 'min size of motion in percent'})
  .addArgument('thresh', ArgType.Number, {default: getOption(process.env, 'NVS_MOTION_THRESHOLD', 20), description: 'threshold value between 0-255'})
  .addArgument('blur', ArgType.Number, {default: getOption(process.env, 'NVS_MOTION_BLUR', 11), description: 'kernel size of gaussian blur, must be odd'})
  .addArgument('pWidth', ArgType.Number, {default: getOption(process.env, 'NVS_MOTION_WIDTH', 1000), description: 'processing width'})


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
  .addArgument('channel', ArgType.String, {default: getOption(process.env, 'NVS_CHANNEL_ID', ''), description: 'channel id'})
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
    return { content: 'Commands: \n'+cmd.listCommands()}
  }, {
    description: 'lists all commands'
  })


  cmd.register('help', (name) => {
    return { content: cmd.help(name) }
  }, {
    description: 'prints more information of a command'
  })
  .addArgument('name', ArgType.String, {required: true})




  let pages = new PageCollection('home', [new MessageButton({
    customId: 'back',
    label: 'Back',
    style: 'SECONDARY'
  })])
  pages.addPage('home', 'Welcome to NinjaVS!')
  .addButton({
    customId: 'snap',
    //label: 'Snap',
    emoji: '📸',
    style: 'SECONDARY'
  }, new CallFunction(bot.snapWrapper.bind(bot)))

  cmd.register('ninja', () => {
    return pages.goHome()
  }, {
    description: 'opens the interactive interface'
  })

  bot.discord.on('interactionCreate', async interaction => {
    if(!interaction.isButton()) return
    interaction.reply('Processing...')
    let res = await pages.execute(interaction.customId)
    return bot.send(interaction, res)
  });

  bot.on('messageCreate', (msg) => {
    (function (msg){ 
      cmd.execute(msg.content).then((res) => {
        if(!res) return
        return bot.send(msg, res)
      }).catch((err) => {
        console.log(err.toString(), err.stack)
        return bot.send(msg, err.toString())
      })
    })(msg)
  })

  await bot.loadIntervals()
}

if (require.main === module) {
  main()
  .then(() => {})
  .catch((err) => {
    if (bot) bot.destroy()
    console.error(err)
  })
}

module.exports = { 
  NinjaVS,
}