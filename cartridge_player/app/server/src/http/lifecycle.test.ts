/**
 * Unassigning and deleting are different operations on purpose.
 *
 *   unassign — the cartridge still exists and will be reused. Keep it, empty it.
 *   delete   — the cartridge is lost or the tag is damaged. Forget it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { buildServer } from './server.js'
import { SCHEMA_VERSION, migrate } from '../db/schema.js'
import { Store } from '../db/index.js'
import { testContext, type TestContext } from '../test/context.js'
import { FakeProvider, FakeTarget } from '../test/helpers.js'
import type { Card } from '../types.js'

let active: TestContext | null = null

afterEach(() => {
  active?.cleanup()
  active = null
})

function setup() {
  active = testContext()
  const { ctx } = active
  const target = new FakeTarget()
  ctx.providers.register(new FakeProvider())
  ctx.targets.register('fake', () => target)
  ctx.store.updateSettings({
    target_type: 'fake',
    home_delay_ms: 0,
    autoplay_delay_ms: 0,
  })

  const card = ctx.store.createCard(
    {
      tag_uid: '04-A3-B8-8B-32-02-89',
      provider: 'fake',
      content_type: 'movie',
      external_id: 'fake-1',
      title: 'Fake Movie',
      year: '2001',
      poster_url: 'https://example.test/p.jpg',
      season: null,
      episode: null,
      label: null,
    },
    Date.now(),
  )

  return { ctx, target, card }
}

describe('a new card starts assigned', () => {
  it('defaults to assigned without anyone saying so', () => {
    const { card } = setup()
    expect(card.status).toBe('assigned')
  })
})

describe('unassigning', () => {
  it('keeps the cartridge in the library, emptied', async () => {
    const { ctx, card } = setup()
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({
      method: 'POST',
      url: `/api/cards/${card.id}/unassign`,
    })

    expect(response.statusCode).toBe(200)
    expect((response.json() as { card: Card }).card.status).toBe('unassigned')

    // Still there — this is the whole difference from deleting.
    const list = (
      (await app.inject({ method: 'GET', url: '/api/cards' })).json() as { cards: Card[] }
    ).cards
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ status: 'unassigned', tag_uid: '04-A3-B8-8B-32-02-89' })

    await app.close()
  })

  it('stops the cartridge from playing anything', async () => {
    const { ctx, target, card } = setup()
    ctx.store.unassignCard(card.id, Date.now())

    const outcome = await ctx.scans.handleInserted(card.tag_uid)

    // Behaves like a cartridge that was never set up.
    expect(target.calls).toEqual([])
    expect(outcome.scan.action_taken).toBe('unassigned')
    expect(ctx.pending.get()?.uid).toBe(card.tag_uid)
  })

  it('does not try to pause anything when lifted off', async () => {
    const { ctx, target, card } = setup()
    ctx.store.updateSettings({ removal_action: 'pause' })
    ctx.store.unassignCard(card.id, Date.now())

    expect(await ctx.scans.handleRemoved(card.tag_uid)).toBeNull()
    expect(target.calls).toEqual([])
  })

  it('remembers what it used to play, without showing it', async () => {
    const { ctx, card } = setup()
    const emptied = ctx.store.unassignCard(card.id, Date.now())
    expect(emptied?.title).toBe('Fake Movie')
  })
})

describe('refilling an emptied cartridge', () => {
  /** The tag row still exists, so a naive create would collide with itself. */
  it('reuses the existing row instead of colliding on its own tag', async () => {
    const { ctx, card } = setup()
    ctx.store.unassignCard(card.id, Date.now())
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: {
        tag_uid: card.tag_uid,
        provider: 'fake',
        content_type: 'series',
        external_id: 'fake-9',
        title: 'Something Else',
      },
    })

    expect(response.statusCode).toBe(201)
    const updated = (response.json() as { card: Card }).card
    expect(updated.id).toBe(card.id)
    expect(updated.status).toBe('assigned')
    expect(updated.title).toBe('Something Else')

    // One cartridge, not two.
    const list = (
      (await app.inject({ method: 'GET', url: '/api/cards' })).json() as { cards: Card[] }
    ).cards
    expect(list).toHaveLength(1)

    await app.close()
  })

  it('plays again once refilled', async () => {
    const { ctx, target, card } = setup()
    ctx.store.unassignCard(card.id, Date.now())
    const app = buildServer(ctx, { requirePin: false })

    await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: {
        tag_uid: card.tag_uid,
        provider: 'fake',
        content_type: 'movie',
        external_id: 'fake-2',
        title: 'Back Again',
      },
    })
    await ctx.scans.handleInserted(card.tag_uid)

    expect(target.calls).toEqual(['home', 'launch', 'select'])
    await app.close()
  })

  it('restores an emptied cartridge edited through PATCH', async () => {
    const { ctx, card } = setup()
    ctx.store.unassignCard(card.id, Date.now())
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/cards/${card.id}`,
      payload: { external_id: 'fake-3', title: 'Chosen Again' },
    })

    expect((response.json() as { card: Card }).card.status).toBe('assigned')
    await app.close()
  })

  it('editing only a label does not silently refill an emptied cartridge', async () => {
    const { ctx, card } = setup()
    ctx.store.unassignCard(card.id, Date.now())
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/cards/${card.id}`,
      payload: { label: 'blue one' },
    })

    expect((response.json() as { card: Card }).card.status).toBe('unassigned')
    await app.close()
  })

  it('still refuses a tag that is assigned to something else', async () => {
    const { ctx, card } = setup()
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: {
        tag_uid: card.tag_uid,
        provider: 'fake',
        content_type: 'movie',
        external_id: 'fake-9',
        title: 'Nope',
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'uid_taken' })
    await app.close()
  })
})

