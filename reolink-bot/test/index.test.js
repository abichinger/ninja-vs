const { initReolinkBot } = require("..");
const fs = require('fs')

function clearDir(dir){
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir)
}

beforeEach(() => {
    clearDir('.tmp');
});

/*test('test captureFrames', async () => {
    
    let bot = await initReolinkBot()
    await bot.captureFrames(3, 1)

    expect(fs.existsSync('.tmp/motion1.jpg')).toBe(true)
    expect(fs.existsSync('.tmp/motion2.jpg')).toBe(true)
    expect(fs.existsSync('.tmp/motion3.jpg')).toBe(true)
    expect(fs.existsSync('.tmp/motion4.jpg')).toBe(false)

});*/

test('test motionDetect', async () => {

    jest.setTimeout(10000)
    
    let bot = await initReolinkBot()
    let res = await bot.motionDetect()

    expect(res.msg).toBe('motion detected')

});