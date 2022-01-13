const dotenv = require('dotenv')
dotenv.config()
const {Client, MessageAttachment} = require('discord.js')
const client = new Client()
const reocgi = require('reolink-cgi')
const jpeg = require('jpeg-js')
const fs = require('fs')
require('@tensorflow/tfjs-node')
const cocoSsd = require('@tensorflow-models/coco-ssd');
const { createCanvas, Image } = require('canvas')

const tmpDir = './.tmp/';

/*
Commands:

!snap
!snap [time]
!detect
!detect [time]
!detect cooldown [time]
!detect snooze [time]

*/

class ReolinkBot {

  constructor(client){
    this.client = client
    this.intervals = {}
    this.detectCooldown = 0
    this.lastDetect = 0
  }

  async detect(msg, silent=false) {
    if(!this.model){
      this.model = await cocoSsd.load()
    }

    let imageUrl = this.client.snapUrl()
    let img = new Image()

    img.onload = () => {
      let canvas = createCanvas(img.width, img.height)
      let ctx = canvas.getContext("2d")
      ctx.drawImage(img, 0, 0)

      this.model.detect(canvas).then((predictions) => {

        if(silent && predictions.length == 0){
          return
        }

        this.lastDetect = new Date().getTime()

        for(let prediction of predictions){
          ctx.beginPath();
          ctx.lineWidth = "3";
          ctx.strokeStyle = "red";
          ctx.rect(...prediction.bbox);
          ctx.stroke();
        }
        
        let detectBuffer = canvas.toBuffer('image/jpeg', { quality: 0.7 })
        fs.writeFileSync(tmpDir+'detect.jpg', detectBuffer)
        
        let response = (predictions.length == 0) ? 'nothing' : predictions.map(p => p.class).join(', ')
        msg.channel.send(response, new MessageAttachment(tmpDir+'detect.jpg'))
      }).catch((err) => {
        console.log(err)
      })
      
    }
    img.onerror = err => { 
      throw err 
    }

    img.src = imageUrl 
  }

  async snap(msg){
    await this.client.saveSnap(tmpDir+'snap.jpg')
    msg.channel.send(new MessageAttachment(tmpDir+'snap.jpg'))
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
        return await cmd.action(msg, ...args)
      }
    }

    throw 'invalid command'
  }

}

let reoclient = new reocgi.Client(process.env.REOLINK_HOST)
reoclient.login(process.env.REOLINK_USER, process.env.REOLINK_PASSWORD)

reoclient.on('ready', () => {

  let bot = new ReolinkBot(reoclient)
  let cmd = new CommandHandler('!')

  cmd.register('^snap$', bot.snap.bind(bot))
  cmd.register('^snap [0-9]+(s|m|h)', bot.setSnapInterval.bind(bot))
  cmd.register('^detect$', bot.detect.bind(bot))
  cmd.register('^detect [0-9]+(s|m|h)', bot.setDetectInterval.bind(bot))
  cmd.register('^detect cooldown [0-9]+(s|m|h)', bot.setCooldown.bind(bot))
  
  client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`)
  });
  
  client.on('message', msg => {
    (function (msg){  
      cmd.execute(msg).then(() => {
        console.log(msg.content + ' processed')
      }).catch((err) => {
        console.log(err)
      })
    })(msg)
  });
  
  client.login(process.env.DISCORD_TOKEN)
})