describe('deleting', () => {
  it('removes the cartridge from the library entirely', async () => {
    const { ctx, card } = setup()
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({ method: 'DELETE', url: `/api/cards/${card.id}` })
    expect(response.statusCode).toBe(200)

    const list = (
      (await app.inject({ method: 'GET', url: '/api/cards' })).json() as { cards: Card[] }
    ).cards
    expect(list).toEqual([])

    await app.close()
  })

  it('frees the tag, so a found cartridge can be set up fresh', async () => {
    const { ctx, card } = setup()
    const app = buildServer(ctx, { requirePin: false })
    await app.inject({ method: 'DELETE', url: `/api/cards/${card.id}` })

    const response = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: {
        tag_uid: card.tag_uid,
        provider: 'fake',
        content_type: 'movie',
        external_id: 'fake-9',
        title: 'Fresh Start',
      },
    })

    expect(response.statusCode).toBe(201)
    await app.close()
  })

  it('404s for a card that is not there', async () => {
    const { ctx } = setup()
    const app = buildServer(ctx, { requirePin: false })
    const response = await app.inject({ method: 'DELETE', url: '/api/cards/9999' })
    expect(response.statusCode).toBe(404)
    await app.close()
  })
})

describe('migrating a database written before music existed', () => {
  /** A v3 database: everything the app shipped with before music cartridges. */
  function v3Database() {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        target_type TEXT NOT NULL DEFAULT 'androidtv',
        remote_entity TEXT, media_player_entity TEXT,
        home_first_enabled INTEGER NOT NULL DEFAULT 1,
        home_delay_ms INTEGER NOT NULL DEFAULT 1500,
        autoplay_enabled INTEGER NOT NULL DEFAULT 1,
        autoplay_delay_ms INTEGER NOT NULL DEFAULT 3000,
        removal_action TEXT NOT NULL DEFAULT 'none',
        pin_hash TEXT, public_base_url TEXT,
        setup_complete INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO settings (id) VALUES (1);
      CREATE TABLE cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_uid TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        content_type TEXT NOT NULL CHECK (content_type IN ('movie', 'series')),
        external_id TEXT NOT NULL, title TEXT NOT NULL,
        year TEXT, poster_url TEXT, original_poster_url TEXT,
        season INTEGER, episode INTEGER, label TEXT,
        status TEXT NOT NULL DEFAULT 'assigned'
          CHECK (status IN ('assigned', 'unassigned')),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO cards (tag_uid, provider, content_type, external_id, title,
                         poster_url, label, status, created_at, updated_at)
      VALUES ('04-01', 'stremio', 'movie', 'tt1', 'Old Card',
              'https://old.test/p.jpg', 'blue one', 'unassigned', 7, 9);
    `)
    db.pragma('user_version = 3')
    return db
  }

  it('calls every existing cartridge a video one, so nothing changes device', () => {
    const db = v3Database()
    migrate(db)

    const row = db.prepare('SELECT * FROM cards').get() as Record<string, unknown>
    expect(row.kind).toBe('video')
    // The rebuild copies rather than recreates: everything else must survive it.
    expect(row).toMatchObject({
      id: 1,
      tag_uid: '04-01',
      title: 'Old Card',
      poster_url: 'https://old.test/p.jpg',
      original_poster_url: null,
      label: 'blue one',
      status: 'unassigned',
      created_at: 7,
      updated_at: 9,
    })
    expect(row.player_entity).toBeNull()
    expect(row.art_fit).toBeNull()
    db.close()
  })

  it('leaves an existing cartridge following its artwork for the spine', () => {
    const db = v3Database()
    migrate(db)

    const row = db.prepare('SELECT * FROM cards').get() as Record<string, unknown>
    // Null, not an empty string. Blank would print a bare coloured strip on
    // every cartridge that predates this; null means "use the title".
    expect(row.spine_text).toBeNull()
    expect(row.spine_color).toBeNull()
    expect(row.spine_text_color).toBeNull()
    db.close()
  })

  it('defaults lifting a music cartridge to pause', () => {
    const db = v3Database()
    migrate(db)

    const row = db.prepare('SELECT * FROM settings').get() as Record<string, unknown>
    expect(row.music_removal_action).toBe('pause')
    expect(row.music_player_entity).toBeNull()
    // The TV's own lift-off setting is untouched by the music one arriving.
    expect(row.removal_action).toBe('none')
    db.close()
  })

  it('keeps the unique index on the normalised uid across the table rebuild', () => {
    const db = v3Database()
    migrate(db)

    // Same physical tag, different formatting. The index is an expression index,
    // so a naive rebuild silently loses it and lets both rows exist.
    expect(() =>
      db
        .prepare(
          `INSERT INTO cards (tag_uid, kind, provider, content_type, external_id,
                              title, created_at, updated_at)
           VALUES ('0401', 'video', 'stremio', 'movie', 'tt2', 'Dup', 1, 1)`,
        )
        .run(),
    ).toThrow()
    db.close()
  })

  it('accepts a music content type the old CHECK constraint forbade', () => {
    const db = v3Database()
    migrate(db)

    expect(() =>
      db
        .prepare(
          `INSERT INTO cards (tag_uid, kind, provider, content_type, external_id,
                              title, created_at, updated_at)
           VALUES ('04-02', 'music', 'music_assistant', 'album', 'library://album/1',
                   'Rumours', 1, 1)`,
        )
        .run(),
    ).not.toThrow()
    db.close()
  })
})

describe('migrating a database written before this existed', () => {
  it('marks every existing cartridge assigned, so nothing stops working', () => {
    const db = new Database(':memory:')
    // A v1 database: cards table with no status column.
    db.exec(`
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        target_type TEXT NOT NULL DEFAULT 'androidtv',
        remote_entity TEXT, media_player_entity TEXT,
        home_first_enabled INTEGER NOT NULL DEFAULT 1,
        home_delay_ms INTEGER NOT NULL DEFAULT 1500,
        autoplay_enabled INTEGER NOT NULL DEFAULT 1,
        autoplay_delay_ms INTEGER NOT NULL DEFAULT 3000,
        removal_action TEXT NOT NULL DEFAULT 'none',
        pin_hash TEXT, public_base_url TEXT,
        setup_complete INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO settings (id) VALUES (1);
      CREATE TABLE cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_uid TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        content_type TEXT NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        year TEXT, poster_url TEXT, season INTEGER, episode INTEGER, label TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO cards (tag_uid, provider, content_type, external_id, title, created_at, updated_at)
      VALUES ('04-01', 'stremio', 'movie', 'tt1', 'Old Card', 1, 1);
    `)
    db.pragma('user_version = 1')

    migrate(db)

    const row = db.prepare('SELECT status FROM cards WHERE tag_uid = ?').get('04-01') as {
      status: string
    }
    expect(row.status).toBe('assigned')
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('is safe to run twice', () => {
    const db = new Database(':memory:')
    migrate(db)
    expect(() => migrate(db)).not.toThrow()
    db.close()
  })

  it('rejects a status the app does not understand', () => {
    active = testContext()
    const store: Store = active.ctx.store
    store.createCard(
      {
        tag_uid: '04-02',
        provider: 'stremio',
        content_type: 'movie',
        external_id: 'tt1',
        title: 'x',
        year: null,
        poster_url: null,
        season: null,
        episode: null,
        label: null,
      },
      1,
    )
    expect(() =>
      store.db.prepare("UPDATE cards SET status = 'nonsense' WHERE tag_uid = '04-02'").run(),
    ).toThrow()
  })
})

/**
 * A card's poster comes from the provider's SEARCH results, and for Cinemeta
 * those are IMDb images — while the artwork picker lists its META endpoint,
 * which returns metahub's. No endpoint can produce the search image again for a
 * known id, so once a card moved off it, it was gone for good.
 */
describe('the artwork a card was created with', () => {
  it('is recorded at creation', () => {
    const { card } = setup()
    expect(card.original_poster_url).toBe('https://example.test/p.jpg')
  })

  it('survives changing the artwork and saving', async () => {
    const { ctx, card } = setup()
    const app = buildServer(ctx, { requirePin: false })

    await app.inject({
      method: 'PATCH',
      url: `/api/cards/${card.id}`,
      payload: { poster_url: 'https://images.metahub.space/poster/medium/tt1/img' },
    })

    const after = ctx.store.getCard(card.id)!
    expect(after.poster_url).toBe('https://images.metahub.space/poster/medium/tt1/img')
    // The way back is still there.
    expect(after.original_poster_url).toBe('https://example.test/p.jpg')

    await app.close()
  })

  it('cannot be overwritten by a client', async () => {
    const { ctx, card } = setup()
    const app = buildServer(ctx, { requirePin: false })

    await app.inject({
      method: 'PATCH',
      url: `/api/cards/${card.id}`,
      payload: { original_poster_url: 'https://evil.test/x.jpg' },
    })

    expect(ctx.store.getCard(card.id)!.original_poster_url).toBe(
      'https://example.test/p.jpg',
    )
    await app.close()
  })

  it('survives emptying and refilling the cartridge', async () => {
    const { ctx, card } = setup()
    ctx.store.unassignCard(card.id, Date.now())
    const app = buildServer(ctx, { requirePin: false })

    await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: {
        tag_uid: card.tag_uid,
        provider: 'fake',
        content_type: 'movie',
        external_id: 'fake-2',
        title: 'Something Else',
        poster_url: 'https://example.test/other.jpg',
      },
    })

    expect(ctx.store.getCard(card.id)!.original_poster_url).toBe(
      'https://example.test/p.jpg',
    )
    await app.close()
  })

  it('backfills existing cards on upgrade rather than leaving them blank', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        target_type TEXT NOT NULL DEFAULT 'androidtv',
        remote_entity TEXT, media_player_entity TEXT,
        home_first_enabled INTEGER NOT NULL DEFAULT 1,
        home_delay_ms INTEGER NOT NULL DEFAULT 1500,
        autoplay_enabled INTEGER NOT NULL DEFAULT 1,
        autoplay_delay_ms INTEGER NOT NULL DEFAULT 3000,
        removal_action TEXT NOT NULL DEFAULT 'none',
        pin_hash TEXT, public_base_url TEXT,
        setup_complete INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO settings (id) VALUES (1);
      CREATE TABLE cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_uid TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL, content_type TEXT NOT NULL,
        external_id TEXT NOT NULL, title TEXT NOT NULL,
        year TEXT, poster_url TEXT, season INTEGER, episode INTEGER, label TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO cards (tag_uid, provider, content_type, external_id, title, poster_url, created_at, updated_at)
      VALUES ('04-01', 'stremio', 'movie', 'tt1', 'Old', 'https://old.test/p.jpg', 1, 1);
    `)
    db.pragma('user_version = 1')

    migrate(db)

    const row = db.prepare('SELECT original_poster_url FROM cards').get() as {
      original_poster_url: string
    }
    expect(row.original_poster_url).toBe('https://old.test/p.jpg')
    db.close()
  })
})

