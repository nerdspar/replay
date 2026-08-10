ARG BUILD_FROM

# ---------------------------------------------------------------------------
# Builder — compiles the TypeScript server, the Vite bundle, and better-sqlite3
# against musl (no prebuilt binaries exist for Alpine).
# ---------------------------------------------------------------------------
FROM ${BUILD_FROM} AS builder

RUN apk add --no-cache nodejs npm python3 make g++ git

WORKDIR /build

# Server dependencies first so the layer caches across source edits.
COPY app/server/package.json app/server/package-lock.json* ./server/
RUN cd server && npm install --include=dev

COPY app/web/package.json app/web/package-lock.json* ./web/
RUN cd web && npm install --include=dev

COPY app/server ./server
COPY app/web ./web

RUN cd server && npm run build
RUN cd web && npm run build

# Re-resolve server deps as production-only for the runtime image. The compiled
# better-sqlite3 binding is preserved by npm prune.
RUN cd server && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs

ENV NODE_ENV=production \
    CARTRIDGE_DB_PATH=/data/cartridge.db \
    CARTRIDGE_WEB_ROOT=/app/web

WORKDIR /app

COPY --from=builder /build/server/node_modules ./node_modules
COPY --from=builder /build/server/dist ./dist
COPY --from=builder /build/server/package.json ./package.json
COPY --from=builder /build/web/dist ./web

COPY run.sh /run.sh
RUN chmod a+x /run.sh

LABEL \
  io.hass.name="Cartridge Player" \
  io.hass.description="Tap NFC cartridges to launch shows on your TV" \
  io.hass.type="addon" \
  io.hass.version="0.1.1"

CMD ["/run.sh"]
