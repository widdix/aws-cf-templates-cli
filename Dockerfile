FROM node:16

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --only=production

COPY . .

ENTRYPOINT [ "node", "index.js" ]
