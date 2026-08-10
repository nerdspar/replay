#!/usr/bin/with-contenv sh
# The only job here is to hand over to Node with the container environment
# intact — SUPERVISOR_TOKEN lives in s6's container_environment, which is what
# `with-contenv` imports.
#
# Deliberately no bashio. Its helpers are not present in every base image, and
# depending on them meant `bashio::config` failed, `set -e` exited 1, and the
# container died before it ever listened on the ingress port — which surfaces
# as a 404 on the panel, with nothing to suggest the add-on is the cause.
#
# Add-on options are read straight from /data/options.json by the app, which is
# all bashio::config was doing.
set -e

echo "[INFO] run: starting Cartridge Player"
exec node /app/dist/index.js
