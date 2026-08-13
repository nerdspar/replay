import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import { migrate } from './schema.js'
import { SQL_NORMALIZED_UID, normalizeUid } from '../core/uid.js'
import { normalizePalette } from '../core/reader-light.js'
import type {
  ArtFit,
  LedPalette,
  LedPlayingMode,
  LedScope,
  Card,
  CardInput,
  CardKind,
  CardStatus,
  ContentType,
  MusicRemovalAction,
  RemovalAction,
  ScanEvent,
  Settings,
} from '../types.js'
import { kindOfContentType } from '../types.js'

/**
 * How many scans are kept, at roughly 100 bytes each.
 *
 * Count-based rather than time-based on purpose. The log answers "what happened
 * when I tapped that card", and a date rule would empty it after a quiet
 * fortnight — precisely when someone opens Status to find out why nothing has
 * happened. It also governs how long a stray tag lingers under "seen but not
 * assigned", which should likewise be a number of scans, not a date.
 */
/** Tolerates a null column and anything unparseable; defaults fill the gaps. */
function parsePalette(raw: string | null): Partial<LedPalette> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Partial<LedPalette>
  } catch {
    return null
  }
}

const SCAN_LOG_CAP = 500

interface SettingsRow {
  id: 1
  target_type: string
  remote_entity: string | null
  media_player_entity: string | null
  home_first_enabled: number
  home_delay_ms: number
  autoplay_enabled: number
  autoplay_delay_ms: number
  removal_action: string
  music_player_entity: string | null
  music_removal_action: string
  led_enabled: number
  led_playing_mode: string
  led_playing_artwork: number
  led_follow_player: number
  led_match_cartridge: number
  led_scope: string
  led_palette: string | null
  reader_device: string | null
  pin_hash: string | null
  public_base_url: string | null
  setup_complete: number
}

interface CardRow
  extends Omit<
    Card,
    'content_type' | 'status' | 'kind' | 'art_fit' | 'shuffle' | 'radio_mode'
  > {
  content_type: string
  status: string
  kind: string
  art_fit: string | null
  shuffle: number
  radio_mode: number
}

function toSettings(row: SettingsRow): Settings {
  return {
    id: 1,
    target_type: row.target_type,
    remote_entity: row.remote_entity,
    media_player_entity: row.media_player_entity,
    home_first_enabled: row.home_first_enabled !== 0,
    home_delay_ms: row.home_delay_ms,
    autoplay_enabled: row.autoplay_enabled !== 0,
    autoplay_delay_ms: row.autoplay_delay_ms,
    removal_action: row.removal_action as RemovalAction,
    music_player_entity: row.music_player_entity,
    music_removal_action: row.music_removal_action as MusicRemovalAction,
    led_enabled: row.led_enabled !== 0,
    led_playing_mode: row.led_playing_mode as LedPlayingMode,
    led_playing_artwork: row.led_playing_artwork !== 0,
    led_follow_player: row.led_follow_player !== 0,
    led_match_cartridge: row.led_match_cartridge !== 0,
    led_scope: row.led_scope as LedScope,
    // Normalised on the way out so every caller sees all nine states, whatever
    // an older release or a hand-edited row happens to hold.
    led_palette: normalizePalette(parsePalette(row.led_palette)),
    reader_device: row.reader_device,
    pin_hash: row.pin_hash,
    public_base_url: row.public_base_url,
    setup_complete: row.setup_complete !== 0,
  }
}

function toCard(row: CardRow): Card {
  return {
    ...row,
    content_type: row.content_type as ContentType,
    status: row.status as CardStatus,
    kind: row.kind as CardKind,
    art_fit: row.art_fit as ArtFit | null,
    shuffle: row.shuffle !== 0,
    radio_mode: row.radio_mode !== 0,
  }
}

/** Columns a client is allowed to write. Reserved §12 columns are absent by design. */
const WRITABLE_SETTINGS = [
  'target_type',
  'remote_entity',
  'media_player_entity',
  'home_first_enabled',
  'home_delay_ms',
  'autoplay_enabled',
  'autoplay_delay_ms',
  'removal_action',
  'music_player_entity',
  'music_removal_action',
  'led_enabled',
  'led_playing_mode',
  'led_playing_artwork',
  'led_follow_player',
  'led_match_cartridge',
  'led_scope',
  'led_palette',
  'reader_device',
  'pin_hash',
  'public_base_url',
  'setup_complete',
] as const

export type WritableSetting = (typeof WRITABLE_SETTINGS)[number]

export class Store {
  readonly db: Db

