# Cartridge Player

Tap an NFC cartridge on a reader, and the show opens on your TV — or the album
starts playing on your speaker.

## Before you start

You need:

- An NFC reader running the Cartridge Player firmware
  ([instructions](https://github.com/nerdspar/replay))

For **video** cartridges:

- The **Android TV Remote** integration set up for your TV
- **Stremio** installed on the TV

For **music** cartridges:

- The **Music Assistant** integration set up in Home Assistant

You do not need both. Set up whichever you want and the other tab simply stays
empty.

## Setup

Start the add-on and open **Cartridges** in the sidebar. A three-step wizard
walks you through it:

1. **Pick your TV** — from the list of remotes Home Assistant knows about
2. **Test it** — sends the Home button so you can confirm the right TV reacts
3. **Scan your first cartridge** — hold one on the reader and give it a show

There is nothing to configure in the add-on's Configuration tab, and no
automations to create. The add-on listens for the reader itself.

## What is on the reader

Whichever cartridge is currently on the reader appears in a bar at the top of the
library, with what it is doing — playing, paused, or just sitting there — and its
tile is ringed in the grid. The bar sits above the tabs on purpose: the cartridge
in your hand might be a music one while you are looking at video.

## Video and music

The library has two tabs. **Video** cartridges open a show on the TV; **music**
cartridges play on a speaker through Music Assistant. Which one a cartridge is
depends on what you put on it, and it decides everything downstream — which
device it reaches, what lifting it off does, and which tab it appears under.

One reader serves both. Two cartridges tapped a second apart can end up in
different rooms.

Before your first music cartridge, choose a **default speaker** under Settings.
Any single cartridge can override it — an album that belongs in the kitchen
regardless of what everything else does.

## Adding a cartridge to your library

1. Tap an unassigned cartridge on the reader
2. A **New cartridge detected** panel appears in the app
3. Type a title and tap a poster
4. For a series, choose **Whole show** (opens the episode list on the TV) or
   **Pick an episode**
5. Save

**Whole show is usually the right answer.** You pick a stream by hand on the TV
anyway, so the episode list costs one click and the cartridge never goes stale.

## Emptying vs deleting a cartridge

These are different, and the app keeps them apart.

**Empty** clears what a cartridge plays but keeps the cartridge. It stays in your
library showing its tag instead of artwork, and tapping it on the reader offers
to fill it again. Use this when you want to put something else on a cartridge
you still have.

**Delete** removes the cartridge from the library completely — useful when one is
lost, or its tag has stopped working. Nothing is written to the cartridge itself,
so if you find it again, tapping it on the reader adds it straight back.

Both are on the **Edit** screen for a single cartridge, and under **Select** for
several at once. Both ask before doing anything.

## Choosing the artwork

A poster is picked automatically when you assign a cartridge, so nothing slows
down that first minute. To change it, tap **Edit** on a cartridge:

- **Poster — high resolution** is the best choice for printing. It is a larger
  image than the one used on the tiles, which looks thin at sticker size.
- **Background** and **Logo** are alternates the metadata service provides.
- **Episode still** appears only when the cartridge is pinned to one episode.
- **Upload your own** takes a photo or an image file from your phone.
- **Paste a ThePosterDB link** pulls in a poster you picked on
  [theposterdb.com](https://theposterdb.com).

Whatever you choose is what appears on the tile *and* on printed stickers.

### Using ThePosterDB

ThePosterDB has the best artwork for this by a distance — their posters are
print-grade, and typically 2000 × 3000, which is exactly the 2:3 shape of the
cartridge label.

It has no search API and does not allow automated scraping, so the app cannot
look titles up there for you. You browse the site yourself, which is what it is
for:

1. Find the poster you want on [theposterdb.com](https://theposterdb.com)
2. Copy its download link — it looks like
   `https://theposterdb.com/api/assets/123456`
3. In the app, tap **Edit** on a cartridge → **Paste a ThePosterDB link**

The image is fetched once, resized, and kept locally. Only links to that site
are accepted.

### About storage

Images you add are resized in your browser before they are stored — a 2.8 MB
poster becomes about 220 KB, at 1400 px on the long edge. That is roughly 395 DPI
on a 90 mm sticker, sharper than a home printer can resolve, so nothing is lost
on paper. Everything else stays a link, and an image stops being stored the
moment no cartridge uses it.

## Printing stickers

In the library, tap **Print stickers**, choose the cartridges you want, then set
up the sheet.

| Preset | Size | Use |
|---|---|---|
| **Cartridge label** | 60 × 90 mm, 4 mm corners | The cartridge shell. This is the one you want. |
| **Tag dot** | 25 mm round | Labelling the NFC tag itself. |

The cartridge label is exactly 2:3 — the same shape as a movie poster — so
posters print without being cropped.

### Square album covers

Album covers are square, so a third of the sticker's height has to come from
somewhere. Each music cartridge picks its own answer under **Edit → On the
sticker**:

| Choice | What you get |
|---|---|
| **Fill** (default) | Zooms in and trims the top and bottom. Sharpest, but loses the edges — bad for a cover with its title along the bottom. |
| **Blurred** | The whole cover, sharp and centred, over a blurred copy of itself. Nothing is cut off. |
| **Colour** | The whole cover on a block of the cover's own dominant colour. |

All three reach the edges of the sticker; they differ only in what fills the
extra height.

You can also set the size and corner radius by hand in millimetres, change the
page to A4 or US Letter, adjust margins and spacing, and print several copies of
each.

There is no title caption, on purpose: the poster already carries the title, and
a caption bar could only take its space from the artwork, which would crop the
poster. A cartridge pinned to a single episode gets a small episode badge in the
corner instead, since that is the one thing a poster cannot tell you.

**One thing to get right in the print dialog:** set scale to 100% and turn off
"fit to page" (Chrome calls this "Default" vs "Custom" scale; Safari has a
"Scale" box). If the printer is allowed to shrink the page to fit its own
margins, the stickers come out slightly too small and stop matching the shell.

**Cut guides** are dashed lines showing where to cut. They sit exactly on each
sticker's edge and follow its corner radius, so cutting along the line gives you
the size in the table. Turn them off for a clean sheet, or if you are cutting by
machine and would rather register on the artwork.

Sheets default to **US Letter**; A4 is a click away.

### Cutting with a Cricut

Turn on **Cutting with a Cricut** before printing. Print Then Cut prints
registration marks around the design and reads them back, so the design has to
sit inside a smaller box than the page — Cricut's usable area on US Letter is
7.44 × 9.94 in (189 × 252.5 mm). The 10 mm default margin overflows that. The
setting widens the margin to 14 mm, which fits, and turns cut guides off since
the machine does the cutting. You still get six labels to a page.

What you need beyond the machine itself:

- **Printable sticker material** your printer can handle — printable vinyl lasts
  better than paper on something handled daily
- **An Explore or Maker.** Cricut Joy cannot do Print Then Cut at all
- A **StandardGrip mat**, and light-coloured material so the sensor can read the
  registration marks

With the option on, a **Download images for Design Space** button appears. It
saves one PNG per cartridge at true size — 709 × 1063 px for a 60 × 90 mm label,
300 dpi — with the area outside the rounded corners left transparent, which is
how Print Then Cut knows to cut a rounded rectangle rather than a square.

Upload those in Design Space and use Print Then Cut. Your browser may ask
permission to download several files at once.

Printing the sheet instead is for cutting by hand.

## Put it on your phone's home screen

This is the intended way to use the app.

1. In **Settings**, set **Home Assistant address** to the address you normally
   use, for example `https://homeassistant.local:8123`
2. Open **Status** and copy the link shown there
3. Open that link in your phone's browser, then **Share → Add to Home Screen**

The link under Status is stable. The URL in your browser's address bar while
using the sidebar is **not** — it contains a session token that rotates.

## Settings worth knowing

| Setting | What it is for |
|---|---|
| **Wake the TV first** | A link opened on a sleeping TV lands *behind* the screensaver. Pressing Home first dismisses it. |
| **Wait after Home** | How long your TV needs to reach its home screen. Raise it if shows sometimes fail to open. |
| **Start playing automatically** | Stremio opens on the detail page, because a stream still has to be chosen. This presses Select to take the first one. |
| **Wait before Select** | How long Stremio needs to list streams. Too short and it presses Select on an empty page. |
| **When a video cartridge is lifted off** | Do nothing (default), pause, back, home, or turn the TV off. |
| **Default speaker** | Where music cartridges play, unless one names its own. |
| **When a music cartridge is lifted off** | Pause (default), stop, or keep playing. A speaker has no Back or Home, which is why this is a separate setting. |

**Pause and Stop are the difference between carrying on and starting over.**
Lift a cartridge off with Pause and put it back, and it picks up where it
stopped — the add-on checks whether the player is still paused on that
cartridge's own content, and resumes rather than relaunching. With Stop the
queue is cleared, so putting it back starts it again. Nothing to configure: the
two options already mean this.

It resumes by remembering where the player was when you lifted the cartridge
off, and checking it is still there. If something else has been played since,
the cartridge starts properly — losing your place is a much smaller mistake than
playing the wrong thing.

### Music cartridge options

Open **Edit** on a music cartridge for three things video cartridges do not have:

| Option | What it does |
|---|---|
| **Speaker** | Overrides the default for this one cartridge. |
| **Shuffle** | Plays in a random order. Set automatically on artist cartridges, since an artist in album order is rarely what anyone wants. |
| **Keep going afterwards** | When the album ends, carries on with similar music instead of falling silent. |

Music cartridges also choose how their cover meets the sticker — see
[Printing stickers](#printing-stickers).

### If the same player appears twice

Friendly names are not unique, and Music Assistant mirrors players it can send
audio to — so a household running both ends up with two entries called, say,
"Living Room".

The pickers group entities by the integration they came from, and any name that
still appears more than once carries its entity id, so the two are always
distinguishable.

**Pick the one from your TV's own integration.** The Music Assistant copy is for
audio and will not pause the app on screen; the only symptom of choosing it is
that lifting a cartridge off silently does nothing. The app warns you if you
select one.

The two delays are the ones worth tuning against your own hardware. The defaults
are starting points, not measurements.

## Troubleshooting

Open **Status**. It shows the Home Assistant connection state, whether live
updates are flowing, the last error, and the most recent scans.

**Nothing happens when I tap a cartridge.**
Check Status — if Home Assistant shows as disconnected, the add-on cannot hear the
reader. If scans are listed but the TV does nothing, re-run **Test** on the card
from the library and check the error.

**The show opens but never starts playing.**
Raise **Wait before Select**. Stremio had not listed any streams yet.

**The TV wakes up but the show does not open.**
Raise **Wait after Home**.

**A cartridge stopped being recognised after a firmware update.**
It should not — cartridges are matched on a normalised UID, so separators and
letter case do not matter. If it really is unrecognised, assign it again; the
old entry can be removed from the library.

## Advanced: direct LAN access

By default the app is reached through Home Assistant, which handles login. That
is the recommended setup and what the home-screen icon uses.

If you want to reach the app without going through Home Assistant:

1. Set a **PIN** in Settings first
2. Set `direct_port` to `8100` in the add-on's Configuration tab
3. Publish port `8100` in the Network section
4. Restart the add-on

Because this bypasses Home Assistant's authentication entirely, the add-on
**refuses to open the direct port until a PIN is set**. The sidebar app keeps
working either way — that is where you set the PIN.

## Privacy and storage

Poster artwork is loaded by your browser straight from the source; nothing is
cached to disk. The add-on stores only your cartridge list, your settings, and
the last 200 scans.