/**
 * A provider id can be anything the provider likes, and Music Assistant's are
 * URIs. Encoded slashes in a path segment are rewritten or rejected by several
 * proxies — Home Assistant's ingress among them — so they belong in the query.
 */
describe('asking about an item whose id is a URI', () => {
  it('takes the id from the query string', async () => {
    active = testContext()
    const { ctx } = active
    ctx.providers.register(new FakeProvider('music_assistant'))
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({
      method: 'GET',
      url: `/api/artwork/music_assistant/playlist?id=${encodeURIComponent('library://playlist/7')}`,
    })

    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('refuses one with no id rather than guessing', async () => {
    active = testContext()
    const app = buildServer(active.ctx, { requirePin: false })

    const response = await app.inject({ method: 'GET', url: '/api/artwork/stremio/movie' })

    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('hands the provider the id intact, slashes and all', async () => {
    active = testContext()
    const { ctx } = active
    const provider = new FakeProvider('music_assistant')
    ctx.providers.register(provider)
    const app = buildServer(ctx, { requirePin: false })

    await app.inject({
      method: 'GET',
      url: `/api/meta/music_assistant/playlist?id=${encodeURIComponent('library://playlist/7')}`,
    })

    // Nothing in the round trip may mangle it: it is the only handle on the item.
    expect(provider.metaCalls.at(-1)?.id).toBe('library://playlist/7')
    await app.close()
  })
})
