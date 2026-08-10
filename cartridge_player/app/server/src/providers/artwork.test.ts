import { afterEach, describe, expect, it, vi } from 'vitest'
import { StremioProvider } from './stremio.js'
import { buildServer } from '../http/server.js'
import { testContext, type TestContext } from '../test/context.js'
import { FakeProvider } from '../test/helpers.js'
import metaSeries from '../test/fixtures/cinemeta-meta-series.json' with { type: 'json' }
import metaMovie from '../test/fixtures/cinemeta-meta-movie.json' with { type: 'json' }

let active: TestContext | null = null

afterEach(() => {
  active?.cleanup()
  active = null
})

const fetchReturning = (body: unknown) =>
  vi.fn(async () =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch

describe('StremioProvider.getArtwork', () => {
  it('offers a high-resolution poster ahead of the small one', async () => {
    const provider = new StremioProvider({ fetch: fetchReturning(metaSeries) })
    const options = await provider.getArtwork('series', 'tt0903747')

    expect(options[0]).toEqual({
      id: 'poster-hi',
      url: 'https://images.metahub.space/poster/medium/tt0903747/img',
      kind: 'poster',
      label: 'Poster — high resolution',
      aspect: 'portrait',
    })
    // The small poster prints thin at sticker sizes, so it is not the default.
    expect(options[1]?.url).toBe('https://images.metahub.space/poster/small/tt0903747/img')
  })

  it('includes background and logo when the provider has them', async () => {
    const provider = new StremioProvider({ fetch: fetchReturning(metaSeries) })
    const options = await provider.getArtwork('series', 'tt0903747')

    expect(options.map((o) => o.kind)).toEqual(
      expect.arrayContaining(['poster', 'background', 'logo']),
    )
    expect(options.find((o) => o.kind === 'background')?.aspect).toBe('landscape')
  })

  it('adds the episode still only for a card pinned to that episode', async () => {
    const provider = new StremioProvider({ fetch: fetchReturning(metaSeries) })

    const whole = await provider.getArtwork('series', 'tt0903747')
    expect(whole.some((o) => o.kind === 'episode')).toBe(false)

    const pinned = await provider.getArtwork('series', 'tt0903747', { season: 1, episode: 2 })
    const still = pinned.find((o) => o.kind === 'episode')
    expect(still?.url).toContain('episodes.metahub.space')
    expect(still?.label).toBe('Episode still — S01E02')
  })

  it('ignores an episode that does not exist', async () => {
    const provider = new StremioProvider({ fetch: fetchReturning(metaSeries) })
    const options = await provider.getArtwork('series', 'tt0903747', { season: 9, episode: 9 })
    expect(options.some((o) => o.kind === 'episode')).toBe(false)
  })

  it('works for a movie', async () => {
    const provider = new StremioProvider({ fetch: fetchReturning(metaMovie) })
    const options = await provider.getArtwork('movie', 'tt0083658')
    expect(options.length).toBeGreaterThan(1)
    expect(options.every((o) => o.url.startsWith('https://'))).toBe(true)
  })

  it('never offers the same image twice', async () => {
    const provider = new StremioProvider({ fetch: fetchReturning(metaSeries) })
    const urls = (await provider.getArtwork('series', 'tt0903747')).map((o) => o.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('skips metahub for an id it cannot resolve', async () => {
    const provider = new StremioProvider({
      fetch: fetchReturning({ meta: { id: 'kitsu:42', name: 'Anime', type: 'series' } }),
    })
    const options = await provider.getArtwork('series', 'kitsu:42')
    expect(options.some((o) => o.url.includes('metahub'))).toBe(false)
  })
})

describe('artwork over HTTP', () => {
  it('serves options through the provider-agnostic route', async () => {
    active = testContext()
    const { ctx } = active
    ctx.providers.register(new FakeProvider())
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({
      method: 'GET',
      url: '/api/artwork/fake/movie/fake-1',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      provider: 'fake',
      options: [
        {
          id: 'poster',
          url: 'https://fake.example/fake-1/poster.jpg',
          kind: 'poster',
          label: 'Poster',
          aspect: 'portrait',
        },
      ],
    })

    await app.close()
  })

  it('rejects an unknown provider', async () => {
    active = testContext()
    const app = buildServer(active.ctx, { requirePin: false })

    const response = await app.inject({
      method: 'GET',
      url: '/api/artwork/jellyfin/movie/x',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'unknown_provider' })

    await app.close()
  })
})
