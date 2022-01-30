#from node:16-alpine
from node:16-bullseye

#RUN apk add --no-cache ffmpeg
#RUN apk add --no-cache git
#RUN apk add --no-cache cmake make gcc g++ musl-dev linux-headers

RUN apt update
RUN apt install -y \
    ffmpeg \
    git \
    build-essential \
    cmake

COPY . /app

WORKDIR /app/reolink-bot
RUN yarn install

WORKDIR /app/node_modules/@u4/opencv4nodejs
RUN npm install
RUN export OPENCV4NODEJS_AUTOBUILD_OPENCV_VERSION=4.5.4
RUN export OPENCV4NODEJS_AUTOBUILD_WITHOUT_CONTRIB=1
RUN npm run do-install

WORKDIR /app/reolink-bot
ENTRYPOINT yarn start