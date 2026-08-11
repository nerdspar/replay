# Validation plan

A checklist for proving this works, ordered so each phase depends only on the
ones before it. Phases 1–3 need no hardware; do those first, because finding a
problem there is far cheaper than finding it with a soldering iron in hand.

Each check has an **objective** pass condition. "Looks right" is not one.

Legend: **A** = already covered by automated tests, re-run rather than redo by
hand. **M** = manual. **H** = needs real hardware.

---

## Phase 0 — What is already proven

Run these first. If they fail, stop; something regressed.

```bash
cd cartridge_player/app/server && npm test
```

```bash
cd cartridge_player/app/web && npm test
```

| Area | Covered |
|---|---|
| Stremio URI building — all three §6.3 cases, missing season/episode, season 0, odd characters | A |
| Cinemeta parsing against recorded fixtures, and its failure modes | A |
| Fire sequence — every on/off combination, exact call order, exact delays | A |
| Removal actions — one test per value | A |
| UID matching across separator and case changes | A |
| WebSocket reconnect and resubscribe, with backoff | A |
| Pending-UID recovery after a client disappears | A |
| PIN gate: direct mode refuses without a PIN, ingress never prompts | A |
| Provider/Target seams — a second implementation of each works unchanged | A |
| Ingress base-path injection | A |
| Upload sniffing, path traversal, import allowlist and SSRF | A |
| Sticker sheet geometry and pagination | A |

**These do not prove the system works.** They prove the deterministic parts are
correct. Everything below is what they cannot reach: real timing, real hardware,
real paper, real phones.

---

## Phase 1 — Bench run, no hardware (M)

A simulator stands in for Supervisor, Home Assistant, the TV, and the reader. It
proxies the add-on exactly the way ingress does, which is the point — the
base-path handling does not exist on a plain dev port.

```bash
cd cartridge_player/app/web && npm run build
```

```bash
cd cartridge_player/app/server && npm run dev:fake-ha
```

```bash
cd cartridge_player/app/server && npm run dev:against-fake-ha
```

Open `http://127.0.0.1:9124/api/hassio_ingress/AbC123SessionToken/`.

| # | Check | Pass condition |
|---|---|---|
| 1.1 | App loads through the ingress path | Library renders; browser console has no 404s for JS or CSS |
| 1.2 | Requests stay inside the session path | In devtools Network, every `api/…` request URL contains `/api/hassio_ingress/AbC123SessionToken/` |
| 1.3 | Simulate an unknown tag: `curl "http://127.0.0.1:9125/insert?uid=04-DE-AD-BE-EF"` | "New cartridge detected" appears **without reloading** |
| 1.4 | Assign it a movie | Card appears in the library with artwork |
| 1.5 | Tap it again: same `curl` | `curl -s http://127.0.0.1:9125/calls` shows `HOME`, then `remote.turn_on` with a `stremio://` activity, then `DPAD_CENTER` |
| 1.6 | Timing between those three calls | Roughly 1.5 s and 3.0 s apart, matching the configured delays |
| 1.7 | Set removal action to Pause, then `curl ".../remove?uid=…"` | A `media_player.media_pause` call appears |
| 1.7a | Edit a cartridge → **Empty this cartridge** | Asks first. Afterwards it stays in the library showing its tag, not its poster |
| 1.7b | Fire an insert for that emptied cartridge | **No** calls reach the TV; the new-cartridge panel appears instead |
| 1.7c | Fill it with something else | Reuses the same cartridge — the library count does not grow — and it plays again |
| 1.7d | Edit a cartridge → **Delete this cartridge** | Asks first, then it is gone from the library entirely |
| 1.7e | On any confirmation dialog, press Cancel | Nothing happens. Cancel is what is focused by default |
| 1.8 | Stop the simulator, watch the add-on log | Backoff messages: retrying in 1000ms, 2000ms, 5000ms… |
| 1.9 | Start it again | "subscribed to esphome.nfc_card_inserted…" reappears **without restarting the add-on**, and a tag fired afterwards still works |

