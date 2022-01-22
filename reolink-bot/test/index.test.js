const fs = require('fs')
const cv = require("opencv4nodejs-prebuilt")
const { initReolinkBot } = require("..");

function clearDir(dir){
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir)
}

class VideoCaptureMock {

    constructor(paths){
        this.paths = paths
    }

    async capture(frames, cb) {
        this.paths.map((path) => {
            let img = cv.imread(path, cv.IMREAD_COLOR)
            img = img.cvtColor(cv.COLOR_BGR2RGB).resize(1080, 1920);
            cb(img.getData())
        })
    }
}

beforeEach(() => {
    clearDir('.tmp');
});

describe('motionDetection', () => {
    test('little motion', async () => {

        jest.setTimeout(10000)
        
        let bot = await initReolinkBot()
        bot.vc = new VideoCaptureMock(['test/frames/little-motion-1.jpg', 'test/frames/little-motion-2.jpg'])
    
        let res = await bot.motionDetect(0.0003)
    
        expect(res.msg).toBe('motion detected')
    
    });

    test('motion', async () => {

        jest.setTimeout(10000)
        
        let bot = await initReolinkBot()
        bot.vc = new VideoCaptureMock(['test/frames/motion-1.jpg', 'test/frames/motion-2.jpg'])
    
        let res = await bot.motionDetect()
    
        expect(res.msg).toBe('motion detected')
    
    });

    test('no motion', async () => {

        jest.setTimeout(10000)
        
        let bot = await initReolinkBot()
        bot.vc = new VideoCaptureMock(['test/frames/motion-1.jpg', 'test/frames/motion-1.jpg'])
    
        let res = await bot.motionDetect()
    
        expect(res.msg).toBe('no motion detected')
    
    });
})
