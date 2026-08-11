import type { Database } from 'better-sqlite3'
import { SQL_NORMALIZED_UID } from '../core/uid.js'

export const SCHEMA_VERSION = 8

/**
 * §4. Note the reserved columns on `settings`: they exist so that enabling §12
 * needs no migration. Nothing reads or writes them, and they are never surfaced
 * in the UI.
 */
const V1 = `
CREATE TABLE IF NOT EXISTS settings (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  target_type          TEXT    NOT NULL DEFAULT 'androidtv',
  remote_entity        TEXT,
  media_player_entity  TEXT,
  home_first_enabled   INTEGER NOT NULL DEFAULT 1,
  home_delay_ms        INTEGER NOT NULL DEFAULT 1500,
  autoplay_enabled     INTEGER NOT NULL DEFAULT 1,
  autoplay_delay_ms    INTEGER NOT NULL DEFAULT 3000,
  removal_action       TEXT    NOT NULL DEFAULT 'none',
  pin_hash             TEXT,
  public_base_url      TEXT,
  setup_complete       INTEGER NOT NULL DEFAULT 0,

  -- Reserved for §12. Do not read, write, or surface these.
  jellyfin_url         TEXT,
  jellyfin_api_key     TEXT,
  jellyfin_user_id     TEXT,
  jellyfin_launch_mode TEXT,
  neptune_scheme       TEXT
);

INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS cards (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_uid      TEXT    NOT NULL UNIQUE,
  provider     TEXT    NOT NULL,
  content_type TEXT    NOT NULL CHECK (content_type IN ('movie', 'series')),
  external_id  TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  year         TEXT,
  poster_url   TEXT,
  season       INTEGER,
  episode      INTEGER,
  label        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Expression index: matching is on the normalised UID, storage keeps the UID as
-- reported. Unique so two formattings of one physical tag cannot both be stored.
CREATE UNIQUE INDEX IF NOT EXISTS cards_tag_uid_norm
  ON cards (${SQL_NORMALIZED_UID});

CREATE TABLE IF NOT EXISTS scan_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_uid         TEXT    NOT NULL,
  matched_card_id INTEGER,
  action_taken    TEXT,
  error           TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS scan_events_created_at ON scan_events (created_at DESC);
`

/**
 * Unassigning and deleting are different things, and the original schema had
 * only one of them.
 *
 * Unassign means "this cartridge still exists, it just has nothing on it" — the
 * physical thing is on the shelf and will be reused. Delete means "this
 * cartridge is gone" — lost, or the tag is damaged.
 *
 * The content columns stay NOT NULL, so an unassigned card keeps what it last
 * pointed at. That is deliberate: it makes reassigning it to the same title a
 * single tap, and it is never shown unless the user asks for it.
 */
const V2 = `
ALTER TABLE cards ADD COLUMN status TEXT NOT NULL DEFAULT 'assigned'
  CHECK (status IN ('assigned', 'unassigned'));

CREATE INDEX IF NOT EXISTS cards_status ON cards (status);
`

/**
 * The artwork a card was created with, kept forever.
 *
 * A card's poster is set at assignment time from the provider's SEARCH results.
 * For Cinemeta those come from IMDb, while the artwork picker lists what its
 * META endpoint returns, which is metahub's. They are different images for the
 * same title, and no endpoint returns the IMDb one for a known id — so once a
 * card moved off it, it was unrecoverable.
 *
 * Written once at creation and never updated, so the picker can always offer
 * the way back.
 */
const V3 = `
ALTER TABLE cards ADD COLUMN original_poster_url TEXT;

-- Existing cards: the best guess available is whatever they have now.
UPDATE cards SET original_poster_url = poster_url WHERE original_poster_url IS NULL;
`

/**
 * Music cartridges.
 *
 * `content_type` carried a CHECK naming only movie and series, and SQLite
 * cannot drop a CHECK — so this rebuilds the table rather than altering it.
 * The rebuild is why every column is restated here.
 *
 * `kind` is what the rest of the app branches on, never the provider name
 * (§10.1): it decides which device a scan reaches and which library tab the
 * card appears under. It is derived from the provider's own declared kind at
 * write time, so adding a second music provider needs no change here.
 *
 * `player_entity` overrides the default speaker for one cartridge — the kitchen
 * album that should always play in the kitchen. NULL means "use the default".
 *
 * `art_fit` is a print concern, not a playback one: album covers are square and
 * the sticker is 60x90, so each card records how it wants that reconciled.
 *
 * `shuffle` and `radio_mode` are per cartridge because they belong to the
 * cartridge, not the household: an album wants its running order, an artist
 * almost never does, and radio mode turns a tag into "this, then more like it".
 */
