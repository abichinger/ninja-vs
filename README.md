# Reolink Discord Bot

A Discord Bot with object detection for Reolink CCTV cameras.

# Requirements

- OpenCV 3 or 4
- ffmpeg

# Development

Create `.env` file inside `./reolink-bot` with the following variables
```
RLB_REOLINK_HOST=...
RLB_REOLINK_USER=...
RLB_REOLINK_PASSWORD=...
RLB_DISCORD_TOKEN=...
RLB_ONNX_FILE=...
```

Install dependencies and start the bot.
```
yarn install
yarn start
```