1.8 and 1.9 matter more than they look. Home Assistant restarts for every update;
if resubscription is broken the cartridges silently stop working days later.

---

## Phase 2 — Mobile and offline behaviour (M)

Use a real phone on the same network, at `http://<your-mac-ip>:9124/api/hassio_ingress/AbC123SessionToken/`.
A desktop browser at a narrow window is not a substitute — it cannot reproduce
iOS suspending a backgrounded tab.

| # | Check | Pass condition |
|---|---|---|
| 2.1 | One-handed use | Every control reachable with a thumb; no target smaller than a fingertip |
| 2.2 | **The backgrounding case.** Open the app, switch to another app for 2–3 minutes, fire an insert for an unknown UID while it is backgrounded, then return | The new-cartridge panel appears within a second or two of returning |
| 2.3 | Turn wifi off for 30 s, then on | The "live" pill goes offline, then returns by itself |
| 2.4 | Assignment speed, timed, by someone who has not used it | Under a minute from tap to saved card |
| 2.5 | Search input behaviour | Keyboard shows a Search key; no autocapitalising the first letter |

2.2 is the highest-risk item in the whole app. iOS Safari kills SSE connections
on backgrounding, and the recovery path (reconnect on visibility, then re-poll)
is the only reason this works. Test it on an actual iPhone.

---

## Phase 3 — Printing and physical fit (M)

Do this **before** printing a hundred stickers, and before trusting the shell
measurement.

| # | Check | Pass condition |
|---|---|---|
| 3.1 | Library → Print stickers → select all → Stickers | Preview shows 3 across, 3 down on A4 |
| 3.2 | Print one page at **100% scale, "fit to page" off** | — |
| 3.3 | **Measure a printed sticker with calipers** | 60.0 × 90.0 mm, ±0.5 mm |
| 3.4 | Deliberately print again with "fit to page" **on** | Comes out visibly smaller — this is what a wrong print dialog looks like, so you can recognise it |
| 3.5 | Cut one out and offer it to a cartridge shell | Fits the recess; 4 mm corners match |
| 3.6 | Check a poster sticker | Artwork is not cropped — 60 × 90 is 2:3, same as the poster |
| 3.7 | Print a card pinned to an episode | Small `S02E05` badge in the corner; no title caption anywhere |
| 3.8 | Set copies to 10, select 6 cards | Preview says 60 stickers over 7 pages; page 7 is partly empty, not overflowing |
| 3.9 | Set width to 250 mm | Refuses with an explanation rather than producing a broken sheet |

3.3 is the one that matters. If it fails, the cause is almost always the print
dialog scaling, not the app — check 3.4 before changing any dimension.

---

## Phase 4 — Artwork (M)

