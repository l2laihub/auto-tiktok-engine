# syntax=docker/dockerfile:1.6
FROM node:20-bookworm-slim

# System dependencies:
#   - ffmpeg: trimming music tracks (src/utils/{lyria,suno}.ts)
#   - chromium runtime libs: required by Remotion's headless renderer
#   - fonts: ensures consistent text rendering across compositions
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
      fonts-liberation \
      fonts-noto \
      fonts-noto-color-emoji \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libexpat1 \
      libfontconfig1 \
      libgbm1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxrender1 \
      libxshmfence1 \
      libxss1 \
      libxtst6 \
      tini \
      wget \
      xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install node dependencies first so layer is cached when only source changes
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Pre-download Remotion's Chrome Headless Shell so first render is fast
RUN node -e "import('@remotion/renderer').then(m => m.ensureBrowser()).catch(e => { console.error(e); process.exit(1); })"

# Copy the rest of the source
COPY . .

# Persistent dirs for rendered videos and generated music — mount as Coolify volumes
RUN mkdir -p /app/output /app/public/music
VOLUME ["/app/output", "/app/public/music"]

EXPOSE 3001

# Coolify injects env vars at runtime, but the dashboard spawns child processes
# with `node --env-file=.env`, so we materialize a .env file from the environment
# at container start. See docker-entrypoint.sh.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "run", "dashboard"]
