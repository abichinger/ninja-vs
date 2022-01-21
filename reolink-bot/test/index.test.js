const { initReolinkBot } = require("..");
const fs = require('fs')
const cv = require("opencv4nodejs-prebuilt")

function clearDir(dir){
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir)
}

function captureFramesMock(framePaths) {
    return function(...args) {
        let size = args[3]
        let cb = args[4]
        framePaths.map((path) => {
            let img = cv.imread(path, cv.IMREAD_COLOR)
            img = img.cvtColor(cv.COLOR_BGR2RGB).resize(size[1], size[0]);
            cb(img.getData())
        })
    }
}

beforeEach(() => {
    clearDir('.tmp');
});

/*test('test captureFrames', async () => {
    
    jest.setTimeout(20000)

    let bot = await initReolinkBot()

    await bot.captureFrames('', 2, 10, [1920, 1080], (frame, i) => {
        let img = new cv.Mat(Buffer.from(frame), 1080, 1920, cv.CV_8UC3)
        cv.imwrite(`.tmp/capture${i}.jpg`, img)
    })

});*/

describe('motionDetection', () => {
    test('little motion', async () => {

        jest.setTimeout(10000)
        
        let bot = await initReolinkBot()
        bot.captureFrames = captureFramesMock(['test/frames/little-motion-1.jpg', 'test/frames/little-motion-2.jpg'])
    
        let res = await bot.motionDetect(0.0003)
    
        expect(res.msg).toBe('motion detected')
    
    });

    test('motion', async () => {

        jest.setTimeout(10000)
        
        let bot = await initReolinkBot()
        bot.captureFrames = captureFramesMock(['test/frames/motion-1.jpg', 'test/frames/motion-2.jpg'])
    
        let res = await bot.motionDetect()
    
        expect(res.msg).toBe('motion detected')
    
    });

    test('no motion', async () => {

        jest.setTimeout(10000)
        
        let bot = await initReolinkBot()
        bot.captureFrames = captureFramesMock(['test/frames/motion-1.jpg', 'test/frames/motion-1.jpg'])
    
        let res = await bot.motionDetect()
    
        expect(res.msg).toBe('no motion detected')
    
    });
})
