#!/usr/bin/env bash
#
# Does Neptune accept remote control yet?
#
# This is the route worth having, and the one to check FIRST. A deep link can
# only open something; Jellyfin session control plays it, tracks resume, and
# survives the app being retitled or its URL format changing. §12 of the spec
# tested this against Neptune 0.1.6 and found SupportsRemoteControl: false,
# which is a standard client capability — so the likely unblock is that one flag
# flipping in a later release.
#
# Usage:
#   JELLYFIN_URL=http://jellyfin.local:8096 \
#   JELLYFIN_TOKEN=<api key from Dashboard > API Keys> \
#     ./tools/neptune-session-check.sh
#
# Open Neptune on the Apple TV first — a client only appears here while it has
# a live session.
set -euo pipefail

: "${JELLYFIN_URL:?set JELLYFIN_URL, e.g. http://jellyfin.local:8096}"
: "${JELLYFIN_TOKEN:?set JELLYFIN_TOKEN — Jellyfin Dashboard > API Keys}"

base="${JELLYFIN_URL%/}"

echo "Asking ${base} which clients are connected..."
sessions="$(curl -fsS -H "X-Emby-Token: ${JELLYFIN_TOKEN}" "${base}/Sessions")"

# What the server itself offers. Neptune ships a Jellyfin plugin — the one
# carrying the MDM settings screen — and a plugin can contribute its own API
# endpoints, which Jellyfin publishes in its OpenAPI document alongside the
# built-in ones. Anything Neptune exposes for talking to a live client is
# listed there, and nowhere else.
echo
echo "Plugins installed on this server:"
plugins="$(curl -fsS -H "X-Emby-Token: ${JELLYFIN_TOKEN}" "${base}/Plugins" 2>/dev/null || echo '[]')"

# Passed as an argument rather than piped, so the Python below can be a quoted
# heredoc and use whatever quotes it likes. Nesting quotes inside `python3 -c`
# inside a shell script is how the first version of this got mangled.
python3 - "$plugins" <<'PY'
import json, sys

try:
    plugins = json.loads(sys.argv[1])
except Exception:
    plugins = []

if not plugins:
    print("  (could not read the plugin list — this needs an admin API key)")
else:
    for p in plugins:
        name = str(p.get("Name", "?"))
        mark = "   <-- this one" if "neptune" in name.lower() else ""
        print(f"  {name:<34} {p.get('Version', '?'):<12}{mark}")
PY

echo
echo "Endpoints the Neptune plugins add:"

# Written to a file, not passed as an argument. Jellyfin's OpenAPI document
# describes the whole server and runs to megabytes, which is well past what a
# command line can carry — the first version of this died with "Argument list
# too long" rather than telling anyone anything.
SPEC="$(mktemp)"
trap 'rm -f "$SPEC"' EXIT

for doc in "${base}/openapi.json" "${base}/api-docs/openapi.json"; do
  if curl -fsS -H "X-Emby-Token: ${JELLYFIN_TOKEN}" "$doc" -o "$SPEC" 2>/dev/null \
     && [ -s "$SPEC" ]; then
    break
  fi
done

python3 - "$SPEC" "$base" <<'PY'
import json, sys

try:
    with open(sys.argv[1]) as handle:
        spec = json.load(handle)
except Exception:
    spec = {}

paths = spec.get("paths", {})

# The plugins are named "Neptune MDM" and "Neptune Indexers", and a plugin's
# routes need not carry its name — so the tag and operationId are searched too.
# Jellyfin tags a plugin's endpoints with its controller, which is where the
# name usually surfaces even when the URL hides it.
def relevant(path, op):
    if "neptune" in path.lower():
        return True
    haystack = " ".join(str(t) for t in op.get("tags", []))
    haystack += " " + str(op.get("operationId", ""))
    return "neptune" in haystack.lower()

hits = []
for path, methods in sorted(paths.items()):
    for method, op in methods.items():
        if method.lower() not in ("get", "post", "put", "delete", "patch"):
            continue
        if isinstance(op, dict) and relevant(path, op):
            hits.append((method.upper(), path, op))

