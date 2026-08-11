ARG BUILD_FROM
FROM ${BUILD_FROM}

# The JavaScript is compiled on the build machine, not in here — see
# .github/workflows/build.yml.
#
# It used to be built inside this image, which meant emulating an ARM64
# `npm install` of the whole dev toolchain. That hung outright: two of six
# aarch64 builds stalled in npm install and were killed by the job timeout,
# leaving a release published for amd64 only — which Home Assistant reports as
# "an unknown error occurred" when the missing architecture tries to update.
# It also ran vite and tsc against the Node this base image ships (20.15),
# which is older than they support.
#
# None of it was necessary: tsc and vite emit the same bytes on every
# architecture. The one thing that genuinely must be built for the target is
# better-sqlite3, which has no musl prebuilds — so a compiler goes in, is used,
# and comes back out in the same layer.

RUN apk add --no-cache nodejs

WORKDIR /app

COPY app/server/package.json app/server/package-lock.json* ./
RUN apk add --no-cache --virtual .build-deps npm python3 make g++ \
    && npm ci --omit=dev \
    && npm cache clean --force \
    && apk del .build-deps

# Prebuilt output, put into the build context by CI. Building from a clean
# checkout needs `npm run build` in app/server and app/web first.
COPY app/server/dist ./dist
COPY app/web/dist ./web

ENV NODE_ENV=production \
    CARTRIDGE_DB_PATH=/data/cartridge.db \
    CARTRIDGE_WEB_ROOT=/app/web

COPY run.sh /run.sh
RUN chmod a+x /run.sh

LABEL \
  io.hass.name="Cartridge Player" \
  io.hass.description="Tap NFC cartridges to launch shows on your TV" \
  io.hass.type="addon" \
  io.hass.version="0.1.11"

CMD ["/run.sh"]
