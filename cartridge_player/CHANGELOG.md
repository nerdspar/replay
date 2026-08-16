# Changelog

## 0.11.1

**Firmware: every scan now says which reader it came from.** Groundwork for
running more than one reader in a house — they all fire the same Home Assistant
event, so without this there is nothing to tell a tap in one room from a tap in
another.

Nothing behaves differently yet. The add-on reads the name and writes it to its
log, so that flashing a reader can be confirmed there rather than by waiting to
see whether some later feature works:

    insert 04-A3-B8 from replay-cartridge-reader

A reader flashed before this still works and is treated as the only reader
there is; its scans log as `from an unnamed reader`.

Reflash for this one. The same flash carries the waiting state from 0.10.0.

## 0.11.0

**Settings is now three tabs — Players, Playback and Light — and every one of
them describes one reader.** That uniformity is groundwork for running more than
one reader in a house: with a reader chosen at the top of the screen, a tab that
quietly ignored it would be a trap.

**Direct access and the PIN moved to Status**, which is where the rest of the
machine-level truth already lives — the connections, the reader, the scan log.
They describe the add-on rather than any one reader, so they do not belong in a
per-reader screen.

**"Add to your home screen" is gone.** The link it produced returned a 404 in
practice, and the same address fed the app manifest, so neither worked. The
manifest now uses a relative start address.

## 0.10.0

**A player that cannot report playback no longer leaves the light looking
broken.** Three related changes, all from one bug that took three rounds to
diagnose.

**A new light state: waiting for you to press play.** A deep link that lands on
a detail page with autoplay off is not idle and not playing, and the light had
no word for it — it showed Ready, which is what an empty reader shows. It now
has its own state, sharing the Playing colour and breathing, so the three
states about the cartridge on the reader read as one family separated by
motion. Like the other two, it can wear the cartridge's own artwork colour.

**The add-on gives up on a player that can never answer.** Many televisions
expose a media player that only ever reports `on` — it has no idea what an app
inside it is doing — and following one forever is not patience, it is a hang.
After four polls of nothing informative, or immediately when Home Assistant
flags the entity as assumed-state, the light reports what the launch did
instead. An `idle` player is still waited on: idle means able to answer and
currently not playing.

**And it says why.** Status now shows, for example, `media_player.sony_tv
reports "on", which is not playback. Showing what the launch did instead.` The
add-on always knew this; leaving it to be inferred from an LED is what made the
original problem so expensive to find.

Firmware carries the new state, so reflash for it.

## 0.9.2

Corrects the **Media player** hint, which said it was "only used for pause and
stop". That stopped being true when **Follow what is actually playing** was
added: the same entity decides when the reader's light shows the playing
colour. The hint now says so, and says what kind of entity is needed — one that
reports `playing` and `paused`, not one that only reports `on` and `off`.

Televisions commonly expose both, and picking the power one leaves the light
sitting on Ready — white — with every other setting correct. The description
made that field look unimportant at exactly the moment it mattered most.

## 0.9.1

**Every entity in a picker now shows its entity id**, and the one you have
chosen is repeated below the list with its current state.

The id used to appear only when two entities shared a friendly name. That is the
wrong test: a television commonly exposes two media players with DIFFERENT
names, one reporting power and one reporting playback, and only the id says
which is which. Neither looked ambiguous, so neither showed its id — and an
entity you had already identified in Developer Tools could not be found in the
list at all.

The current state is there because it is the quickest way to tell those two
apart. A player sitting at `on` cannot report what an app inside it is doing;
one that says `playing` or `idle` can. Choosing the first is how the light ends
up stuck on Ready, which is white.

## 0.9.0

**Spine labels can be set left, centred or right, in one of twelve typefaces.**
The list shows each name in its own face, so it reads as a specimen sheet rather
than twelve identical lines — a native dropdown could not do that, since iOS
Safari ignores styling on its options.

