# syntax=docker/dockerfile:1.7-labs

from node:21-bookworm

RUN apt update
RUN apt install -y \
    ffmpeg \
    git \
    build-essential \
    cmake

COPY package.json package-lock.json /app/

WORKDIR /app
RUN npm install

RUN export OPENCV4NODEJS_AUTOBUILD_OPENCV_VERSION=4.5.4
RUN npm run build-opencv

COPY --exclude=./node_modules/* . /app

ENTRYPOINT yarn start