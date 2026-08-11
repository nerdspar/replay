# Cartridge Player — Build Spec

A physical NFC "cartridge" system that launches media on a TV via Home Assistant.
Tap a 3D-printed cartridge on a reader, the show opens on the TV.

Three deliverables:

1. **ESPHome firmware** for an ESP8266 + RC522 reader
2. **A Home Assistant add-on** (TypeScript/Fastify/SQLite/React) that manages the
   tag→title library and drives playback
3. **A GitHub add-on repository** so the add-on installs via custom repository URL

---

## 0. Scope

### v1 — build this

| | |
|---|---|
| Content provider | **Stremio** (metadata via Cinemeta) |
| Target device | **Android TV** (`androidtv_remote` integration) |
| Deployment | A fresh HAOS instance belonging to a non-technical end user |

### Deferred — design for, do not implement

A second deployment (Jellyfin content, Neptune client, Apple TV) is **blocked on an
upstream capability that does not currently exist**. See §12.

**Do not implement `JellyfinProvider` or `AppleTvTarget` in this build.** Do build
the `Provider` and `Target` interfaces (§5, §6) so exactly one implementation of
each ships, with the seams cut cleanly enough that a second slots in later without
touching call sites, the schema, or the frontend.

The test suite must prove that seam holds — see §11.

### Constraints

- The end-user install is **HAOS belonging to a non-technical person**. Everything
  he touches lives inside Home Assistant. He must never open the automation editor
  or the add-on config tab.
- **Mobile browser is the primary client**, not an afterthought. See §8.
- The app must be reachable from a **bookmark or home-screen icon**, not only by
  navigating the HA sidebar. See §3.4.
- No watch history, no "next unwatched", no user accounts.
- Hardware is an ESP8266: **12 mA per-pin limit** and limited usable GPIO. Pin
  assignments in §1.1 are deliberate — do not "simplify" them.

---

## 1. Hardware

### Bill of materials

| Item | Notes |
|---|---|
| ESP8266 board | D1 mini or NodeMCU v2 |
| RC522 RFID module | SPI |
| Active buzzer module (3-pin, onboard transistor) | See §1.2 |
| NTAG215 stickers, 25 mm | One per cartridge |
| 470 µF electrolytic capacitor | Across 3V3/GND near the RC522 |
| 3D-printed cartridge shells + reader enclosure | Derived from the TheStockPot model, resized |

### 1.1 Pin map

Hardware SPI on the ESP8266 is fixed. Use these pins:

| Function | GPIO | D1 mini label |
|---|---|---|
| SPI CLK | GPIO14 | D5 |
| SPI MOSI | GPIO13 | D7 |
| SPI MISO | GPIO12 | D6 |
| RC522 CS | GPIO5 | D1 |
| Buzzer signal | GPIO4 | D2 |

**Do not use GPIO0, GPIO2, GPIO15, or GPIO16.** GPIO15 must be low at boot and
RC522 modules often pull it high, producing a board that won't start with no
obvious cause. GPIO1 is UART TX and conflicts with the serial logger.

The RC522 reset pin is left unconnected; the module uses its own power-on reset.

> **Corrected in testing: tie RST to 3V3.** That holds only for modules with a
> pull-up on RST. RST is active low, and a floating-low pin holds the chip in
> power-down, where it cannot answer the soft reset ESPHome sends when no
> `reset_pin` is configured — `[E][rc522] Reset command failed`, with wifi,
> uptime and the buzzer all working normally.

### 1.2 Buzzer

Use a **3-pin active buzzer module with an onboard driver transistor** (VCC / GND /
Signal). Confirm a three-legged SOT-23 component is visible on the board — some
3-pin modules leave the middle pin unconnected and are just a bare buzzer, which
would exceed the ESP8266's pin budget.

With a module, the GPIO supplies only base current and the firmware treats it as a
plain digital output.

If a bare active buzzer is used instead, it needs an NPN transistor (2N3904 or
BC337), a 1 kΩ base resistor, and a 1N4148 flyback diode across the buzzer.

### 1.3 Power

Add the 470 µF capacitor across 3V3/GND close to the RC522. WiFi transmit peaks
plus RC522 bursts are the classic ESP8266 brownout combination. Use a real USB
supply.

---

## 2. ESPHome firmware

