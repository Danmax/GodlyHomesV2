FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
# Test-only FFmpeg packages need no binary downloads in the build stage.
RUN npm ci --ignore-scripts
COPY index.html vite.config.js ./
COPY src ./src
COPY shared ./shared
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3001 MEDIA_DIR=/data/media
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /data/media && chown -R node:node /data /app
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]
