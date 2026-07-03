# Car Dealer Monitor — production image.
# Based on the official Playwright image (matching the pinned playwright version)
# so headless Chromium and all its system dependencies are already present for
# the `browser` dealer type. This image is larger than a plain Node image — that
# is the tradeoff for scraping JavaScript-rendered / bot-protected dealer sites.
FROM mcr.microsoft.com/playwright:v1.56.0-jammy

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies first for better layer caching. Browsers are
# already in the base image, so Playwright's install step finds them (no download).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source.
COPY src ./src
COPY public ./public

# Persist databases on a mounted volume at /data (see DATA_DIR).
ENV DATA_DIR=/data
ENV PORT=3000
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000

# Node-based healthcheck (curl/wget may be absent); Node 22 has global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