Derived from `TheStockPot/NFC-Cartridge-Player`, repinned for ESP8266. Everything
in the original YAML is ESP8266-compatible; only the platform block and pins change.

### 2.1 Required behaviour

- Read NTAG215 UIDs via `rc522_spi`, `update_interval: 250ms`
- **Beep locally inside `on_tag`**, not via a Home Assistant round trip. Audible
  confirmation must not depend on network latency or HA being responsive.
- Fire `esphome.nfc_card_inserted` with `uid` in the event data
- Fire `esphome.nfc_card_removed` with the UID that was removed
- Debounce removal by 500 ms — a card resting on the reader intermittently drops
  out of the field, and without debounce this produces event storms
- Expose `text_sensor` "Cartridge ID" and `binary_sensor` "Cartridge Present"
- Keep the template button that triggers a test beep

### 2.2 Platform block

```yaml
esp8266:
  board: d1_mini
```

Delete the `esp32:` block entirely, including `framework:` — ESP8266 is Arduino-only.

### 2.3 Note on prebuilt binaries

The upstream repo ships firmware compiled for ESP32-C3 and ESP32-S3. **These will
not flash to an ESP8266.** Compile from YAML.

---

## 3. Add-on architecture

### 3.1 Stack

- **TypeScript** throughout
- **Fastify** HTTP server
- **SQLite** via `better-sqlite3`, database at `/data/cartridge.db`
- **React SPA**, built with Vite, served statically by Fastify
- Single container, single process

### 3.2 Home Assistant integration

The add-on receives `SUPERVISOR_TOKEN` in its environment. Use it for both:

- **REST**: `POST http://supervisor/core/api/services/{domain}/{service}`
  with `Authorization: Bearer ${SUPERVISOR_TOKEN}`
- **WebSocket**: `ws://supervisor/core/websocket`, same token

**Subscribe to events over the WebSocket API rather than requiring the user to
create automations.** Subscribe to `esphome.nfc_card_inserted` and
`esphome.nfc_card_removed`. The add-on is the entire integration surface.

Handle reconnection with backoff. Home Assistant restarts; the add-on must
resubscribe without intervention. Surface connection state in the UI (§8.6).

### 3.3 Ingress

```yaml
ingress: true
ingress_port: 8099
panel_icon: mdi:filmstrip-box
panel_title: Cartridges
```

Home Assistant proxies the add-on under `/api/hassio_ingress/<session-token>/`,
which means:

- Vite must build with `base: './'`
- **All** frontend API calls must be relative (`api/cards`, never `/api/cards`)
- Use **hash routing** to sidestep base-path problems in the router entirely
- Read `X-Ingress-Path` server-side if an absolute path is ever unavoidable

This is the single most likely thing to break. Test through ingress from the
first commit, not against a directly exposed dev port.

### 3.4 Direct access

The ingress *session* URL contains a rotating token and cannot be bookmarked. The
*panel* URL is stable:

```
https://<ha-host>/hassio/ingress/<addon_slug>
```

The slug is prefixed by a repository hash when installed from a custom repository,
so it will not be bare `cartridge_player`. Document in the README that the user
should open the sidebar item once and copy the resulting URL.

**Primary access pattern: that URL, added to the phone's home screen.** Include a
web app manifest and `apple-touch-icon` so it installs as a proper icon:

- `display: standalone`
- `start_url` must be the stable panel URL — it cannot be relative, because the
  session path changes. Generate the manifest server-side from a configured
  hostname (`settings.public_base_url`).
- `theme_color` matching the app chrome

HA's session cookie persists, so in practice this opens straight into the app with
no login prompt.

**Optional LAN-direct mode.** Add-on option `direct_port` (default `0` = disabled).
When set, also listen on that port via `ports:`, serving the same SPA outside
ingress. Because this bypasses HA auth entirely, **require an app-level PIN
whenever direct mode is enabled**, stored hashed, with a session cookie. Refuse to
start in direct mode without a PIN set.

Ingress plus a home-screen icon is the documented default. Direct mode is an
escape hatch, not the recommendation.

### 3.5 Storage discipline

`/data` lives on the Home Assistant VM's disk. **Store poster URLs and let the
browser fetch images directly. Do not cache image files locally.** A hundred
cartridges of cached artwork is hundreds of megabytes on a disk with other demands.

