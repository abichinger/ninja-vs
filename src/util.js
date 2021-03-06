const EventEmitter = require('events');
const ffmpeg = require('fluent-ffmpeg')
const cv = require("@u4/opencv4nodejs");

const classNames = ['person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard',
  'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone',
  'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
  'hair drier', 'toothbrush']

class VideoCapture extends EventEmitter {

  constructor(input, width=1920, height=1080, fps=15, timeout=10000) {
    super()
    this.input = input
    this.size = [width, height]
    this.fps = fps
    this.frameSize = width*height*3
    this.curSize = 0
    this.timeout = timeout

    this.command = null
  }

  isOpen(){
    return this.command !== null
  }

  close(err){
    if(this.tId) {
      clearTimeout(this.tId)
    }
    if(this.command !== null){
      let cmd = this.command
      this.command = null
      cmd.kill()
      this.emit('close', err)
    }
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
      this.close(err)
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
          this.emit('frame', frame)
        } catch(err){
          this.close(err)
        }

        curSize = 0
      }
      else {
        frame.set(chunk, curSize)
        curSize += chunk.length
      }
    })

    ffstream.on('close', () => {
      this.close()
    })
  }

  async capture(frames, delay=0) {
    let images = []
    for(let i = 0; i< frames; i++){
      let img = await this.read()
      images.push(img)
      await sleep(delay)
    }
    return images
  }

  read() {
    if(this.tId) {
      clearTimeout(this.tId)
    }
    this.tId = setTimeout(() => {
      this.close()
    }, this.timeout)

    if(!this.isOpen()) {
      this.open()
    }   

    return new Promise((resolve, reject) => {

      let onFrame = function(frame) {
        let img = new cv.Mat(Buffer.from(frame), this.size[1], this.size[0], cv.CV_8UC3).cvtColor(cv.COLOR_BGR2RGB)
        this.off('frame', onFrame)
        this.off('close', reject)
        resolve(img)
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

  let parsed = parseFloat(time)
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

function resizeToSquare(img, size) {
    let imgResized = img.resizeToMax(size)
    let bottom = size - imgResized.rows
    let right = size - imgResized.cols
    return imgResized.copyMakeBorder(0, bottom, 0, right, cv.BORDER_CONSTANT)
}

/**
 * 
 * @param {cv.Mat} output 
 * @param {number} scale 
 * @returns 
 */

function unwrapYOLOv5(output, scale, confidenceThreshold=0.5, nmsThreshold=0.3) {
  let boxes = []
  let confidences = []
  let classIds = []

  for(let i = 0; i < output.rows; i++){

    let x = output.at(i, 0)
    let y = output.at(i, 1)
    let w = output.at(i, 2)
    let h = output.at(i, 3)
    let box = new cv.Rect(
      parseInt((x - 0.5 * w) * scale), 
      parseInt((y - 0.5 * h) * scale),
      parseInt(w * scale),
      parseInt(h * scale),
    )

    let confidence = output.at(i, 4)

    let classScore = 0
    let classId = 0
    for(let j = 5; j < output.cols; j++){
      let score = output.at(i, j)
      if (score > classScore){
        classScore = score
        classId = j-5
      }
    }

    boxes.push(box)
    confidences.push(confidence)
    classIds.push(classId)
  }

  let indices = cv.NMSBoxes(
    boxes,
    confidences, confidenceThreshold, nmsThreshold
  );

  return indices.reduce((res, i) => {
    res.boxes.push(boxes[i])
    res.confidences.push(confidences[i])
    res.classIds.push(classIds[i])
    res.classNames.push(classNames[classIds[i]])
    return res
  }, {
    boxes: [],
    confidences: [],
    classIds: [],
    classNames: []
  })
}

function getOption(options, key, defaultValue){
  if(options && options[key] !== undefined){
    return options[key]
  }
  else {
    return defaultValue
  }
}

/**
 * 
 * @param {cv.Rect} r1 
 * @param {cv.Rect} r2 
 * @returns 
 */
function boxIntersection(r1, r2){
  
  let left = (r) => r.x
  let right = (r) => r.x + r.width
  let top = (r) => r.y
  let bottom = (r) => r.y + r.height
  
  return !(
    left(r2) > right(r1) ||
    right(r2) < left(r1) ||
    top(r2) > bottom(r1) ||
    bottom(r2) < top(r1)
  )
}

function boxesIntersection(boxesA, boxesB) {
  for(let r1 of boxesA){
    for(let r2 of boxesB){
      if(boxIntersection(r1, r2)) return true
    }
  }
  return false
}

function sleep(ms){
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function assertEV(name){
  if(process.env[name] === undefined){
    throw `environment variable ${name} is required`
  }
}

module.exports = {
  VideoCapture,
  parseTime,
  extractBracket,
  resizeToSquare,
  unwrapYOLOv5,
  getOption,
  boxesIntersection,
  assertEV
}
  