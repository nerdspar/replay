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

# Status and body, not curl's exit code. A bare "curl: (56) ... error: 401"
# says nothing about which of several quite different things went wrong.
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT

call() {
  # curl already writes 000 to -w when it cannot connect, so no fallback echo
  # here — one would concatenate with it and produce "000000".
  : > "$BODY"
  curl -sS -o "$BODY" -w '%{http_code}' "$@" 2>/dev/null || true
}

open_url() {
  local code
  code="$(call -X POST \
    -H "Authorization: Bearer ${HA_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$(python3 -c '
import json, sys
print(json.dumps({
  "entity_id": sys.argv[1],
  "media_content_type": "url",
  "media_content_id": sys.argv[2],
}))' "$ATV_ENTITY" "$1")" \
    "${base}/api/services/media_player/play_media")"

  if [ "$code" != "200" ]; then
    echo "  HTTP ${code}: $(head -c 300 "$BODY")"
    return 1
  fi
}

# Everything that can be wrong before Neptune is even involved, checked in the
# order it fails, so the message names the actual problem rather than the last
# thing to notice it.
preflight() {
  local code
  code="$(call -H "Authorization: Bearer ${HA_TOKEN}" "${base}/api/")"

  case "$code" in
    200) ;;
    401)
      cat <<MSG
  Home Assistant rejected the token (401). Three things do this:

  1. The token is wrong, expired, or was truncated when pasted. They are
     roughly 180 characters — check yours is not cut short:
       echo -n "\$HA_TOKEN" | wc -c
     Make a fresh one at Profile > Security > Long-lived access tokens.

  2. Something in front of Home Assistant is answering instead of it —
     Cloudflare Access, Authelia, an nginx basic-auth. Those reject an API
     call carrying a Home Assistant token because they never see it as valid.
     Try the local address, which bypasses all of that:
       HA_URL=http://homeassistant.local:8123

  3. The token belongs to a different Home Assistant than ${base}.
MSG
      return 1
      ;;
    000)
      echo "  Could not reach ${base} at all. Wrong address, or nothing listening."
      return 1
      ;;
    *)
      echo "  ${base}/api/ answered ${code}, which is not Home Assistant's API."
      echo "  Body: $(head -c 200 "$BODY")"
      echo "  The REST API lives at the root of your HA URL — no /lovelace or trailing path."
      return 1
      ;;
  esac

  code="$(call -H "Authorization: Bearer ${HA_TOKEN}" "${base}/api/states/${ATV_ENTITY}")"
  if [ "$code" != "200" ]; then
    echo "  No entity called ${ATV_ENTITY} (HTTP ${code})."
    echo "  Check the exact id in Developer Tools > States."
    return 1
  fi

  local state
  state="$(python3 -c 'import json,sys; print(json.load(open("'"$BODY"'"))["state"])' 2>/dev/null || echo '?')"
  echo "  Home Assistant answers, and ${ATV_ENTITY} is ${state}."
  # Not fatal: an Apple TV asleep still wakes for a URL. Worth saying, though,
  # since "nothing happened" would otherwise be ambiguous.
  if [ "$state" = "unavailable" ] || [ "$state" = "unknown" ]; then
    echo "  That is not a good sign — an unavailable player may ignore everything below."
  fi
}

# One-off mode, for following a hunch.
if [ $# -ge 1 ]; then
  echo "Sending $1"
  preflight || exit 1
  open_url "$1" || exit 1
  exit 0
fi

: "${ITEM_ID:?set ITEM_ID — the 32-char id from the web URL of a Jellyfin item}"

# The control comes first on purpose. If the app does not even come forward,
# every "nothing happened" after it is meaningless — the fault would be the
# pipe, not the URL.
echo "Checking Home Assistant before blaming Neptune for anything."
preflight || exit 1

echo "
CONTROL: does anything reach the Apple TV at all?"
echo "  Sending neptune:// — Neptune should come to the foreground."
open_url 'neptune://' || exit 1
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