---

## 4. Data model

### `settings` (single row, id = 1)

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | INTEGER PK | 1 | Enforce single row |
| `target_type` | TEXT | `'androidtv'` | Only `androidtv` valid in v1 |
| `remote_entity` | TEXT | null | e.g. `remote.living_room_tv` |
| `media_player_entity` | TEXT | null | e.g. `media_player.living_room` |
| `home_first_enabled` | BOOLEAN | true | §6.2 |
| `home_delay_ms` | INTEGER | 1500 | |
| `autoplay_enabled` | BOOLEAN | true | §6.2 |
| `autoplay_delay_ms` | INTEGER | 3000 | |
| `removal_action` | TEXT | `'none'` | `none`, `pause`, `back`, `home` |
| `pin_hash` | TEXT | null | Required if direct mode enabled |
| `public_base_url` | TEXT | null | For PWA manifest `start_url` |
| `setup_complete` | BOOLEAN | false | Drives first-run wizard |

**Reserved, unused in v1** — create these columns now so enabling §12 needs no
migration, but do not read or write them, and do not surface them in the UI:

`jellyfin_url`, `jellyfin_api_key`, `jellyfin_user_id`, `jellyfin_launch_mode`,
`neptune_scheme`

### `cards`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `tag_uid` | TEXT UNIQUE NOT NULL | As reported by ESPHome, e.g. `04-A3-B8-8B-32-02-89` |
| `provider` | TEXT NOT NULL | `stremio` in v1; column exists for §12 |
| `content_type` | TEXT NOT NULL | `movie` or `series` |
| `external_id` | TEXT NOT NULL | IMDb ID for Stremio |
| `title` | TEXT NOT NULL | Denormalised for display |
| `year` | TEXT | |
| `poster_url` | TEXT | URL only, never a local file |
| `season` | INTEGER | Null = open episode list |
| `episode` | INTEGER | Null = open episode list |
| `label` | TEXT | Optional user note, e.g. "blue cartridge" |
| `created_at` | INTEGER | Unix ms |
| `updated_at` | INTEGER | Unix ms |

`provider` + `external_id` rather than `imdb_id`, even though only one provider
ships. Store these, **never a pre-assembled URI** — build at fire time so formats
can change without a data migration.

### `scan_events` (rolling, capped at 200)

`id`, `tag_uid`, `matched_card_id`, `action_taken`, `error`, `created_at`.
Trim on insert. Debugging aid, not history.

---

## 5. Providers

```ts
interface Provider {
  readonly id: string
  search(query: string, type: 'movie' | 'series'): Promise<MetaPreview[]>
  getMeta(type: string, id: string): Promise<Meta>   // videos[] for series
  buildLaunch(card: Card, settings: Settings): LaunchPayload
}

type LaunchPayload =
  | { kind: 'uri'; value: string }
  | { kind: 'media_url'; value: string }
```

Resolve providers through a registry keyed by `card.provider`. Call sites must
never branch on a provider name.

**v1 ships one implementation: `StremioProvider`.** `MetaPreview` and `Meta` are
normalised shapes, not Cinemeta's wire format — the frontend must not know which
provider produced a result.

### 5.1 StremioProvider (via Cinemeta)

Cinemeta is Stremio's own metadata addon. Public, no key, no auth. Using it
guarantees stored IDs match what Stremio resolves.

**Use Cinemeta as the only metadata source.** Stremio treats items from addons
with different ID prefixes as separate content — a title from the TMDB addon
carries a `tmdb` prefix and won't behave identically. Mixing sources produces
cards that look right and behave wrong.

**Search** — `/catalog/{type}/{catalogId}/search={query}.json`

```
https://v3-cinemeta.strem.io/catalog/movie/top/search=blade%20runner.json
```

Returns `{ metas: [...] }` with `id`, `name`, `poster`, `releaseInfo`, `type`.

> **Verify catalog IDs at build time** from
> `https://v3-cinemeta.strem.io/manifest.json`. `top` is expected — confirm it.

**Detail** — `/meta/{type}/{imdbId}.json` returns `{ meta }`. For series,
`meta.videos[]` has `season`, `episode`, `id`, `name`, `released` — the source for
the episode picker.

Cache responses in memory, ~10 min TTL. Do not persist.

