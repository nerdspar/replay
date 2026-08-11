# Changelog

## 0.5.3

**The light is about** is a new choice under Settings → Reader light.

*The cartridge* — lifting one off returns the reader to idle, whatever is still
playing. *What is playing* — the light stays with it until the music stops,
which pairs with setting music lift-off to keep playing.

It only makes a difference when you lift a cartridge off while its music
continues. Either way, the bar at the top of the library shows what is actually
in the reader.

## 0.5.2

Lifting a cartridge off while it was still starting could leave the reader
stuck on the playing colour with nothing in the slot. A launch is not instant —
a Music Assistant album can take seconds to resolve — and finishing one for a
cartridge you have already taken off no longer lights the reader for it.

The light describes the reader, not the room: if you have music set to keep
playing after a lift-off, it still carries on, and the reader still goes back
to idle.

Also needs the 0.5.1 firmware, which stops the amber flash partway through
starting an album. If you have not reflashed since, do that too.

## 0.5.1

Firmware fix. Scanning a cartridge that is not set up yet showed white
breathing and then a flashing amber "nothing answered", when the add-on had in
fact answered immediately.

The reply arrives in about 50 ms — inside the 120 ms read flash — so the reader
was overwriting a status it had already received and then waiting for it all
over again. It now checks before it starts waiting.

Also stops the Test Light button ending in that same amber. Nothing was asked
of the add-on, so nothing was owed.

The add-on itself is unchanged; this release exists to carry the firmware fix.

## 0.5.0

The library now shows which cartridge is on the reader, in a bar at the top,
along with whether it is playing or paused. Its tile is ringed in the grid too.

Green now means something is genuinely playing. It used to mean "the cartridge
was launched", which is not the same thing — with **Start playing
automatically** off, a deep link lands on Stremio's detail page and nothing
starts, and the reader claimed playback that had never begun. It reads the
media player instead, so navigating away without pressing play returns the
light to Ready.

That needs a media player chosen under Your TV. Without one, or with **Follow
what is actually playing** switched off, the old behaviour stands.

Paused has its own colour — the Playing colour dimmed, by default.

Also fixes brightness sliders in Reader light being different lengths
depending on how long each description was.

Needs the 0.5.0 firmware for the paused colour; older firmware keeps its
default for it and everything else still works.

## 0.4.0

A playing cartridge can now light the reader in a colour taken from its own
artwork. Turn on **Use the cartridge's own colour** under Settings → Reader
light.

The colour is picked for a light rather than for a sticker: a poster that is
mostly black with one vivid element lights up in that element, not in the black.
Black and white artwork keeps the fixed colour, since there is nothing to
borrow.

Your browser works the colours out the first time it lists your library, and
again whenever you change a cartridge's artwork. There is nothing to trigger.

Needs the 0.4.0 firmware for the artwork colours; without it the reader keeps
using the fixed Playing colour rather than failing.

## 0.3.0

The reader's status light now says what a cartridge did, not just that it was
read. Green when something starts, blue when a cartridge has nothing on it yet,
red when a launch fails.

Every colour and brightness is yours under **Settings → Reader light**, each
with a reset button, along with a choice of whether a playing cartridge keeps
the light on or just confirms briefly.

Two new states come from the reader itself. It now shows a slow white breathe
while it waits to hear what happened, and a fast amber pulse if nothing answers
at all — which is the one failure this add-on can never report, because the
usual cause is that it is not running.

Needs the 0.3.0 firmware. An older reader keeps working; it simply ignores the
new colours.

## 0.2.0

Music cartridges. Tapping one plays an album, artist, playlist, radio station,
podcast or audiobook on a speaker through Music Assistant, while video
cartridges carry on going to the television — the same reader now serves both.

The library is split into Video and Music tabs. Set a default speaker under
Settings, and any single cartridge can override it if it belongs in another
room. Music cartridges also carry their own shuffle and a "keep going
afterwards" option, and lifting one pauses by default rather than reaching for
a TV remote.

Album covers are square and the sticker is not, so each music cartridge chooses
how to reconcile that: fill and crop, or show the whole cover over a blurred or
colour-matched background.

Recent scans now shows twenty at a time with a Load more button, and keeps the
last five hundred rather than the last two hundred.

Music cartridges need the Music Assistant integration set up in Home Assistant.

## 0.1.13

Adds "Turn the TV off" to the choices under "When a cartridge is lifted off".

## 0.1.12

Adds an x to each tag under "Seen but not assigned", for when you have held more
tags on the reader than you meant to. Forgetting one only clears it from that
list — hold the tag on the reader again and it comes back.

Also softens the wiring note about the reader's RST pin: most modules do not
need it connected, but some need a jumper from RST to 3V3, which shows up as
"Reset command failed" in the ESPHome log.

## 0.1.11

No user-visible change. Fixes the release process, which had started failing to
publish for 64-bit ARM — the architecture most Home Assistant boxes run.

The image was compiling all of its JavaScript inside an emulated ARM container.
That reliably hung: two of six ARM builds stalled and were killed, publishing the
release for Intel only, which is what makes an update fail with "an unknown error
occurred". The JavaScript is now compiled once on the build machine, since it is
identical on every architecture.

## 0.1.10

Fixes the Design Space download keeping the old artwork after you changed it.
The printed sheet updated; the exported PNG did not.

The export loads a cartridge's artwork from a fixed address whose contents
change, and the browser was holding on to the copy it fetched the first time.
The address now carries the cartridge's last-changed time, so a new image is
fetched whenever the artwork actually changes.

## 0.1.9

**Download images for Design Space.** Cricut imports images, not printed pages,
so with the Cricut option on you can now save one PNG per cartridge at true
size — 709 × 1063 px for a 60 × 90 mm label at 300 dpi — with the corners left
transparent so Print Then Cut cuts the rounded shape rather than a square.

Turning the Cricut option on now also disables the cut guides control rather
than only unticking it, since guides must not be printed when the machine is
cutting.

## 0.1.8

The artwork a cartridge started with is now kept permanently and always offered
as **Original**, so changing it is no longer a one-way door.

0.1.7 showed the artwork in use, but once you picked something else and saved,
the one you started with was gone — nothing recorded it, and it cannot be looked
up again. It comes from the search results when a cartridge is first assigned,
and no metadata lookup returns that same image for a title afterwards. It is now
stored on the cartridge itself.

Cartridges created before this upgrade keep whatever artwork they have now as
their original.

## 0.1.7

The artwork a cartridge is already using now appears in the picker, labelled
**Current**, and stays there while you look at the others — so choosing one and
changing your mind no longer loses the original.

It was missing because a cartridge's poster is set when you assign it, from the
search results, and those come from IMDb — while the artwork list comes from a
different endpoint that returns metahub's art. Same title, genuinely different
images. The one you were looking at was often absent from the list beneath it.

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
