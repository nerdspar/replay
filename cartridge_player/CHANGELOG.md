# Changelog

## 0.1.6

The **Mini poster** preset is gone. The two that remain are both grounded in a
real measurement — the cartridge shell and the NTAG215 spec — where that one was
invented.

New **Cutting with a Cricut** option. Print Then Cut prints registration marks
around the design and reads them back, so the design must sit inside a smaller
box than the page: 189 × 252.5 mm on US Letter. The 10 mm default margin
overflowed it. The option sets a 14 mm margin, which fits, and turns cut guides
off since the machine does the cutting — still six labels per page.

## 0.1.5

Sticker sheets default to **US Letter** instead of A4.

**Cut guides now sit exactly on the sticker edge.** They were drawn a millimetre
outside it, so cutting along the line produced a label 2 mm too big in each
direction — enough to stop a 60 × 90 mm label seating in the cartridge recess.

The **Mini poster** preset says what it is actually for: a smaller 2:3 label for
a storage box or shelf, twelve to a page. It is not a second cartridge size and
will not fill the shell.

## 0.1.4

**Play on the TV** has moved off the library tiles and into a cartridge's Edit
screen, where it is a normal thing to do rather than a testing leftover: play
something without getting up to find the cartridge, or check the TV is still
responding. It does exactly what tapping the cartridge does.

Tiles are now just artwork and Edit, which also makes them harder to fire by
accident.

Also fixes the development setup failing on a fresh clone — the database
directory is created if it does not exist, rather than refusing to start.

## 0.1.3

Fixes cartridges opening Stremio but going no further — and, sometimes, playing
whatever was first in Continue Watching.

The deep link was built as `stremio://detail/...` with two slashes. With two,
`detail` is read as the address of the link rather than the start of it, so
Android opened Stremio but the app could not tell which title was meant and
showed its home screen. Three seconds later the "start playing automatically"
key press landed on whatever was highlighted there.

The link now uses the form Stremio documents, `stremio:///detail/...`, so it
opens the right title and the key press does what it was meant to.

## 0.1.2

Updates are now a download instead of a build.

Until now Home Assistant compiled the add-on on your own machine every time —
a compiler toolchain, two npm installs, `better-sqlite3` built from C++ source,
and a web build. That took minutes, and the add-on page showed no progress
because build output does not go there.

CI now publishes prebuilt images, so Supervisor pulls one. That is seconds, and
the progress bar works.

**armv7 (32-bit ARM) is no longer supported.** Home Assistant's own builder has
dropped it — it refuses the architecture outright — so images cannot be produced
for it. 64-bit ARM (`aarch64`) and `amd64` are unaffected. Raspberry Pi 2 and
early Pi 3 installs running 32-bit Home Assistant OS are the ones affected; a
64-bit install works.

## 0.1.1

Fixes the add-on failing to start, which showed up as **404: not found** on the
sidebar panel with nothing to suggest the add-on was at fault.

`run.sh` called `bashio::config` to read the `direct_port` option. Those helpers
are not available in every base image; where they are missing the call failed,
`set -e` exited the script, and the container stopped before it ever listened on
the ingress port — so Home Assistant had nothing to proxy.

The script no longer depends on bashio at all. Add-on options are read straight
from `/data/options.json` by the app, which is all `bashio::config` was doing,
and a missing or malformed file now falls back to defaults instead of stopping
the container.

## 0.1.0

First release.

- Tap an NFC cartridge to open a movie or series on an Android TV via Stremio
- Subscribes to the reader's events over Home Assistant's WebSocket API — no
  automations for the user to create
- Mobile-first web UI served through ingress, installable to a phone's home
  screen as a standalone app
- Three-step first-run wizard: pick the TV, test it, scan a cartridge
- Title search and episode lists from Cinemeta, Stremio's own metadata addon
- Configurable fire sequence: wake the TV first, launch, then auto-select the
  first stream — each step individually skippable, each delay tunable
- Configurable behaviour when a cartridge is lifted off the reader
- "Play on the TV" inside a cartridge's Edit screen, which runs the same thing a tap does — for playing something without fetching the cartridge
- Troubleshooting view with connection state, recent scans, and the stable panel
  link for home-screen setup
- Artwork picker: choose between the poster, a higher-resolution poster, the
  background, the logo, or an episode still — or supply your own, either by
  uploading a file or by pasting a link to a poster on ThePosterDB. Images are
  resized in the browser to 1400 px before storage, which is sharper than a home
  printer resolves at sticker size while staying small on disk
- Print-ready sticker sheets for any selection of cartridges, laid out in
  millimetres on A4 or US Letter, with a 60 × 90 mm / 4 mm-corner cartridge
  label preset measured from the shell, adjustable sizes and spacing, multiple
  copies, and cut guides that follow the corner radius. Cartridges pinned to a
  single episode carry a small episode badge; there is no title caption, since
  the poster already has the title and a caption bar would crop the artwork
- Emptying a cartridge is separate from deleting it: an emptied cartridge stays
  in the library as a bare tag, ready to be filled again, while deleting is for
  one that is lost or broken. Both ask first, in an in-app dialog rather than the
  browser's own
- Library search across title, label, and year, and multi-select for printing,
  emptying, or deleting several cartridges at once
- Entity pickers group by the integration each entity came from, and spell out
  the entity id whenever a friendly name is not unique — so two players called
  "Living Room", one native and one from Music Assistant, can be told apart.
  Choosing a Music Assistant player for pause/stop now warns, since it controls
  audio rather than the app on screen
- "Send Home to the TV" on the Status page, so the TV can be re-tested at any
  time without going to find a cartridge
- Supervisor watchdog against a `/health` endpoint, so a stalled add-on is
  restarted without anyone having to notice
- Optional LAN-direct access, gated behind an app-level PIN

Known limits:

- Stremio and Android TV only. The provider and target seams exist and are
  covered by tests, but only one implementation of each ships.
- No watch history, no "next unwatched", no user accounts.
