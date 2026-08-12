# Cartridge Player

Tap a 3D-printed NFC cartridge on a reader, and the show opens on the TV.

This repository is a **Home Assistant add-on repository**. It contains:

| | |
|---|---|
| [`cartridge_player/`](cartridge_player) | The add-on — tag library, metadata search, and playback |
| [`esphome/`](esphome) | Firmware for the ESP8266 + RC522 reader |

v1 targets **Stremio** content on an **Android TV**, on a fresh HAOS install
belonging to someone who should never have to open the automation editor.

---

## 1. Install the add-on

**This is an add-on, not a HACS integration.** HACS installs custom integrations,
dashboard cards, and themes — it does not install add-ons. Use the add-on store:

1. **Settings → Add-ons → Add-on Store**
2. **⋮ (top right) → Repositories**
3. Paste `https://github.com/nerdspar/replay` and **Add**
4. Close the dialog, find **Cartridge Player** in the store, **Install**, then
   **Start**

The first install builds the image on your Home Assistant machine, so expect it
to take several minutes — a native database driver is compiled during the build.
Later updates are much quicker.

Everything else is configured inside the app itself. The only add-on option is
`direct_port`, and the default (`0`, off) is the right value for almost everyone.

Requirements:

- **Home Assistant OS or Supervised.** Add-ons do not exist on Home Assistant
  Container or Core installs — if your sidebar has no **Add-ons** entry, that is
  the reason, and this cannot be installed there.
