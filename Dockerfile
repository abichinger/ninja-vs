from node:16-bullseye

RUN apt update
RUN apt install -y \
    ffmpeg \
    git \
    build-essential \
    cmake

COPY package.json yarn.lock /app/

WORKDIR /app
RUN yarn install

RUN export OPENCV4NODEJS_AUTOBUILD_OPENCV_VERSION=4.5.4
RUN yarn rebuild

COPY . /app

ENTRYPOINT yarn start