Every face is one already on the machine, so nothing is downloaded and the
printed sheet matches the preview. A face your device does not have falls back
to the nearest it does, which is what the list shows you.

Both are global rather than per cartridge: a shelf wants one typeface, and
picking it thirty times would be the wrong tool. They are also the only two
choices on the print screen that are remembered between visits, because the
preview in **Edit → On the spine** cannot say where a title truncates without
knowing the face it will be set in — Courier fits 31 characters where Impact
fits 37, and at a larger size.

## 0.8.2

**Settings are now four tabs: Players, Playback, Light and Access.** It had
grown to eight sections on one scroll, where the light's colour pickers sat
between the lift-off actions and the PIN field.

Players holds the TV's remote and media player and the default speaker.
Playback holds what a tap does and what lifting a cartridge off does. Light
holds the reader's status light. Access holds the two that are about reaching
this app at all — the address behind the home-screen link, and the direct-access
PIN.

One Save button still covers all four, so it stays below the tabs rather than
moving inside one. A tab holding an unsaved change shows a dot: tabbing hides
pending edits behind the tabs you are not looking at, and without that marker a
change made under Playback is invisible from Players and reads as never having
been made.

## 0.8.1

**Fixed: a cartridge wearing its own colour could light the reader white.**

The colour is stored per cartridge, and a stored one was never looked at again.
So a value written by an earlier release stayed put however wrong it was, and a
near-black one is wrong in a way that is hard to spot: ESPHome normalises an RGB
colour so its brightest channel is full, which turns `#0d1117` into `#90bcff` on
the way to the LED — a pale wash that reads as white. Every layer reported
success.

Two changes. The add-on now checks a colour is bright and saturated enough to
show before sending it, and falls back to the palette colour if not — the
palette is at least a colour. And the library re-samples any stored colour that
fails that check, either replacing it or clearing it, so the data gets corrected
rather than merely ignored.

A cartridge whose cover genuinely has no colour to offer — a dark or
black-and-white one — now correctly shows the palette colour rather than a
wash. That is the artwork having no answer, not the setting failing.

## 0.8.0

**Spine labels.** The strip along the edge of a cartridge, so a shelf of them
can be read without pulling each one out. Turn on **Include spine labels** on
the print screen and each one is laid out directly beneath its own label, so a
cartridge comes out of one print in one piece rather than its two halves
landing on separate sheets. They export for Cricut as well, one PNG each.

60 × 7 mm by default — as wide as the face, because it is the same cartridge.
The background is the artwork's dominant colour, the same one the sticker's
**Colour** option uses, so the two edges of a cartridge match. The text colour
is not fixed: it is black or white depending on what can be read against that
background, because a dominant colour can come back anywhere from near-black to
pale cream.

Seven millimetres holds about 25 characters, so **Edit → On the spine** takes a
shorter name, along with colour overrides and a reset. It shows the spine
life-size, since whether a title fits on 7 mm of cartridge edge is not
something you can judge from a scaled preview. Longer text shrinks until
shrinking stops helping and is then shortened with an ellipsis.

A colour left alone follows the artwork, so replacing a cover updates the spine.
One set by hand stays where it was put.

## 0.7.5

**The print screen is now two tabs: Print & cut by hand, and Cricut.** Each
shows only what its method uses, so nothing on screen is a control your machine
will ignore.

The two methods share almost nothing. Cutting by hand means printing a sheet
laid out here, so page size, margins, gutter, copies and cut guides all matter.
A Cricut is handed one image per sticker and lays out its own sheet in Design
Space, so none of them do. Previously that was a checkbox, which left every
reader working out for themselves which of the surrounding settings still
applied to them, and offered a Print button that produced a sheet a Cricut
cannot use.

Setting the registration margins went with it. Print Then Cut prints its own
marks and can only read back a sheet Design Space printed, so those margins
never reached the machine. What replaces them is a check that actually applies:
a sticker larger than the area Print Then Cut can register is caught before the
images are made, rather than being refused by Design Space afterwards.