if not paths:
    print("  Could not read the OpenAPI document with this key.")
    print("  Open this in a browser while signed in as an admin instead:")
    print(f"    {sys.argv[2]}/api-docs/swagger")
elif not hits:
    print(f"  Nothing Neptune-shaped among {len(paths)} documented paths.")
    print("  The plugins may register routes outside the OpenAPI document, in which")
    print("  case the settings push travels over the Jellyfin WebSocket instead —")
    print("  which would be the same channel remote control uses. See below.")
else:
    for method, path, op in hits:
        print(f"  {method:<6} {path}")
        text = op.get("summary") or op.get("description") or ""
        if text:
            print(f"         {text.strip().splitlines()[0][:96]}")
    print("""
  Read these closely. Anything that reaches a LIVE client is a route to remote
  play that needs no URL scheme at all — the settings push proves that channel
  exists and works, which is the hard part.""")
PY

python3 - "$sessions" "$plugins" <<'PY'
import json, sys

# Compare the app against its own server plugin.
#
# Easy to read past in two separate lists, and it changes what every other
# result here means: a conclusion about the app is a conclusion about the
# version installed, not about Neptune.
try:
    sessions_for_version = json.loads(sys.argv[1])
    plugins_for_version = json.loads(sys.argv[2])
except Exception:
    sessions_for_version, plugins_for_version = [], []

def major(version):
    try:
        return int(str(version).split(".")[0])
    except Exception:
        return None

app = next((s.get("ApplicationVersion") for s in sessions_for_version
            if "neptune" in str(s.get("Client", "")).lower()), None)
plugin = next((p.get("Version") for p in plugins_for_version
               if "neptune" in str(p.get("Name", "")).lower()), None)

if app and plugin and major(app) is not None and major(plugin) is not None:
    if major(plugin) > major(app):
        print()
        print("  THE APP IS BEHIND ITS OWN PLUGIN.")
        print()
        print(f"    Apple TV app   {app}")
        print(f"    server plugin  {plugin}")
        print()
        print("  Everything else here describes the version installed on that Apple")
        print("  TV, not Neptune as it now is. Update the app from the App Store and")
        print("  run this again, along with the deep-link probe — a capability the")
        print("  app has gained since would look exactly like one it does not have.")
PY

python3 - "$sessions" <<'PY'
import json, sys

sessions = json.loads(sys.argv[1])
if not sessions:
    print("\nNo sessions at all. Open Neptune on the Apple TV and run this again.")
    raise SystemExit(1)

print("\nEverything connected right now:")
for s in sessions:
    print(f"  {s.get('Client','?'):<24} {s.get('DeviceName','?'):<20} "
          f"v{s.get('ApplicationVersion','?')}")

neptune = [s for s in sessions if 'neptune' in str(s.get('Client', '')).lower()]
if not neptune:
    print("\nNo Neptune session. It has to be open on the Apple TV to appear.")
    raise SystemExit(1)

for s in neptune:
    remote = s.get('SupportsRemoteControl', False)
    print(f"\nNeptune {s.get('ApplicationVersion','?')} on {s.get('DeviceName','?')}")
    print(f"  session id            {s.get('Id')}")
    print(f"  SupportsRemoteControl {remote}")
    print(f"  SupportedCommands     {', '.join(s.get('SupportedCommands', [])) or '(none)'}")
    print(f"  PlayableMediaTypes    {', '.join(s.get('PlayableMediaTypes', [])) or '(none)'}")

    if remote:
        print("""
  THIS IS THE ONE. Remote control is available, which beats any deep link:
  it plays rather than merely opens, and Jellyfin tracks resume for you.

  Try it — replace ITEM_ID with a real one:

    curl -X POST -H "X-Emby-Token: $JELLYFIN_TOKEN" \\
      "$JELLYFIN_URL/Sessions/{}/Playing?itemIds=ITEM_ID&playCommand=PlayNow"

  Note the session id above is NOT stable. It changes when the app restarts or
  the device sleeps, so anything built on this must look it up at play time by
  matching on Client and DeviceName. Caching it works in testing and then fails
  days later, looking random. (Spec 12.3.)
""".format(s.get('Id')))
    else:
        print("""
  Still false, so POST /Sessions/{id}/Playing cannot target it.
""")
PY