---

## 6. Targets and playback

```ts
interface Target {
  readonly id: string
  launch(payload: LaunchPayload): Promise<void>
  sendKey(key: TargetKey): Promise<void>   // 'home' | 'select' | 'back'
  stop(): Promise<void>
  pause(): Promise<void>
}
```

`TargetKey` is an abstract enum, not a raw keycode — each target maps it to its
own vocabulary. This is what keeps §6.2 device-agnostic.

**v1 ships one implementation: `AndroidTvTarget`.**

### 6.1 AndroidTvTarget

| Operation | Call |
|---|---|
| Launch `uri` | `remote.turn_on` with `activity: <uri>` |
| Launch `media_url` | Not supported — throw a typed error |
| `home` / `select` / `back` | `remote.send_command` with `HOME` / `DPAD_CENTER` / `BACK` |
| `stop` | `media_player.media_stop` |
| `pause` | `media_player.media_pause` |

### 6.2 Fire sequence

Device-agnostic. On a scan matching an assigned card:

1. **If `home_first_enabled`:** `sendKey('home')`, wait `home_delay_ms`.

   A deep link fired at an idle TV opens the app *behind* the screensaver without
   dismissing it. Someone tapping a cartridge is almost always walking up to an
   idle TV, so this is the normal case, not an edge case.

2. **`launch()`** the payload the provider returned.

3. **If `autoplay_enabled`:** wait `autoplay_delay_ms`, `sendKey('select')`.

   Stremio's deep link lands on the detail page, not playback, because a stream
   source still has to be selected. This press selects the first stream.

Every step individually skippable via settings. The whole sequence re-runnable
from the UI as a per-card **Test** button.

### 6.3 Stremio URI construction

| Case | URI |
|---|---|
| Movie | `stremio:///detail/movie/{id}/{id}` |
| Series, episode list | `stremio:///detail/series/{id}/` |
| Series, specific episode | `stremio:///detail/series/{id}/{id}:{season}:{episode}` |

The format is `stremio:///detail/{type}/{id}/{videoId}`; empty `videoId` opens the
episode list.

> **Three slashes, not two.** This section originally specified `stremio://`,
> and that fails on a real device in a misleading way: with two slashes `detail`
> parses as the URI authority rather than the first path segment, so Android
> resolves the scheme and Stremio opens, but the app cannot match the link and
> lands on its home screen. The autoplay press in §6.2 then activates whatever
> is focused there — in testing, the first item in Continue Watching. Corrected
> against Stremio's own documentation:
> <https://stremio.github.io/stremio-addon-sdk/deep-links.html>

**Default series behaviour is the episode list.** Specific-episode support exists
in the UI but is expected to be rare — the user picks a stream manually anyway, so
the episode list costs one click and avoids stale cards.

### 6.4 Removal behaviour

Driven by `settings.removal_action`:

| Value | Behaviour |
|---|---|
| `none` | Ignore removal (default) |
| `pause` | `target.pause()` |
| `back` | `target.sendKey('back')` |
| `home` | `target.sendKey('home')` |

---

## 7. HTTP API

All routes relative to the ingress base.

| Method | Path | Purpose |
|---|---|---|
| GET | `api/cards` | List all cards |
| POST | `api/cards` | Assign a UID to a title |
| PATCH | `api/cards/:id` | Update title, episode, or label |
| DELETE | `api/cards/:id` | Unassign |
| POST | `api/cards/:id/test` | Run the fire sequence manually |
| GET | `api/search?q=&type=&provider=` | Proxy provider search |
| GET | `api/meta/:provider/:type/:id` | Proxy provider detail / episode list |
| GET | `api/settings` | Read settings (never return secrets) |
| PUT | `api/settings` | Update settings |
| GET | `api/entities` | HA `remote.*` and `media_player.*` for setup dropdowns |
| GET | `api/pending` | Current unassigned-UID state (poll fallback for SSE) |
| GET | `api/events` | SSE — scans, pending UIDs, connection state, errors |
| GET | `api/scans` | Recent scan log |
| GET | `manifest.webmanifest` | Generated per §3.4 |

`provider` is a required parameter on search and meta even though only one value
is valid — it keeps the contract stable when a second provider lands. Default it
to `stremio` server-side.