| # | Check | Pass condition |
|---|---|---|
| 4.1 | Edit a card → artwork options load | Poster, high-resolution poster, background, logo all render |
| 4.2 | Pick the high-resolution poster, save, reopen | Selection persisted |
| 4.3 | Upload a photo from your phone | Appears as "Your image" and is selected |
| 4.4 | Check what was stored | A few hundred KB, not several MB (`ls -la` the add-on's `/data/artwork`) |
| 4.5 | Paste a ThePosterDB poster link | Imports and selects |
| 4.6 | Paste a link to any other site | Rejected with an explanation |
| 4.7 | Change a card's artwork away from an uploaded image, then check `/data/artwork` | The orphaned file is gone |
| 4.8 | Assign the same uploaded image to two cards, delete one | The file survives for the other card |
| 4.9 | Print a sticker using an uploaded image | Sharp at 60 × 90 mm, no visible pixelation |

---

## Phase 4b — Testing playback without the reader (M)

The add-on listens for a Home Assistant event, so the whole chain — detection,
assignment, playback on the real TV — can be exercised before the hardware
exists. Useful for tuning the delays in Phase 6 while the reader is still on the
bench.

**Developer Tools → Events → Fire an event:**

| Field | Value |
|---|---|
| Event type | `esphome.nfc_card_inserted` |
| Event data | `uid: "04-A3-B8-8B-32-02-89"` |

| # | Check | Pass condition |
|---|---|---|
| 4b.1 | Fire the event above | "New cartridge detected" appears in the app, showing that UID |
| 4b.2 | Assign a movie to it | Card appears in the library |
| 4b.3 | Fire the same event again | The show opens on the TV — the full Home → launch → Select sequence |
| 4b.4 | Set removal action to Pause, fire `esphome.nfc_card_removed` with the same `uid` | Playback pauses |
| 4b.5 | Fire an insert with a UID written differently — `04a3b88b320289` | Matches the same cartridge, does not create a second one |
| 4b.6 | Empty that cartridge, then fire its insert again | No playback; it offers to be filled |

Any UID string works. Separators and case are normalised, which is what 4b.5
checks.

For repeated firing, a script is quicker than the Developer Tools form:

```yaml
# Settings → Automations & scenes → Scripts → new script, in YAML mode
alias: Fake cartridge tap
sequence:
  - event: esphome.nfc_card_inserted
    event_data:
      uid: "04-A3-B8-8B-32-02-89"
```

This does **not** replace Phase 5. It exercises everything from Home Assistant
inward, and nothing about the reader itself — the status light, the debounce,
and the
brownout behaviour are only testable on real hardware.

## Phase 4c — Music cartridges (M)

Needs the **Music Assistant** integration set up, with at least one speaker.
Skip this phase entirely if you are not using music cartridges.

Set a **default speaker** under Settings first. Without one, music search
refuses with "No Music Assistant speaker chosen yet" — check 4c.1 is that
refusal, so do it before saving the setting if you want to see it.

| # | Check | Pass condition |
|---|---|---|
| 4c.1 | With no default speaker set, open the Music tab and search | Refuses clearly, naming Settings as the fix — not an empty result list |
| 4c.2 | Set a default speaker; the picker's contents | Only Music Assistant players, not every media player in the house |
| 4c.3 | Search an album you own | Results appear with an **Album** pill and the artist beneath |
| 4c.4 | Search a word matching several kinds | Albums first, then artists, playlists, radio — each labelled |
| 4c.5 | Assign an album, then tap the cartridge | It plays on the default speaker, and **within about a second** — no Home key, no pause, no delay |
| 4c.6 | Lift the cartridge off | Playback pauses and keeps its place |
| 4c.7 | Put it back on | Resumes from where it stopped |
| 4c.8 | Set lift-off to **Stop**, lift it, put it back | Starts the album over |
| 4c.9 | Assign an **artist** cartridge, then open Edit | Shuffle is already on |
| 4c.10 | Play it | Not in album order |
| 4c.11 | Turn on **Keep going afterwards**, play a short album to the end | Carries on with similar music |
| 4c.12 | Set a different speaker on one cartridge, tap it | Plays in that room; other music cartridges still use the default |
| 4c.13 | Tap a video cartridge, then a music one | TV then speaker. Neither device reacts to the other's cartridge |
| 4c.14 | Set the TV lift-off to **Turn the TV off** and music lift-off to **Pause**; lift each | TV powers down; the speaker only pauses |
| 4c.15 | Open Edit on a music cartridge | No episode controls; **Play on the speaker**, not "on the TV" |
| 4c.16 | Switch to the Video tab, select some cartridges, switch to Music | Selection clears — no hidden cartridge can be acted on |

4c.5 is the one worth watching closely. Music deliberately does **not** run the
TV's wake-up sequence, so if you see a pause of several seconds before the music
starts, something is wrong — that delay belongs to video only.

## Phase 4d — Music stickers (M)

| # | Check | Pass condition |
|---|---|---|
| 4d.1 | Print-preview a music sticker set to **Fill** | Cover fills the whole sticker; top and bottom of the artwork are trimmed |
| 4d.2 | Set the same cartridge to **Blurred**, preview again | Whole cover visible and sharp, over a blurred version of itself; no white gaps |
| 4d.3 | Set it to **Colour** | Whole cover on a solid colour that plainly comes from the artwork |
| 4d.4 | Download the Cricut PNG for each of the three | Each matches what the preview showed |
| 4d.5 | Change the artwork, then download again | The new artwork appears — not the previous one from cache |
| 4d.6 | Print one **Blurred** sticker on paper | The blurred area actually prints, rather than coming out white |
| 4d.7 | Mixed sheet: select both video and music cartridges | All print at the same 60 × 90 size |

4d.6 is worth doing on real paper rather than in preview. Browsers drop
backgrounds when printing unless told otherwise, and preview does not always
show it.

## Phase 5 — Firmware bring-up (H)

Do this on the bench with the board on USB, before it goes in an enclosure.

| # | Check | Pass condition |
|---|---|---|
| 5.1 | Confirm the SK6812's VDD goes to **3V3**, not 5V | Checked before first power-on. At 5 V the data threshold is above what the ESP8266 can drive; it will work on the bench and fail later in the case |
| 5.2 | Fit the 470 µF capacitor across 3V3/GND next to the RC522 | Fitted before first power-on |
| 5.3 | Flash from YAML | Compiles and boots. Prebuilt upstream binaries are ESP32 and will not work |
| 5.3a | Log shows `[I][rc522] Device online` after boot | If it shows `[E][rc522] Reset command failed` instead, RST is floating — tie it to 3V3. Everything else (wifi, uptime, the LED) works normally in that state, so nothing points at the reset line |
| 5.4 | Board boots reliably 10 times from cold | No boot loops. Failures here usually mean something is pulling GPIO15 high |
| 5.5 | Press the "Test Light" button in Home Assistant | One white flash |
| 5.5a | Colours are right, not swapped | If red and green are reversed, the LED wants `type: RGB` rather than `GRB`. If it lights but stays white, it is an RGBW part and wants `type: GRBW` |
| 5.6 | Tap a tag | Flashes **immediately** — not after a network round trip |
| 5.7 | Pull the network cable / block wifi, tap a tag | Still flashes. Confirmation the tag was read must not depend on Home Assistant |
| 5.7a | Leave wifi blocked for 30 s | Settles to red, breathing |
| 5.7b | Restore wifi, but stop Home Assistant | Amber, breathing — distinct from both red and ready |
| 5.7c | Start Home Assistant again | Returns to dim white within a few seconds, without a reboot |
| 5.7d | Call `esphome.cartridge_reader_set_status` with `state: playing` from Developer Tools → Actions | Green for about 2 s, then back to dim white |
| 5.7e | Call it with `state: error` | Red, fast pulse, and **stays** — an error should not scroll past while you are in another room |
| 5.7f | Call it with `state: nonsense` | Nothing sticks; the light stays as it was. Older firmware must not strand itself on a state a newer add-on invented |
| 5.8 | Watch Developer Tools → Events for `esphome.nfc_card_inserted` | Fires once per tap, with a `uid` |
| 5.9 | Rest a tag on the reader and leave it for 60 s | **No event storm.** At most one insert event |
| 5.10 | Lift the tag | Exactly one `esphome.nfc_card_removed`, about 0.5 s later |
| 5.11 | Wiggle a tag at the edge of range for 30 s | Does not produce repeated insert/remove pairs |
| 5.12 | Tap tags during wifi transmit bursts, 20 times | No brownouts or resets |

5.9 and 5.11 are what the debounce exists for, and they are invisible in any
software test.

5.7a to 5.7c are the reason the LED exists at all: they are the reader telling
you whether a dead cartridge tap is its fault or the add-on's, without opening a
log. Check they are distinguishable from across the room, not just up close.

---

## Phase 6 — Real install (H)

On the actual HAOS box, installed from the repository URL, not a dev port.

| # | Check | Pass condition |
|---|---|---|
| 6.1 | Add repository → install → start | Starts cleanly; log shows the add-on slug and both event subscriptions |
| 6.1a | **Read the add-on log before opening the panel.** | It ends with `ingress listening on 8099`. If the log stops earlier the container exited, and the panel will return a bare 404 that looks like a Home Assistant problem rather than an add-on one |
| 6.2 | Sidebar shows "Cartridges" | Panel opens |
| 6.3 | Wizard step 1 | Your TV appears in the remote list |
| 6.4 | Wizard step 2, "Send Home to the TV" | **The actual TV reacts** |
| 6.5 | Wizard step 3, tap a cartridge | Detected live |
| 6.6 | Assign and fire it | The show opens on the TV |
| 6.7 | Leave the TV idle until the screensaver, then tap a cartridge | Opens in front of the screensaver, not behind it |
| 6.8 | Tap a cartridge 10 times over a few minutes | Works every time. Any failure means a delay needs raising |
| 6.9 | Restart Home Assistant, wait, tap a cartridge | Works with no intervention |
| 6.10 | Reboot the whole HAOS box, tap a cartridge | Works with no intervention |
| 6.11 | **Watchdog sanity.** After starting, leave the add-on alone for 10 minutes and watch its log | Starts **once** and stays up |

### If 6.11 fails

`config.yaml` sets `watchdog: http://[HOST]:8099/health`, which lets Supervisor
restart the add-on if it stops serving HTTP. If that URL cannot be reached in
your setup, Supervisor will restart a perfectly healthy add-on over and over —
the symptom is the log repeating its startup lines every minute or two.

This could not be verified without a real Supervisor, so check it explicitly. To
confirm the endpoint itself is fine, open `/health` through the sidebar panel —
it should return `{"ok":true}`. If the add-on is restart-looping, delete the
`watchdog:` line from `config.yaml` and rebuild; everything else works without
it.

### Tuning the delays (§11)

Defaults are starting points, not measurements. Tune with 6.7 and 6.8:

- Show opens but sits behind the screensaver, or nothing opens → raise **Wait
  after Home**
- Show opens but nothing starts playing → raise **Wait before Select**
- Something plays but it is the wrong stream → lower **Wait before Select**, or
  turn autoplay off and select by hand

Change one at a time, in 500 ms steps, and re-run 6.8 after each.

---

## Phase 7 — Household reality (H)

The end user is non-technical and never opens the add-on config or the
automation editor.

| # | Check | Pass condition |
|---|---|---|
| 7.1 | Hand the phone to the actual user, ask them to add a cartridge | They finish without help |
| 7.2 | Ask them to open the app from the home-screen icon | Opens straight in, no login prompt, no browser chrome |
| 7.3 | Ask a child to tap a cartridge and watch a show | Works with no adult intervention |
| 7.4 | Tap a cartridge that has no assignment | Nothing breaks; it shows up as unassigned |
| 7.5 | Tap two cartridges in quick succession | Second one wins; nothing hangs |
| 7.6 | Leave a cartridge on the reader overnight | No event storm, no drained log, still responsive next morning |

---

## Phase 8 — Optional: LAN-direct mode (M)

Skip unless you actually want it. Ingress plus a home-screen icon is the
documented default.

| # | Check | Pass condition |
|---|---|---|
| 8.1 | Set `direct_port` to 8100 **without** setting a PIN, restart | Add-on log warns and refuses to open the port. The sidebar app keeps working |
| 8.2 | Set a PIN in Settings | The direct port comes up without an add-on restart |
| 8.3 | Open `http://<ha-ip>:8100/` | PIN prompt |
| 8.4 | Enter the wrong PIN | Rejected |
| 8.5 | Enter the right PIN | App loads; reload does not re-prompt |
| 8.6 | Open the app through the sidebar again | **No PIN prompt** — Home Assistant already authenticated you |

---

## Phase 9 — Regression, after any change

1. Both automated suites (Phase 0)
2. 1.1, 1.3, 1.5 — the core loop through ingress
3. 4c.13 — that video and music still reach different devices
4. 3.1 and 3.3 if anything near printing changed
5. 6.6 on real hardware before calling it done

---

## Recording results

Worth keeping, because most of these values are specific to your house:

- Tuned `home_delay_ms` and `autoplay_delay_ms`, and the TV model they suit
- Measured sticker size from 3.3, and the printer and paper used
- Any UID that behaved oddly, with the tag brand
