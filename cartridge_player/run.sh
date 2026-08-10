#!/usr/bin/with-contenv bashio
set -e

# Everything the end user needs lives in the app's own UI. The only add-on
# option is the LAN-direct escape hatch (§3.4).
export CARTRIDGE_DIRECT_PORT="$(bashio::config 'direct_port')"
export CARTRIDGE_INGRESS_PORT="8099"

bashio::log.info "Starting Cartridge Player..."
if [ "${CARTRIDGE_DIRECT_PORT}" != "0" ]; then
  bashio::log.info "LAN-direct mode requested on port ${CARTRIDGE_DIRECT_PORT} (PIN required)."
fi

exec node /app/dist/index.js
