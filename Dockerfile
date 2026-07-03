# Car Dealer Monitor — production image
FROM node:22-alpine

# Small init so signals (SIGTERM/SIGINT) are handled cleanly.
RUN apk add --no-cache tini

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies first for better layer caching.
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

# Container-level healthcheck hitting the app's /healthz endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