## 0.7.4

**Blurred** now shows the whole cover over a blurred copy of itself, rather than
looking like Fill with a blur on it. The blurred layer was painting over the
sharp cover instead of behind it, so the only thing visible was the crop.

Cartridge tiles in the library now follow the same choice as their sticker. A
tile is the same shape as a sticker, so the grid doubles as a look at what you
are about to print.

## 0.7.3

The sticker options — Fill, Blurred and Colour — now show a live preview beside
them, at the real 60 × 90 proportions. They were only ever visible in the print
preview two screens away, which made a working setting feel like a broken one.

If the artwork cannot be read, the preview says so. That failure used to be
swallowed on purpose, because a sticker with a plain border is not worth taking
a whole print sheet down for — but swallowing it also meant no way to tell a
setting that did nothing from artwork that could not be fetched.

## 0.7.2

Editing a playlist cartridge no longer fails with Forbidden. A Music Assistant
id is a URI, and its slashes were being sent through the URL path where Home
Assistant's proxy could reject them. Ids now travel in the query string.

The **Blurred** and **Colour** sticker options now work for music. Music
Assistant serves its covers over plain http from your own network, which the
artwork proxy refused — so both fell back to a white background without saying
why. The same fix restores artwork colours on the reader light for music
cartridges.

Firmware: lifting a cartridge off a reader that is playing nothing no longer
starts it playing. Reflash for that one.

## 0.7.1

Firmware fix. A cartridge left on the reader through a power cut is no longer
played when the power comes back, and the reader now boots exactly as it does
with nothing on it — brief red while it finds wifi, then Ready.

Previous releases tried to tell Home Assistant about that cartridge and made a
meal of it: a flash, a long amber, and eventually playback nobody had asked
for. Lift the cartridge and put it back to play it, the same as any other time.

Lifting a cartridge that was never announced no longer triggers your lift-off
action either, so it cannot pause or switch off something unrelated.

The add-on is unchanged; this release carries the firmware.

## 0.7.0

**Status** now shows whether the reader itself is connected, next to the Home
Assistant connection. They fail independently, and knowing which one is down is
the difference between checking the add-on and going to look at the reader.

Also fixes the reader still ending on a flashing amber when it powers up with a
cartridge already on it. 0.6.1 told Home Assistant about the cartridge as soon
as it connected, which turned out to be too soon — connecting happens before the
client starts listening, so that message was dropped as well. It now keeps
trying until something answers.

The brief red at power-on is not a fault: the reader is saying it has no wifi
yet, which is true for the few seconds before it connects.

Needs the 0.7.0 firmware for the boot fix.

## 0.6.1

Playlists, radio stations, podcasts and audiobooks now carry on from a pause
like albums do. They never could: a playlist cartridge is named for the
playlist, while the player reports whichever track it happens to be on, so
nothing lined up and the whole thing restarted.

The add-on now remembers where the player was when you lifted the cartridge
off, and checks it is still there. If something else has been played since, the
cartridge starts properly.

Also stops the reader showing a flashing amber "nothing answered" when it boots
with a cartridge already sitting on it — the reader reads the tag long before
wifi is up, so the event went nowhere. It now tells Home Assistant about it as
soon as it connects. Needs the 0.6.1 firmware.

## 0.6.0

Putting a paused cartridge back on now carries on from where it stopped,
instead of starting the album again from the first track. That is what the
**Pause** lift-off option always said it did.

It resumes only when the player is genuinely still paused on that cartridge's
own content. If something else is paused, or the player will not say what it
is holding, the cartridge starts properly — losing your place is a much
smaller mistake than playing the wrong thing.

**Stop** is unchanged and still starts over, which is the difference between
the two options.

Video cartridges behave the same way if you have lift-off set to Pause.

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
