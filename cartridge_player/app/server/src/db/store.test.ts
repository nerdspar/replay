import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Store } from './index.js'
import { memoryStore } from '../test/helpers.js'
import type { CardInput } from '../types.js'
import { DEFAULT_PALETTE } from '../core/reader-light.js'

const input = (overrides: Partial<CardInput> = {}): CardInput => ({
  tag_uid: '04-A3-B8',
  provider: 'stremio',
  content_type: 'movie',
  external_id: 'tt0083658',
  title: 'Blade Runner',
  year: '1982',
  poster_url: null,
  season: null,
  episode: null,
  label: null,
  ...overrides,
})

describe('settings', () => {
  it('starts with the documented defaults (§4)', () => {
    const store = memoryStore()
    expect(store.getSettings()).toEqual({
      id: 1,
      target_type: 'androidtv',
      remote_entity: null,
      media_player_entity: null,
      home_first_enabled: true,
      home_delay_ms: 1500,
      autoplay_enabled: true,
      autoplay_delay_ms: 3000,
      removal_action: 'none',
      music_player_entity: null,
      music_removal_action: 'pause',
      led_enabled: true,
      led_playing_mode: 'hold',
      led_playing_artwork: false,
      led_follow_player: true,
      led_match_cartridge: false,
      led_scope: 'cartridge',
      led_palette: DEFAULT_PALETTE,
      reader_device: null,
      pin_hash: null,
      public_base_url: null,
      setup_complete: false,
    })
    store.close()
  })

  it('stays a single row', () => {
    const store = memoryStore()
    expect(() => store.db.prepare('INSERT INTO settings (id) VALUES (2)').run()).toThrow()
    store.close()
  })

  it('creates the §12 columns but never reads or writes them', () => {
    const store = memoryStore()
    const columns = (
      store.db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]
    ).map((c) => c.name)

    for (const reserved of [
      'jellyfin_url',
      'jellyfin_api_key',
      'jellyfin_user_id',
      'jellyfin_launch_mode',
      'neptune_scheme',
    ]) {
      expect(columns).toContain(reserved)
    }

    // They are not part of the settings the app knows about.
    expect(Object.keys(store.getSettings())).not.toContain('jellyfin_url')

    // And a client cannot write them through the normal path.
    store.updateSettings({ jellyfin_url: 'http://evil' } as never)
    expect(
      store.db.prepare('SELECT jellyfin_url FROM settings WHERE id = 1').get(),
    ).toEqual({ jellyfin_url: null })

    store.close()
  })
})

describe('cards', () => {
  it('round-trips a series card pinned to an episode', () => {
    const store = memoryStore()
    const card = store.createCard(
      input({ content_type: 'series', external_id: 'tt0903747', season: 2, episode: 5 }),
      1000,
    )
    expect(store.getCard(card.id)).toMatchObject({ season: 2, episode: 5, content_type: 'series' })
    store.close()
  })

  it('stores ids rather than a pre-assembled URI (§4)', () => {
    const store = memoryStore()
    const columns = (
      store.db.prepare('PRAGMA table_info(cards)').all() as { name: string }[]
    ).map((c) => c.name)

    expect(columns).toContain('provider')
    expect(columns).toContain('external_id')
    // No column holds a built launch URI — that is assembled at fire time.
    const artwork = ['poster_url', 'original_poster_url']
    const urlish = columns.filter(
      (c) => c.includes('uri') || (c.includes('url') && !artwork.includes(c)),
    )
    expect(urlish).toEqual([])
    store.close()
  })

  it('updates only the fields given, and bumps updated_at', () => {
    const store = memoryStore()
    const card = store.createCard(input(), 1000)
    const updated = store.updateCard(card.id, { label: 'blue cartridge' }, 2000)

    expect(updated).toMatchObject({
      label: 'blue cartridge',
      title: 'Blade Runner',
      created_at: 1000,
      updated_at: 2000,
    })
    store.close()
  })

  it('deletes', () => {
    const store = memoryStore()
    const card = store.createCard(input(), 1000)
    expect(store.deleteCard(card.id)).toBe(true)
    expect(store.deleteCard(card.id)).toBe(false)
    store.close()
  })
})

describe('scan log', () => {
  it('caps at 500 rows, keeping the newest (§4)', () => {
    const store = memoryStore()
    for (let i = 0; i < 620; i++) {
      store.recordScan({
        tag_uid: `04-${i}`,
        matched_card_id: null,
        action_taken: 'unassigned',
        error: null,
        created_at: i,
      })
    }

    const count = store.db.prepare('SELECT COUNT(*) AS n FROM scan_events').get() as { n: number }
    expect(count.n).toBe(500)

    const newest = store.listScans(1)[0]
    expect(newest?.tag_uid).toBe('04-619')

    const oldest = store.db
      .prepare('SELECT tag_uid FROM scan_events ORDER BY id ASC LIMIT 1')
      .get() as { tag_uid: string }
    expect(oldest.tag_uid).toBe('04-120')

    store.close()
  })

  it('returns newest first', () => {
    const store = memoryStore()
    store.recordScan({
      tag_uid: 'a',
      matched_card_id: null,
      action_taken: null,
      error: null,
      created_at: 1,
    })
    store.recordScan({
      tag_uid: 'b',
      matched_card_id: null,
      action_taken: null,
      error: null,
      created_at: 2,
    })
    expect(store.listScans().map((s) => s.tag_uid)).toEqual(['b', 'a'])
    store.close()
  })
})

describe('opening the database', () => {
  it('creates a missing directory rather than refusing to start', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cartridge-db-'))
    const nested = path.join(dir, 'does', 'not', 'exist', 'cartridge.db')

    // better-sqlite3 throws "directory does not exist" on its own, which broke
    // the documented dev workflow on a fresh clone.
    const store = new Store(nested)
    expect(fs.existsSync(nested)).toBe(true)
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