const V4 = `
CREATE TABLE cards_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_uid             TEXT    NOT NULL UNIQUE,
  kind                TEXT    NOT NULL DEFAULT 'video'
                        CHECK (kind IN ('video', 'music')),
  provider            TEXT    NOT NULL,
  content_type        TEXT    NOT NULL CHECK (content_type IN (
                        'movie', 'series',
                        'album', 'playlist', 'artist', 'track',
                        'radio', 'podcast', 'audiobook'
                      )),
  external_id         TEXT    NOT NULL,
  title               TEXT    NOT NULL,
  year                TEXT,
  poster_url          TEXT,
  original_poster_url TEXT,
  season              INTEGER,
  episode             INTEGER,
  label               TEXT,
  status              TEXT    NOT NULL DEFAULT 'assigned'
                        CHECK (status IN ('assigned', 'unassigned')),
  player_entity       TEXT,
  art_fit             TEXT    CHECK (art_fit IN ('crop', 'blur', 'color')),
  shuffle             INTEGER NOT NULL DEFAULT 0,
  radio_mode          INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

INSERT INTO cards_new (
  id, tag_uid, kind, provider, content_type, external_id, title, year,
  poster_url, original_poster_url, season, episode, label, status,
  created_at, updated_at
)
SELECT
  id, tag_uid, 'video', provider, content_type, external_id, title, year,
  poster_url, original_poster_url, season, episode, label, status,
  created_at, updated_at
FROM cards;

DROP TABLE cards;
ALTER TABLE cards_new RENAME TO cards;

CREATE UNIQUE INDEX IF NOT EXISTS cards_tag_uid_norm
  ON cards (${SQL_NORMALIZED_UID});
CREATE INDEX IF NOT EXISTS cards_status ON cards (status);
CREATE INDEX IF NOT EXISTS cards_kind ON cards (kind);

-- Audio has its own device and its own idea of what lifting a cartridge means.
-- "Back" and "Home" are TV keys; a speaker can only keep playing, pause, or stop.
ALTER TABLE settings ADD COLUMN music_player_entity TEXT;
ALTER TABLE settings ADD COLUMN music_removal_action TEXT NOT NULL DEFAULT 'pause';
`

/**
 * Colours for the reader's status light.
 *
 * Stored here rather than on the device because the device holds them in RAM:
 * it has no way to remember them across a reboot, and writing them to its flash
 * every time somebody dragged a colour picker would wear it out. This is the
 * copy of record, pushed to the reader whenever it might have lost it.
 *
 * `led_palette` is JSON keyed by state name, not a packed string. The packed
 * form is a wire format for the last hop; storing it would make a schema out of
 * a transport detail and mean re-encoding to render a settings screen.
 */
const V5 = `
ALTER TABLE settings ADD COLUMN led_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE settings ADD COLUMN led_playing_mode TEXT NOT NULL DEFAULT 'hold';
ALTER TABLE settings ADD COLUMN led_palette TEXT;
ALTER TABLE settings ADD COLUMN reader_device TEXT;
`

/**
 * The colour a cartridge's artwork reads as, so the reader's light can wear it
 * while that cartridge plays.
 *
 * Computed in the browser, not here. The server has no image decoder and adding
 * one to resize a cover it never displays would be a heavy dependency for a
 * cosmetic feature — meanwhile the web app already samples artwork this exact
 * way to fill the background of a square cover on a 2:3 sticker.
 *
 * NULL means "not worked out yet", which is also what a cartridge with no
 * artwork stays. Both fall back to the fixed palette colour.
 */
const V6 = `
ALTER TABLE cards ADD COLUMN accent_color TEXT;
ALTER TABLE settings ADD COLUMN led_playing_artwork INTEGER NOT NULL DEFAULT 0;
`

/**
 * Reading playback from the player instead of assuming a launch worked.
 *
 * The add-on could only ever report what IT did — fire the sequence and get no
 * error — which it called "playing". With autoplay off that is plainly untrue:
 * the deep link lands on a detail page and nothing starts, and the reader sat
 * there claiming playback that had never begun.
 */
const V7 = `
ALTER TABLE settings ADD COLUMN led_follow_player INTEGER NOT NULL DEFAULT 1;
ALTER TABLE settings ADD COLUMN led_match_cartridge INTEGER NOT NULL DEFAULT 0;
`

/**
 * Whether the light is about the reader or about the playing.
 *
 * Both are defensible and the difference only shows when a cartridge is lifted
 * while its music keeps going — which is a setting of its own, so the two
 * belong together. Defaults to the reader, because that is the narrower claim:
 * the light is on the reader, and can always be trusted to describe it.
 */
const V8 = `
ALTER TABLE settings ADD COLUMN led_scope TEXT NOT NULL DEFAULT 'cartridge';
`

export function migrate(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current < 1) {
    db.exec(V1)
  }
  if (current < 2) {
    db.exec(V2)
  }
  if (current < 3) {
    db.exec(V3)
  }
  if (current < 4) {
    // Rebuilds `cards`, so it must not be half-applied on a crash.
    db.transaction(() => db.exec(V4))()
  }
  if (current < 5) {
    db.exec(V5)
  }
  if (current < 6) {
    db.exec(V6)
  }
  if (current < 7) {
    db.exec(V7)
  }
  if (current < 8) {
    db.exec(V8)
  }
  // Future migrations append here, guarded on `current`.
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
}
