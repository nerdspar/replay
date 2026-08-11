#!/usr/bin/env bash
#
# Works out whether neptune:// can open a specific item, by trying.
#
# There is nothing to read: Neptune publishes no URL scheme documentation, and
# no apple-app-site-association file, so it declares no Universal Links either.
# Its scheme is registered — `neptune://` foregrounds the app — but whether any
# path is honoured can only be established by sending some and watching.
#
# Usage:
#   HA_URL=https://ha.example.com \
#   HA_TOKEN=<Profile > Security > Long-lived access token> \
#   ATV_ENTITY=media_player.living_room \
#   ITEM_ID=<a Jellyfin item id> \
#     ./tools/neptune-deeplink-probe.sh
#
#   ./tools/neptune-deeplink-probe.sh 'neptune://something/else'   # one URL
#
# A Jellyfin item id is the 32-character hex in the web UI's address bar when
# you open a film — .../details?id=THIS_PART
#
# HOW TO WATCH IT. Between each probe, put the Apple TV back on its home screen
# and CLOSE Neptune (double-tap TV button, swipe up). Otherwise an already-open
# app looks identical to one that opened and ignored the path.
set -euo pipefail

: "${HA_URL:?set HA_URL, e.g. https://ha.example.com}"
: "${HA_TOKEN:?set HA_TOKEN — Profile > Security > Long-lived access tokens}"
: "${ATV_ENTITY:?set ATV_ENTITY, e.g. media_player.living_room}"

base="${HA_URL%/}"

open_url() {
  curl -fsS -X POST \
    -H "Authorization: Bearer ${HA_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$(python3 -c '
import json, sys
print(json.dumps({
  "entity_id": sys.argv[1],
  "media_content_type": "url",
  "media_content_id": sys.argv[2],
}))' "$ATV_ENTITY" "$1")" \
    "${base}/api/services/media_player/play_media" > /dev/null
}

# One-off mode, for following a hunch.
if [ $# -ge 1 ]; then
  echo "Sending $1"
  open_url "$1"
  exit 0
fi

: "${ITEM_ID:?set ITEM_ID — the 32-char id from the web URL of a Jellyfin item}"

# The control comes first on purpose. If the app does not even come forward,
# every "nothing happened" after it is meaningless — the fault would be the
# pipe, not the URL.
echo "CONTROL: does anything reach the Apple TV at all?"
echo "  Sending neptune:// — Neptune should come to the foreground."
open_url 'neptune://'
read -r -p "  Did Neptune open? [y/N] " ok
case "$ok" in
  [yY]*) ;;
  *)
    echo "
  Stop here — the problem is upstream of the URL format. Check that
  ${ATV_ENTITY} is the right entity, that the Apple TV is awake, and that
  Neptune is actually installed on it. Nothing below can tell you anything
  until a bare neptune:// works."
    exit 1
    ;;
esac

# Shapes a tvOS developer would plausibly have written. SwiftUI hands the app a
# URL and the two idiomatic ways to read it are host-plus-path components, or
# query items — so both are covered, with the vocabulary the app's own screens
# use (item, play, media, details, library).
candidates=(
  "neptune://item/${ITEM_ID}"
  "neptune://items/${ITEM_ID}"
  "neptune://play/${ITEM_ID}"
  "neptune://media/${ITEM_ID}"
  "neptune://detail/${ITEM_ID}"
  "neptune://details/${ITEM_ID}"
  "neptune://library/item/${ITEM_ID}"
  "neptune://item?id=${ITEM_ID}"
  "neptune://play?id=${ITEM_ID}"
  "neptune://open?id=${ITEM_ID}"
  "neptune://?id=${ITEM_ID}"
  "neptune://x-callback-url/play?id=${ITEM_ID}"
  "neptune:///item/${ITEM_ID}"
)

echo "
Now ${#candidates[@]} candidates. After each one, look at the TV:

  home screen or Neptune's own home  ->  the path was ignored
  the film's page, or it starts      ->  THAT IS THE FORMAT. Write it down.

Close Neptune between each. Ctrl-C when you have your answer.
"

for url in "${candidates[@]}"; do
  read -r -p "  next: ${url}   [enter] "
  open_url "$url"
  sleep 1
done

echo "
Nothing landed, then. That matches what was found at Neptune 0.1.6: the scheme
is registered but ignores its path — so 'deep links support' most likely means
the app can be opened, and callbacks for things like Seerr sign-in, rather than
item-level navigation.

Worth sending the developer, since it is a concrete question rather than a
feature request: does neptune:// accept an item id in any form, and if so what
shape? Attach this list so he can see what was tried.
"
