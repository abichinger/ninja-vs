# Reolink Discord Bot

A Discord Bot with object detection for Reolink CCTV cameras.

# Requirements

- OpenCV 3 or 4
- ffmpeg

# Development

Create `.env` file inside `./reolink-bot` with the following variables
```
REOLINK_HOST=...
REOLINK_USER=...
REOLINK_PASSWORD=...
DISCORD_TOKEN=...
```

Install dependencies and start the bot.
```
yarn install
yarn start
```