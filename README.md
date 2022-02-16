# NinjaVS

A Discord bot with object and motion detection for CCTV cameras.

# Features
- Snapshot support
- Motion detection 
- Object detection
- Combined motion and object detection
- CLI Interface

# CLI Interface

- `!list` - lists all available commands
- `!help motion` - usage information of the `motion` command

# Install using Docker

Clone the repository
```
git pull https://github.com/abichinger/ninja-vs.git
cd ninja-vs
```

Create `.env` file with the following variables
```ini
NVS_INPUT=rtsp://username:password@host
NVS_DISCORD_TOKEN=your_discord_token
NVS_ONNX_FILE=dnn/yolov5s.onnx
NVS_CAPTURE_WIDTH=2560
NVS_CAPTURE_HEIGHT=1440
NVS_CAPTURE_FPS=10
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

...

# Development

...

# Alternatives

- [Shinobi](https://shinobi.video/) 