  constructor(filename: string) {
    // `/data` always exists under Supervisor, but the documented dev workflow
    // points at ./dev-data, which does not exist in a fresh clone — and
    // better-sqlite3 fails with "directory does not exist" rather than creating
    // it. Cheap to make that just work.
    if (filename !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true })
    }
    this.db = new Database(filename)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    migrate(this.db)
  }

  close(): void {
    this.db.close()
  }

  // -- settings ------------------------------------------------------------

  getSettings(): Settings {
    const row = this.db
      .prepare('SELECT * FROM settings WHERE id = 1')
      .get() as SettingsRow
    return toSettings(row)
  }

  updateSettings(patch: Partial<Record<WritableSetting, unknown>>): Settings {
    const assignments: string[] = []
    const values: unknown[] = []

    for (const key of WRITABLE_SETTINGS) {
      if (!(key in patch)) continue
      const value = patch[key]
      assignments.push(`${key} = ?`)
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value ?? null))
    }

    if (assignments.length > 0) {
      this.db
        .prepare(`UPDATE settings SET ${assignments.join(', ')} WHERE id = 1`)
        .run(...values)
    }
    return this.getSettings()
  }

  // -- cards ---------------------------------------------------------------

  listCards(): Card[] {
    const rows = this.db
      .prepare('SELECT * FROM cards ORDER BY title COLLATE NOCASE ASC')
      .all() as CardRow[]
    return rows.map(toCard)
  }

  getCard(id: number): Card | null {
    const row = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as
      | CardRow
      | undefined
    return row ? toCard(row) : null
  }

  /** Lookup is normalisation-insensitive; storage is not (§10). */
  findCardByUid(uid: string): Card | null {
    const row = this.db
      .prepare(`SELECT * FROM cards WHERE ${SQL_NORMALIZED_UID} = ?`)
      .get(normalizeUid(uid)) as CardRow | undefined
    return row ? toCard(row) : null
  }

  createCard(input: CardInput, now: number): Card {
    const info = this.db
      .prepare(
        `INSERT INTO cards
           (tag_uid, kind, provider, content_type, external_id, title, year,
            poster_url, original_poster_url, season, episode, label,
            player_entity, art_fit, shuffle, radio_mode, accent_color,
            resume_hint, spine_text, spine_color, spine_text_color,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.tag_uid,
        // Derived, never supplied by the client: the content type is the single
        // source of truth for which device a scan reaches.
        kindOfContentType(input.content_type),
        input.provider,
        input.content_type,
        input.external_id,
        input.title,
        input.year,
        input.poster_url,
        // Where this card started. Deliberately absent from updateCard's
        // allow-list, so nothing can overwrite it later.
        input.poster_url,
        input.season,
        input.episode,
        input.label,
        input.player_entity,
        input.art_fit,
        input.shuffle ? 1 : 0,
        input.radio_mode ? 1 : 0,
        input.accent_color,
        input.resume_hint,
        input.spine_text,
        input.spine_color,
        input.spine_text_color,
        now,
        now,
      )
    return this.getCard(Number(info.lastInsertRowid))!
  }

  updateCard(
    id: number,
    patch: Partial<CardInput> & { status?: CardStatus },
    now: number,
  ): Card | null {
    const allowed: (keyof CardInput | 'status')[] = [
      'provider',
      'content_type',
      'external_id',
      'title',
      'year',
      'poster_url',
      'season',
      'episode',
      'label',
      'player_entity',
      'art_fit',
      'shuffle',
      'radio_mode',
      'accent_color',
      'resume_hint',
      'spine_text',
      'spine_color',
      'spine_text_color',
      'status',
    ]
    const assignments: string[] = []
    const values: unknown[] = []
    for (const key of allowed) {
      if (!(key in patch)) continue
      assignments.push(`${key} = ?`)
      const value = patch[key as keyof typeof patch]
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value ?? null))
    }

    // New artwork means the sampled colour describes the old picture. Cleared
    // rather than recomputed here — the server has no image decoder, and the
    // browser fills the blank next time it lists the library.
    if (patch.poster_url !== undefined && patch.accent_color === undefined) {
      assignments.push('accent_color = ?')
      values.push(null)
    }

    // Retyping a card moves it between devices and library tabs, so `kind`
    // follows `content_type` rather than being set independently.
    if (patch.content_type !== undefined) {
      assignments.push('kind = ?')
      values.push(kindOfContentType(patch.content_type))
    }
    if (assignments.length === 0) return this.getCard(id)

    assignments.push('updated_at = ?')
    values.push(now, id)
    this.db
      .prepare(`UPDATE cards SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values)
    return this.getCard(id)
  }

  /**
   * Keeps the cartridge but clears what it plays. Content is retained so
   * reassigning it to the same title stays one tap; nothing shows it unless
   * asked.
   */
  unassignCard(id: number, now: number): Card | null {
    this.db
      .prepare("UPDATE cards SET status = 'unassigned', updated_at = ? WHERE id = ?")
      .run(now, id)
    return this.getCard(id)
  }

  /** Removes the cartridge entirely — for one that is lost or damaged. */
  deleteCard(id: number): boolean {
    return this.db.prepare('DELETE FROM cards WHERE id = ?').run(id).changes > 0
  }

  // -- scan log ------------------------------------------------------------

  /** Rolling, capped at 200. A debugging aid, not history (§4). */
  recordScan(entry: Omit<ScanEvent, 'id'>): ScanEvent {
    const info = this.db
      .prepare(
        `INSERT INTO scan_events (tag_uid, matched_card_id, action_taken, error, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        entry.tag_uid,
        entry.matched_card_id,
        entry.action_taken,
        entry.error,
        entry.created_at,
      )

    this.db
      .prepare(
        `DELETE FROM scan_events
          WHERE id NOT IN (SELECT id FROM scan_events ORDER BY id DESC LIMIT ?)`,
      )
      .run(SCAN_LOG_CAP)

    return this.db
      .prepare('SELECT * FROM scan_events WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as ScanEvent
  }

  /**
   * Forgets every scan of one tag.
   *
   * The "seen but not assigned" strip is derived from this log, so this is what
   * removes a stray tag from it. Deliberately not a permanent block-list:
   * tapping the tag again logs a new scan and it reappears, which is what you
   * want if you dismissed it by mistake.
   */
  deleteScansByUid(uid: string): number {
    return this.db
      .prepare(`DELETE FROM scan_events WHERE ${SQL_NORMALIZED_UID} = ?`)
      .run(normalizeUid(uid)).changes
  }

  listScans(limit = 50): ScanEvent[] {
    return this.db
      .prepare('SELECT * FROM scan_events ORDER BY id DESC LIMIT ?')
      .all(Math.min(limit, SCAN_LOG_CAP)) as ScanEvent[]
  }
}