- The [Android TV Remote](https://www.home-assistant.io/integrations/androidtv_remote/)
  integration, already set up for your TV
- Stremio installed on the TV
- Outbound internet access from the add-on (for Cinemeta metadata)

## 2. Build the reader

See [§1 of the spec](cartridge-player-spec.md#1-hardware) for the bill of
materials. In short: a D1 mini, an RC522 module, one **SK6812** addressable LED,
a 470 µF capacitor across 3V3/GND next to the RC522, and NTAG215 stickers.

Pin map — these are deliberate, do not "simplify" them:

| Function | GPIO | D1 mini |
|---|---|---|
| SPI CLK | GPIO14 | D5 |
| SPI MOSI | GPIO13 | D7 |
| SPI MISO | GPIO12 | D6 |
| RC522 CS | GPIO5 | D1 |
| SK6812 DIN | GPIO4 | D2 |

**Do not use GPIO0, GPIO2, GPIO15, or GPIO16.** GPIO15 must be low at boot and
RC522 modules often pull it high — the board then simply won't start, with no
obvious cause. GPIO1 is UART TX and collides with the serial logger.

**Set `type:` to match your LED.** The firmware is built for the **RGBW** part —
four dies, one of them a dedicated white — as `type: GRBW` in
[the YAML](esphome/cartridge-reader.yaml). For a three-die RGB part, set
`type: GRB` and change each `set_rgbw(r, g, b, w)` in the scripts to
`set_rgb(r, g, b)`; white is then mixed as `set_rgb(1, 1, 1)`. If red and green
come out swapped, the part wants `RGB`/`RGBW` ordering instead.

On an RGBW part white comes from the white die alone rather than by mixing
R+G+B. Mixed white on those has a faint iridescence that shifts with viewing
angle and never quite reaches neutral — the white die exists to avoid it.

**Power the LED from 3V3, not 5V.** At 5 V an SK6812 needs about 3.5 V to read a
logic high and the ESP8266 only drives 3.3 V. That margin is negative on paper
and works fine on the bench, which is the worst combination — it starts failing
intermittently once the thing is in a case, and looks exactly like a loose wire.
At 3.3 V the threshold drops to about 2.3 V. Wire DIN to D2, VDD to 3V3, GND to
G, and leave DOUT unconnected. Add a 330–470 Ω resistor in series with DIN if
the lead is more than about 10 cm.

**If the log shows `[E][rc522] Reset command failed`, connect RST to 3V3.**
RST is active low. Boards that populate the pull-up on it idle high and run
happily with RST unconnected — which is why the upstream project leaves it off
and never hits this. Boards that omit the resistor leave it floating low, which
holds the chip in power-down where it cannot answer the soft reset ESPHome
sends. Wifi, uptime and the status light all keep working, so nothing points at the
reset line. One jumper to 3V3 fixes it; confirmed on a module that needed it.

## 3. Flash the firmware

Copy [`esphome/cartridge-reader.yaml`](esphome/cartridge-reader.yaml) into your
ESPHome config directory, add the secrets from
[`esphome/secrets.yaml.example`](esphome/secrets.yaml.example), and install.

It is deliberately a single file with no companion headers, so the whole thing
can be pasted into the ESPHome Builder editor and installed without touching the
filesystem by any other route.

**Compile from YAML.** The upstream project ships prebuilt binaries for ESP32-C3
and ESP32-S3; those will not flash to an ESP8266.

Once it is running you should see a `Cartridge ID` sensor, a `Cartridge Present`
binary sensor, a `Status Light`, a `Status Light Automatic` switch, and a
`Test Light` button in Home Assistant.

### What the light means

Six states the reader works out by itself:

| Look | Meaning |
|---|---|
| Red, slow breathe | No wifi |
| Amber, slow breathe | On wifi, but Home Assistant has not connected back |
| Dim white | Ready |
| White flash | A tag was read |
| White, slow breathe | Read it, waiting to hear what happens next |
| Amber, **fast** pulse | Nothing answered. Usually means the add-on is stopped |

Three the add-on sends, because the reader cannot know them:

| Look | Meaning |
|---|---|
| Green | The cartridge started something |
| Blue, slow breathe | A cartridge with nothing on it yet. Holds until you set it up |
| Red, **fast** pulse | Something failed. Clears itself after 30 seconds |

Speed carries meaning: **slow means waiting, fast means wrong.** That is why red
and amber each appear twice — a slow red is no wifi, a fast red is a failure.

The first six work with the add-on stopped, uninstalled, or restarting, which is
the whole point of them: they are what tells you whether a dead cartridge tap is
the reader's fault or everything else's. In particular, the add-on cannot report
its own absence — so if it is not running, the reader is the only thing that can
say so.

Lifting a cartridge off clears any held state.

**A cartridge left on the reader through a power cut is not played.** The reader
comes up exactly as it would with nothing on it — briefly red while it finds
wifi, then Ready — and the cartridge sits there ignored. Lift it and put it back
to play it, which is the same gesture as any other time. Home Assistant is told
nothing about it either way, so lifting it does not trigger your lift-off action
for something that was never started.

**The light is about** lets you choose what the light describes. *The cartridge*
means lifting one off returns the reader to idle, whatever is still playing.
*What is playing* means the light stays with it until the music stops — which
pairs with setting music lift-off to keep playing. Either way, the bar at the top
of the library shows what is actually in the reader.

All nine colours and brightnesses are yours to change under **Settings → Reader
light**, each with a reset button. The three speeds are fixed, because they are
what keeps two states apart when they share a colour.

**Use the cartridge's own colour** makes a playing cartridge light the reader in
a colour taken from its own artwork. Sampled for a light rather than for a
sticker: it looks for the most identifiable colour that would actually read as
light, ignoring anything too dark or too grey. A poster that is mostly black
with one vivid element lights up in that element, not in the black. Artwork with
no colour to offer — black and white covers — keeps the fixed Playing colour.

The colour is worked out by your browser the first time it lists a library, a
few cartridges at a time, and again whenever you change a cartridge's artwork.
Nothing to trigger by hand.

To drive the light yourself, turn **Status Light Automatic** off. The firmware
then stops touching it — including the read flash — and it behaves like any
other light. Turn the switch back on and the reader takes it straight back. The
switch exists because without it anything you set by hand would survive only
until the next tag tap or wifi reconnect and then revert for no visible reason.

## 4. Use it

Open **Cartridges** in the sidebar. A three-step wizard picks your TV, tests it,
and waits for your first cartridge.

After that: tap an unassigned cartridge on the reader, and the app offers to pick
a movie or series for it. Tap an assigned one, and it opens on the TV.

**Put it on your phone's home screen.** Under **Status**, set your Home Assistant
address in Settings and copy the panel link, then use Share → Add to Home Screen.
That link is stable; the URL you see while browsing through the sidebar is not.

## 5. Print the stickers

**Print stickers** in the library lays the artwork out on A4 or US Letter, sized
in millimetres. The **Cartridge label** preset is 60 × 90 mm with 4 mm corners,
measured from the shell — exactly 2:3, so posters print uncropped. Nine fit on an
A4 page, six on Letter.

Print at 100% scale with "fit to page" off, or the printer will shrink the sheet
to its own margins and the labels will not match the shell.

---

## Development

```bash
cd cartridge_player/app/server && npm install && npm test
```

```bash
cd cartridge_player/app/web && npm install && npm run build
```

The server serves the built SPA, so `npm run build` in `web/` then `npm run dev`
in `server/` gives you the whole app on <http://localhost:8099>. Point it at a
real Home Assistant with:

```bash
SUPERVISOR_TOKEN=<long-lived-token> CARTRIDGE_HA_REST_BASE=http://homeassistant.local:8123/api CARTRIDGE_HA_WS_URL=ws://homeassistant.local:8123/api/websocket CARTRIDGE_DB_PATH=./dev.db CARTRIDGE_WEB_ROOT=../web/dist npm run dev
```

Test through ingress, not against a directly exposed dev port — the base-path
handling is the single most likely thing to break, and it only exists under
ingress. There is a simulator for exactly that, which also stands in for the TV
and the NFC reader:

```bash
cd cartridge_player/app/server && npm run dev:fake-ha
```

```bash
cd cartridge_player/app/server && npm run dev:against-fake-ha
```

That serves the app under a rotating ingress session path at
<http://127.0.0.1:9124/api/hassio_ingress/AbC123SessionToken/>, and gives you a
control port to fake cartridge taps:

```bash
curl "http://127.0.0.1:9125/insert?uid=04-A3-B8-8B-32-02-89"
```

```bash
curl -s http://127.0.0.1:9125/calls | python3 -m json.tool
```

### Layout

```
cartridge_player/app/server/src
├── core/         fire sequence, scan handling, pending UIDs, UID normalisation
├── providers/    Provider registry + StremioProvider (Cinemeta)
├── targets/      Target registry + AndroidTvTarget
├── ha/           Supervisor REST, event WebSocket
├── http/         Fastify routes, ingress base injection, PIN gate
└── db/           SQLite schema and store
```

A second content provider or a second playback device is a `register()` call in
[`context.ts`](cartridge_player/app/server/src/context.ts) — no call site, schema,
or frontend change. [`seams.test.ts`](cartridge_player/app/server/src/seams.test.ts)
is what keeps that true.

## Status

The Jellyfin + Neptune-on-Apple-TV deployment described in §12 of the spec is
**blocked upstream** and deliberately not implemented. Neptune reports
`SupportsRemoteControl: false`, so Jellyfin session control cannot target it, and
it exposes no documented item-level deep link. The architecture accommodates it;
the code does not pretend to.

## Validating it works

See [TESTING.md](TESTING.md) for a phased validation plan — bench tests with a
simulated Home Assistant first, then firmware bring-up, then the real install.
It also documents how to run the simulator, which proxies the add-on exactly the
way ingress does.
