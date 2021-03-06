const cv = require("@u4/opencv4nodejs")
const { NinjaVS } = require("..");

//area, thresh, blur, width
const motionOptions = [0.001, 20, 11, 640]
const objectOptions = [[], 0.7]

describe('motionDetection', () => {
    test('little motion', async () => {
        
        let bot = new NinjaVS()

        let images = [
            cv.imread('test/frames/little-motion-1.jpg'), 
            cv.imread('test/frames/little-motion-2.jpg')
        ]
        let boxes = await bot.motion(images, true, 0.0005, 15, 11, 1000)
        //cv.imwrite('.tmp/little-motion.jpg', images[1])
    
        expect(boxes.length).toBeGreaterThan(0)
    
    });

    test('motion', async () => {
        
        let bot = new NinjaVS()

        let images = [
            cv.imread('test/frames/motion-1.jpg'), 
            cv.imread('test/frames/motion-2.jpg')
        ]
        let boxes = await bot.motion(images, true, ...motionOptions)
    
        expect(boxes.length).toBeGreaterThan(0)
    
    });

    test('no motion', async () => {
        
        let bot = new NinjaVS()

        let images = [
            cv.imread('test/frames/motion-1.jpg'), 
            cv.imread('test/frames/motion-1.jpg')
        ]
        let boxes = await bot.motion(images, true, ...motionOptions)
    
        expect(boxes.length).toBe(0)
    
    });
})

describe('objectDetection', () => {
    test('test dog', async () => {
        
        let bot = new NinjaVS()

        let img = cv.imread('test/frames/dog.jpg')
        let {classNames} = await bot.objects(img, true, ...objectOptions)
    
        expect(new Set(classNames)).toStrictEqual(new Set(["dog"]))
    
    });

    test('test car', async () => {
        
        let bot = new NinjaVS()

        let img = cv.imread('test/frames/car.jpg')
        let {classNames} = await bot.objects(img, true, ...objectOptions)
    
        expect(new Set(classNames)).toStrictEqual(new Set(["car"]))
    
    });
})

describe('combinedDetection', () => {
    test('basic', async () => {
        let bot = new NinjaVS()

        let images = [
            cv.imread('test/frames/motion-1.jpg'), 
            cv.imread('test/frames/motion-2.jpg')
        ]
        let {classNames} = await bot.smart(images, true, true, ...motionOptions, ...objectOptions)
        
    
        expect(classNames.includes('car')).toBe(true)
    });

    test('toggle intersection', async () => {
        let bot = new NinjaVS()

        let images = [
            cv.imread('test/frames/car-error.jpg'), 
            cv.imread('test/frames/car.jpg')
        ]
        
        let drawRectangles = false
        let intersect = false
        let {classNames} = await bot.smart(images, drawRectangles, intersect, ...motionOptions, ...objectOptions)
        expect(classNames.includes('car')).toBe(true)

        intersect = true
        let {classNames:classNames2} = await bot.smart(images, drawRectangles, intersect, ...motionOptions, ...objectOptions)
        expect(classNames2.length).toBe(0)
    });
})