Proxy provider APIs server-side rather than calling from the browser — keeps CORS
out of the picture and centralises caching.

---

## 8. Frontend

### 8.1 Mobile-first

**Design for a phone held in one hand, then widen.** The assignment flow is
inherently two-device — cartridge on the reader, phone in hand. Nobody walks to a
laptop to name a card.

- Single-column layout to ~640px, two-column poster grid, widening above
- Touch targets ≥ 44 px
- No hover-only affordances anywhere
- Search input: `type="search"`, `enterkeyhint="search"`, `autocapitalize="off"`
- Bottom-anchored primary actions, within thumb reach
- Respect safe-area insets for standalone/home-screen mode

### 8.2 SSE and backgrounding

The assignment flow depends on SSE pushing the unknown UID to the browser. **iOS
Safari kills connections when a tab backgrounds.** If the user opens the app,
walks to the reader, and taps a card, the connection is likely already dead and
the detection panel never fires.

Required:

- Reconnect the SSE stream on `visibilitychange` when the document becomes visible
- On resume, `GET api/pending` immediately to catch anything missed
- Server holds the most recent unassigned UID (with timestamp, ~5 min TTL) so a
  reconnecting client can recover it
- Show a subtle connection indicator so a dead stream is visible, not silent

### 8.3 First-run wizard

While `setup_complete` is false:

1. **Pick the TV** — dropdown from `api/entities` filtered to `remote.*`, with a
   one-line note that this comes from the Android TV Remote integration
2. **Test it** — button sends `home`, asks "did the TV react?"
3. **Scan your first cartridge** — live-waiting state, straight into assignment

No device-type or content-source step in v1; there is only one of each. Build the
wizard as an ordered step list so a step can be inserted later without a rewrite.

### 8.4 Library view

Poster grid. Each tile shows artwork, title, year, and for series pinned to an
episode an `S02E05` badge. Per-card actions: Test, Edit, Unassign.

Unassigned cartridges already seen appear in a strip at the top.

### 8.5 Assignment flow

The primary interaction. Must be fast on a phone:

1. User taps an unassigned cartridge on the reader
2. SSE pushes the unknown UID; a prominent "New cartridge detected" panel appears
3. User types a title → poster results (debounce ~300 ms)
4. User taps a poster
5. If series: **"Whole show"** (default, prominent) or **"Pick an episode"**
   (secondary, opens a season/episode picker)
6. Save → card appears in the library

Steps 3–6 achievable in under a minute by someone who has never seen the app,
one-handed.

### 8.6 Settings and troubleshooting

Settings: entity pickers, the three toggles with their delays, removal-action
radio, direct-access/PIN controls. Each delay field gets a one-line explanation of
what it compensates for — these need tuning against real hardware.

Troubleshooting: recent scans, HA WebSocket connection state, last error, and the
stable panel URL rendered as copyable text for home-screen setup.

---

## 9. Add-on packaging

```
ha-cartridge-player/
├── repository.yaml
└── cartridge_player/
    ├── config.yaml
    ├── Dockerfile
    ├── run.sh
    ├── README.md
    ├── CHANGELOG.md
    ├── icon.png
    ├── logo.png
    └── app/
        ├── server/
        └── web/
```

### `config.yaml` essentials

```yaml
name: Cartridge Player
version: "0.1.0"
slug: cartridge_player
description: Tap NFC cartridges to launch shows on your TV
arch: [aarch64, amd64, armv7]
init: false
ingress: true
ingress_port: 8099
panel_icon: mdi:filmstrip-box
panel_title: Cartridges
hassio_api: true
homeassistant_api: true
options:
  direct_port: 0
schema:
  direct_port: int(0,65535)
```

`direct_port: 0` disables LAN-direct mode. Everything else belongs in the app's
own UI — the target user should never open the config tab.

Base the Dockerfile on an official Home Assistant add-on base image so multi-arch
builds work from `BUILD_FROM`.

---

## 10. Testing

Cover the deterministic parts thoroughly, since so much of the rest is
timing-dependent against real hardware:

- **URI construction** — all three Stremio cases in §6.3, plus missing
  season/episode and unusual ID characters
- **Cinemeta client** — search and meta parsing against recorded fixtures, plus
  graceful degradation when unreachable (the UI must say so, not hang)
