import { afterEach, describe, expect, it } from 'vitest'
import { PendingUidStore } from './pending.js'
import { buildServer } from '../http/server.js'
import { EventBus, type AppEvent } from './events.js'
import { testContext, type TestContext } from '../test/context.js'

let active: TestContext | null = null

afterEach(() => {
  active?.cleanup()
  active = null
})

describe('PendingUidStore', () => {
  it('holds the most recent unassigned UID with a timestamp', () => {
    let clock = 1000
    const store = new PendingUidStore(5000, () => clock)

    store.set('04-A3-B8')
    expect(store.get()).toEqual({ uid: '04-A3-B8', seen_at: 1000 })

    clock = 2000
    store.set('04-99-00')
    expect(store.get()).toEqual({ uid: '04-99-00', seen_at: 2000 })
  })

  it('expires after the TTL so a stale UID is not offered days later', () => {
    let clock = 0
    const store = new PendingUidStore(5000, () => clock)
    store.set('04-A3-B8')

    clock = 5000
    expect(store.get()).not.toBeNull()
    clock = 5001
    expect(store.get()).toBeNull()
  })

  it('clears on the normalised UID, however the client echoes it back', () => {
    const store = new PendingUidStore()
    store.set('04-A3-B8')
    store.clear('04a3b8')
    expect(store.get()).toBeNull()
  })

  it('will not let a stale clear drop a newer scan', () => {
    const store = new PendingUidStore()
    store.set('04-A3-B8')
    store.set('04-99-00')
    store.clear('04-A3-B8')
    expect(store.get()?.uid).toBe('04-99-00')
  })
})

describe('recovery after the browser was backgrounded (§8.2)', () => {
  it('serves the UID scanned while the client was away', async () => {
    active = testContext()
    const { ctx } = active
    const app = buildServer(ctx, { requirePin: false })

    // The phone is asleep in a pocket; iOS has already killed the SSE stream.
    await ctx.scans.handleInserted('04-A3-B8-8B-32-02-89')

    // The user opens the app again; the client immediately polls api/pending.
    const response = await app.inject({ method: 'GET', url: '/api/pending' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      pending: { uid: '04-A3-B8-8B-32-02-89' },
    })

    await app.close()
  })

  it('reports no pending UID once the cartridge has been assigned', async () => {
    active = testContext()
    const { ctx } = active
    const app = buildServer(ctx, { requirePin: false })

    await ctx.scans.handleInserted('04-A3-B8-8B-32-02-89')

    await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: {
        tag_uid: '04-A3-B8-8B-32-02-89',
        content_type: 'movie',
        external_id: 'tt0083658',
        title: 'Blade Runner',
      },
    })

    const response = await app.inject({ method: 'GET', url: '/api/pending' })
    expect(response.json()).toMatchObject({ pending: null })

    await app.close()
  })

  it('logs an unassigned scan without treating it as an error', async () => {
    active = testContext()
    const { ctx } = active

    const outcome = await ctx.scans.handleInserted('04-A3-B8')

    expect(outcome.card).toBeNull()
    expect(outcome.scan.error).toBeNull()
    expect(outcome.scan.action_taken).toBe('unassigned')
  })

  it('also reports the connection state, so a dead stream is visible', async () => {
    active = testContext()
    const { ctx } = active
    const app = buildServer(ctx, { requirePin: false })

    ctx.bus.emit({ type: 'connection', state: 'disconnected', detail: 'connection closed' })
    const response = await app.inject({ method: 'GET', url: '/api/pending' })

    expect(response.json()).toMatchObject({
      connection: { state: 'disconnected', detail: 'connection closed' },
    })

    await app.close()
  })
})

describe('EventBus', () => {
  it('delivers to every subscriber and stops after unsubscribe', () => {
    const bus = new EventBus()
    const seen: AppEvent[] = []
    const unsubscribe = bus.subscribe((e) => seen.push(e))

    bus.emit({ type: 'cards' })
    unsubscribe()
    bus.emit({ type: 'cards' })

    expect(seen).toHaveLength(1)
  })

  it('does not let one broken listener take down a scan', () => {
    const bus = new EventBus()
    const seen: AppEvent[] = []
    bus.subscribe(() => {
      throw new Error('client went away mid-write')
    })
    bus.subscribe((e) => seen.push(e))

    expect(() => bus.emit({ type: 'cards' })).not.toThrow()
    expect(seen).toHaveLength(1)
  })
})
