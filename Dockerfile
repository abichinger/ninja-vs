from node:16-bullseye

RUN apt update
RUN apt install -y \
    ffmpeg \
    git \
    build-essential \
    cmake

COPY package.json yarn.lock /app/
COPY reolink-bot/package.json reolink-bot/yarn.lock /app/reolink-bot/
COPY reolink-cgi/package.json reolink-cgi/yarn.lock /app/reolink-cgi/

WORKDIR /app/reolink-bot
RUN yarn install

RUN export OPENCV4NODEJS_AUTOBUILD_OPENCV_VERSION=4.5.4
RUN yarn build-opencv rebuild

COPY . /app

WORKDIR /app/reolink-bot
ENTRYPOINT yarn start