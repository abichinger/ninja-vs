# NinjaVS

A Discord bot with object and motion detection for CCTV cameras.
The NinjaVS bot will send you pictures, when something happens in front of your camera.

# Features
- Snapshot support
- Motion detection 
- Object detection
- Combined motion and object detection
- CLI Interface

# CLI Interface

- `!list` - lists all available commands
- `!help motion` - usage information of the `motion` command
- `!set-interval -cooldown 3s "!smart" 1s` - perform motion+object detection every second

# Install using Docker

Clone the repository
```
git pull https://github.com/abichinger/ninja-vs.git
cd ninja-vs
```

**Setup a discord bot**: 
1. Create a new discord [application](https://discord.com/developers/applications) and copy the application id
2. Add a bot to your application and note the api token
3. Replace `app_id` with your applicaton id and enter it into your browser: https://discord.com/api/oauth2/authorize?client_id=app_id&permissions=52224&scope=bot

Create `.env` file with all the required variables ([full list of environment varaibles](#environment-variables)).
```ini
NVS_INPUT=rtsp://username:password@host
NVS_DISCORD_TOKEN=your_discord_token
NVS_CAPTURE_WIDTH=2560
NVS_CAPTURE_HEIGHT=1440
NVS_CAPTURE_FPS=10
NVS_CHANNEL_ID=123
```

Build and start the docker container
```
docker-compose build
docker-compose up -d
```

# Manual Installation

## Requirements

- ffmpeg
- cmake

...

# Environment Variables

| Variable | Description | Required | Default
| --- | --- | --- | ---
| `NVS_INPUT` | input stream for ffmpeg | x 
| `NVS_DISCORD_TOKEN` | discord api token | x 
| `NVS_CAPTURE_WIDTH` | width of captured frames | x 
| `NVS_CAPTURE_HEIGHT` | height of captured frames | x 
| `NVS_CAPTURE_FPS` | fps processed by NinjaVS | x 
| `NVS_CHANNEL_ID` | input stream for ffmpeg | x 
| `NVS_ONNX_FILE` | path to onnx model | | `./dnn/yolov5s.onnx`
| `NVS_STORAGE` | directory of persistent storage files | | `storage`
| `NVS_CMD_PREFIX` | prefix to trigger NinjaVS | | `!`
| `NVS_OBJECT_EXCLUDE` | coco class names to exclude | | `''`
| `NVS_OBJECT_CONFIDENCE` | confidence threshold | | `0.6`
| `NVS_MOTION_DELAY` | delay in ms between images | | `100`
| `NVS_MOTION_AREA` | min size of motion in percent | | `0.001`
| `NVS_MOTION_THRESHOLD` | threshold value between 0-255 | | `20`
| `NVS_MOTION_BLUR` | kernel size of gaussian blur, must be odd | | `11`
| `NVS_MOTION_WIDTH` | processing width | | `1000`

# Development

```bash
# Install dependencies
npm install

# Build opencv
npm run build-opencv

# Run tests
npm run test

# Run NinjaVS
npm run start

```

# Attribution

[yolov5-opencv-cpp-python](https://github.com/doleron/yolov5-opencv-cpp-python/) - origin of onnx model

# Alternatives

- [Shinobi](https://shinobi.video/) 