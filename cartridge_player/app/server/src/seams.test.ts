/**
 * §10.1 — required seam tests.
 *
 * These exist to prove a second Provider and a second Target can be added
 * without touching call sites, the schema, or the frontend contract. They are
 * not optional, and they are the reason §12 is only a `register()` call away.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { buildServer } from './http/server.js'
import { UnsupportedPayloadError } from './errors.js'
import { StremioProvider } from './providers/stremio.js'
import { AndroidTvTarget } from './targets/androidtv.js'
import { runFireSequence } from './core/fire-sequence.js'
import { testContext, type TestContext } from './test/context.js'
import {
  FakeProvider,
  FakeTarget,
  MediaUrlProvider,
  RecordingHa,
  card,
  settings,
} from './test/helpers.js'

let active: TestContext | null = null

afterEach(() => {
  active?.cleanup()
  active = null
})

/** A context with the fake provider and fake target registered alongside the real ones. */
function seamContext() {
  active = testContext()
  const { ctx } = active

  const provider = new FakeProvider()
  const target = new FakeTarget()

  ctx.providers.register(provider)
  ctx.targets.register('fake', () => target)

  return { ctx, provider, target }
}

describe('a second Provider slots in with no call-site changes', () => {
  it('registers alongside StremioProvider without displacing the default', () => {
    const { ctx } = seamContext()
    expect(ctx.providers.ids().sort()).toEqual(['fake', 'stremio'])
    // The default is still what the API falls back to (§7).
    expect(ctx.providers.defaultProviderId).toBe('stremio')
    expect(ctx.providers.get('stremio')).toBeInstanceOf(StremioProvider)
  })

  it('serves search through the same route, in the same normalised shape', async () => {
    const { ctx } = seamContext()
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({
      method: 'GET',
      url: '/api/search?q=blade%20runner&type=movie&provider=fake',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json() as { provider: string; results: unknown[] }
    expect(body.provider).toBe('fake')
    expect(body.results[0]).toEqual({
      id: 'fake-1',
      type: 'movie',
      title: 'blade runner (fake)',
      year: '2001',
      poster: 'https://x/p.jpg',
    })

    await app.close()
  })

  it('serves meta and episode lists through the same route', async () => {
    const { ctx } = seamContext()
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({
      method: 'GET',
      url: '/api/meta/fake/series/fake-1',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json() as { meta: { videos: unknown[] } }
    expect(body.meta.videos).toEqual([
      { id: 'fake-1:1:1', season: 1, episode: 1, title: 'Fake Pilot' },
    ])

    await app.close()
  })

  it('assigns and fires a card end to end against the fake provider', async () => {
    const { ctx, target } = seamContext()
    // Real delays, zeroed: this asserts ordering, not timing.
    ctx.store.updateSettings({ target_type: 'fake', home_delay_ms: 0, autoplay_delay_ms: 0 })
    const app = buildServer(ctx, { requirePin: false })

    const created = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: {
        tag_uid: '04-A3-B8-8B-32-02-89',
        provider: 'fake',
        content_type: 'movie',
        external_id: 'fake-1',
        title: 'Fake Title',
      },
    })
    expect(created.statusCode).toBe(201)
    const cardId = (created.json() as { card: { id: number } }).card.id

    const fired = await app.inject({ method: 'POST', url: `/api/cards/${cardId}/test` })
    expect(fired.statusCode).toBe(200)
    expect(fired.json()).toMatchObject({ ok: true })

    // The exact abstract sequence, unchanged by the provider swap.
    expect(target.calls).toEqual(['home', 'launch', 'select'])
    expect(target.launchedWith).toEqual({ kind: 'uri', value: 'fake://open/fake-1' })

    await app.close()
  })

  it('routes a scanned tag to the provider its card names, not to a hardcoded one', async () => {
    const { ctx, target } = seamContext()
    // Real delays, zeroed: this asserts ordering, not timing.
    ctx.store.updateSettings({ target_type: 'fake', home_delay_ms: 0, autoplay_delay_ms: 0 })
    ctx.store.createCard(
      {
        tag_uid: '04-11-22-33',
        provider: 'fake',
        content_type: 'series',
        external_id: 'fake-9',
        title: 'Fake Series',
        year: null,
        poster_url: null,
        season: null,
        episode: null,
        label: null,
      },
      Date.now(),
    )

    const outcome = await ctx.scans.handleInserted('04:11:22:33')

    expect(outcome.card?.title).toBe('Fake Series')
    expect(outcome.scan.error).toBeNull()
    expect(target.launchedWith).toEqual({ kind: 'uri', value: 'fake://open/fake-9' })
  })

  it('rejects an unknown provider at assignment time', async () => {
    const { ctx } = seamContext()
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/cards',
      payload: {
        tag_uid: '04-99',
        provider: 'jellyfin',
        content_type: 'movie',
        external_id: 'x',
        title: 'x',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'unknown_provider' })

    await app.close()
  })
})

describe('a second Target produces the same abstract calls', () => {
  it('drives the identical ordered sequence for the fake and the real target', async () => {
    const fake = new FakeTarget()
    const ha = new RecordingHa()
    const androidTv = new AndroidTvTarget({
      ha,
      remoteEntity: 'remote.tv',
      mediaPlayerEntity: 'media_player.tv',
    })

    const abstractCalls: string[] = []
    const spy = {
      id: 'spy',
      launch: async (p: Parameters<typeof androidTv.launch>[0]) => {
        abstractCalls.push('launch')
        await androidTv.launch(p)
      },
      sendKey: async (k: Parameters<typeof androidTv.sendKey>[0]) => {
        abstractCalls.push(k)
        await androidTv.sendKey(k)
      },
      stop: () => androidTv.stop(),
      pause: () => androidTv.pause(),
    }

    const input = {
      card: card(),
      settings: settings(),
      provider: new StremioProvider(),
      sleep: async () => {},
    }

    await runFireSequence({ ...input, target: fake })
    await runFireSequence({ ...input, target: spy })

    expect(fake.calls).toEqual(['home', 'launch', 'select'])
    expect(abstractCalls).toEqual(fake.calls)
    // Only the concrete vocabulary differs, and only inside the target.
    expect(ha.calls.map((c) => `${c.domain}.${c.service}`)).toEqual([
      'remote.send_command',
      'remote.turn_on',
      'remote.send_command',
    ])
  })

  it('needs no live TV anywhere in the suite', async () => {
    const target = new FakeTarget()
    await runFireSequence({
      card: card(),
      settings: settings(),
      provider: new FakeProvider(),
      target,
      sleep: async () => {},
    })
    expect(target.calls).toHaveLength(3)
  })
})

describe('AndroidTvTarget refuses a media_url payload loudly (§10.1)', () => {
  it('throws a typed, catchable error rather than failing silently', async () => {
    const ha = new RecordingHa()
    const target = new AndroidTvTarget({
      ha,
      remoteEntity: 'remote.tv',
      mediaPlayerEntity: 'media_player.tv',
    })

    // A provider that returns a stream URL — exactly the §12 Jellyfin shape.
    const error = await runFireSequence({
      card: card({ provider: 'media-url' }),
      settings: settings({ home_first_enabled: false, autoplay_enabled: false }),
      provider: new MediaUrlProvider(),
      target,
      sleep: async () => {},
    })
      .then(() => null)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(UnsupportedPayloadError)
    expect((error as UnsupportedPayloadError).code).toBe('unsupported_payload')
    expect(ha.calls).toEqual([])
  })

  it('surfaces the failure through the scan log instead of reporting success', async () => {
    active = testContext()
    const { ctx } = active
    const ha = new RecordingHa()

    ctx.providers.register(new MediaUrlProvider())
    ctx.targets.register(
      'androidtv-test',
      () => new AndroidTvTarget({ ha, remoteEntity: 'remote.tv', mediaPlayerEntity: null }),
    )
    ctx.store.updateSettings({
      target_type: 'androidtv-test',
      home_first_enabled: false,
      autoplay_enabled: false,
    })

    const created = ctx.store.createCard(
      {
        tag_uid: '04-AA',
        provider: 'media-url',
        content_type: 'movie',
        external_id: 'x',
        title: 'Streamy',
        year: null,
        poster_url: null,
        season: null,
        episode: null,
        label: null,
      },
      Date.now(),
    )

    const outcome = await ctx.scans.fire(created)

    expect(outcome.scan.error).toContain('unsupported_payload')
    expect(ctx.lastError?.message).toContain('unsupported_payload')
  })
})
