const EventEmitter = require('events');
const ffmpeg = require('fluent-ffmpeg')

class VideoCapture extends EventEmitter {

  constructor(input, delay, size, timeout=10000) {
    super()
    this.input = input
    this.fps = parseInt(1000/delay)
    this.size = size
    this.frameSize = size[0]*size[1]*3
    this.curSize = 0
    this.timeout = timeout

    this.command = null
    this.cb = null
  }

  isOpen(){
    return this.command !== null
  }

  closed(){
    this.command = null
    this.emit('close')
  }

  open(){
    this.command  = ffmpeg(this.input)
    .addOutputOption(`-vf fps=${this.fps}`)
    .addOutputOption(`-s ${this.size[0]}x${this.size[1]}`)
    .addOutputOption(`-f image2pipe`)
    .addOutputOption(`-vcodec rawvideo`)
    .addOutputOption(`-pix_fmt rgb24`)
    .on('error', (err) => {
      console.log(err.message);
      this.closed()
    })
    .on('start', (cmdline) => {
      console.log(cmdline)
    })

    let ffstream = this.command.pipe();

    ffstream.on('error', (err) => {
      console.log(err)
    })

    let frame = new Uint8Array(this.frameSize)
    let curSize = 0

    ffstream.on('data', (chunk) => {
      if (curSize + chunk.length >= frame.length) {
        try {
          frame.set(chunk, curSize)
        }
        finally {
          this.emit('frame', frame)
          curSize = 0
        }
      }
      else {
        frame.set(chunk, curSize)
        curSize += chunk.length
      }
    })

    ffstream.on('close', () => {
      this.closed()
    })
  }

  capture(frames, cb) {
    if(this.tId) {
      clearTimeout(this.tId)
    }
    this.tId = setTimeout(() => {
      if(this.command !== null){
        this.command.kill()
      }
    }, this.timeout)

    if(!this.isOpen()) {
      this.open()
    }   

    return new Promise((resolve, reject) => {

      let i = 0
      let onFrame = function(frame) {
        cb(frame, i++)
        if(i == frames){
          this.off('frame', onFrame)
          this.off('close', reject)
          resolve()
        }
      }
      
      this.on('close', reject)
      this.on('frame', onFrame)
      
    })
  }
}

/**
   * 
   * @param {string} time 
   */
function parseTime(time){
  let multip = 1
  if(time.endsWith('m')){
    multip = 60
  }
  else if(time.endsWith('h')){
    multip = 60*60
  }

  let parsed = parseInt(time)
  if(isNaN(parsed)){
    return undefined
  }

  return parsed*multip
}

function extractBracket(values, opening='"', closing='"', separator=' '){
  if(!values[0].startsWith(opening)){
    return values.splice(0,1)[0]
  }

  for(let i = 0; i < values.length; i++) {
    if(values[i].endsWith(closing)){
      let res = values.splice(0, i+1).join(separator)
      return res.substr(1, res.length-2)
    }
  }
  
  throw 'closing bracket not found'
}

module.exports = {
  VideoCapture,
  parseTime,
  extractBracket,
}
  