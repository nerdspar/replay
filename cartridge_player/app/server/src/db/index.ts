import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import { migrate } from './schema.js'
import { SQL_NORMALIZED_UID, normalizeUid } from '../core/uid.js'
import type {
  Card,
  CardInput,
  CardStatus,
  ContentType,
  RemovalAction,
  ScanEvent,
  Settings,
} from '../types.js'

const SCAN_LOG_CAP = 200

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
  pin_hash: string | null
  public_base_url: string | null
  setup_complete: number
}

interface CardRow extends Omit<Card, 'content_type' | 'status'> {
  content_type: string
  status: string
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
           (tag_uid, provider, content_type, external_id, title, year,
            poster_url, original_poster_url, season, episode, label,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.tag_uid,
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
      'status',
    ]
    const assignments: string[] = []
    const values: unknown[] = []
    for (const key of allowed) {
      if (!(key in patch)) continue
      assignments.push(`${key} = ?`)
      values.push(patch[key as keyof typeof patch] ?? null)
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