- **Fire sequence** — assert the exact ordered list of target calls for every
  combination of the three toggles, against a mock `Target`
- **Removal actions** — one test per value
- **UID matching** — case and separator normalisation, so a UID formatted
  differently after a firmware update still matches
- **WebSocket reconnection** — subscriptions restored after a simulated drop
- **Pending-UID recovery** — a client reconnecting after backgrounding receives
  the UID scanned while it was away
- **PIN gate** — direct mode refuses to start without a PIN; ingress mode never
  prompts for one

### 10.1 Seam tests (required)

These exist to prove §12 can be added without a refactor. They are not optional.

- A **`FakeProvider`** registered alongside `StremioProvider` in tests, returning
  canned `MetaPreview`/`Meta`. Assert search, assignment, and the fire sequence
  all work end to end against it with **no changes to call sites**.
- A **`FakeTarget`** implementing the full interface. Assert the fire sequence
  produces the same ordered abstract calls (`home`, `launch`, `select`) regardless
  of target.
- Assert `AndroidTvTarget.launch()` throws a **typed, catchable error** for a
  `media_url` payload rather than failing silently or throwing a generic Error.

Keep the fire sequence behind an interface swappable for a recording fake. No test
should require a live TV.

---

## 11. Open items (v1)

- Confirm Cinemeta catalog IDs from the live manifest (§5.1)
- Tune `home_delay_ms` and `autoplay_delay_ms` against the real device; defaults
  are starting points
- The 3D-printed enclosure needs resizing for the ESP8266 footprint, larger than
  the ESP32-C3 the original model was designed around

---

## 12. Deferred: Jellyfin + Neptune on Apple TV

**Status: blocked upstream. Do not implement. Do not add UI for it.**

This section exists so the architecture accommodates it and so the eliminated
paths are not re-investigated.

### 12.1 What was tested and ruled out

Neptune is a third-party Jellyfin client for tvOS (`neptuneplayer.com`), version
0.1.6 at time of writing. Three routes were tested against a live install:

| Route | Result |
|---|---|
| **Documented deep link** | None. Docs cover Settings, iOS surfaces, and the Plugin Suite with no mention of URL schemes. The "Three Different Shortcut Systems" page — which exists specifically to disambiguate shortcut concepts — lists Pins, widgets, and Compass Shortcuts, and does not include URL schemes or App Intents. |
| **URL scheme with item path** | `neptune://` launches the app, confirming a registered scheme, but no item-level path is documented and the app appears to ignore path components. |
| **Jellyfin session remote control** | Neptune registers a session (`Client: "Neptune"`, `DeviceName: "Apple TV"`) but reports **`SupportsRemoteControl: false`**, so `POST /Sessions/{id}/Playing` cannot target it. |

AirPlaying a direct Jellyfin stream URL was considered and **rejected** — it
bypasses Neptune entirely and loses its player and resume tracking.

A feature request is outstanding with the developer. `SupportsRemoteControl` is a
standard Jellyfin client capability, so the likely unblock is that flag flipping in
a future Neptune release.

### 12.2 What would be added when unblocked

- **`JellyfinProvider`** implementing `Provider` against the Jellyfin REST API:
  `GET /Items?searchTerm=&IncludeItemTypes=Movie,Series&Recursive=true` for search,
  `GET /Items/{id}` for detail, `GET /Shows/{seriesId}/Episodes` for episodes.
  Poster URLs need an API key, so an authenticated `api/image` proxy is required —
  do not embed the key in page markup.
- **`AppleTvTarget`** implementing `Target` against the `apple_tv` integration:
  `media_player.play_media` with `media_content_type: url` for launch,
  `remote.send_command` for keys.
- **Launch strategy**, dependent on which capability lands: either an item-level
  `neptune://` URI, or `neptune://` to foreground the app followed by
  `POST /Sessions/{id}/Playing`.
- A **device-type step and a content-source step** in the first-run wizard (§8.3).
- The reserved settings columns (§4) become live.

### 12.3 Critical implementation note for the session-control path

If the session route is what unblocks this: **Jellyfin session IDs are not
stable.** They change when the app restarts, the device sleeps, or the client
reconnects. Look the session up at fire time by matching on `Client` /
`DeviceName`; never cache the ID. Caching works perfectly in testing and then
fails days later in a way that looks random.
