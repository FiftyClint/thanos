###############################################################################
# Build stage — full toolchain, produces dist/
###############################################################################
FROM node:20-bookworm-slim AS build

WORKDIR /app

# Dependencies first so a source-only change reuses this layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run check && npm run build

# Drop dev dependencies from the tree we're about to copy forward.
RUN npm prune --omit=dev

###############################################################################
# Runtime stage — no build tools, no source, non-root
###############################################################################
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=5000 \
    UPLOAD_DIR=/data

WORKDIR /app

# tini reaps zombies and forwards SIGTERM, so graceful shutdown actually works.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./package.json

# The client build is served from dist/public, next to the server bundle.
RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
