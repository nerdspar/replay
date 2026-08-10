import { describe, expect, it, vi } from 'vitest'
import { StremioProvider } from './stremio.js'
import { ProviderUnavailableError } from '../errors.js'
import { card, settings } from '../test/helpers.js'
import searchMovie from '../test/fixtures/cinemeta-search-movie.json' with { type: 'json' }
import searchSeries from '../test/fixtures/cinemeta-search-series.json' with { type: 'json' }
import metaMovie from '../test/fixtures/cinemeta-meta-movie.json' with { type: 'json' }
import metaSeries from '../test/fixtures/cinemeta-meta-series.json' with { type: 'json' }

function fetchReturning(body: unknown, ok = true, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: ok ? status : status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch
}

// -- §6.3 URI construction ---------------------------------------------------

describe('buildLaunch', () => {
  const provider = new StremioProvider()
  const s = settings()

  it('builds a movie URI with the id repeated as the video id', () => {
    expect(provider.buildLaunch(card({ content_type: 'movie' }), s)).toEqual({
      kind: 'uri',
      value: 'stremio:///detail/movie/tt0083658/tt0083658',
    })
  })

  it('builds a series URI with an empty video id for the episode list', () => {
    const c = card({ content_type: 'series', external_id: 'tt0903747' })
    expect(provider.buildLaunch(c, s)).toEqual({
      kind: 'uri',
      value: 'stremio:///detail/series/tt0903747/',
    })
  })

  it('builds a series URI pinned to a specific episode', () => {
    const c = card({
      content_type: 'series',
      external_id: 'tt0903747',
      season: 2,
      episode: 5,
    })
    expect(provider.buildLaunch(c, s)).toEqual({
      kind: 'uri',
      value: 'stremio:///detail/series/tt0903747/tt0903747:2:5',
    })
  })

  it('falls back to the episode list when only one of season/episode is set', () => {
    const onlySeason = card({ content_type: 'series', external_id: 'tt1', season: 2 })
    const onlyEpisode = card({ content_type: 'series', external_id: 'tt1', episode: 5 })
    expect(provider.buildLaunch(onlySeason, s).value).toBe('stremio:///detail/series/tt1/')
    expect(provider.buildLaunch(onlyEpisode, s).value).toBe('stremio:///detail/series/tt1/')
  })

  it('handles season 0 and episode 0 as real values, not as missing', () => {
    const c = card({ content_type: 'series', external_id: 'tt1', season: 0, episode: 0 })
    expect(provider.buildLaunch(c, s).value).toBe('stremio:///detail/series/tt1/tt1:0:0')
  })

  it('escapes unusual characters in the external id', () => {
    const c = card({ content_type: 'movie', external_id: 'kitsu:anime/42 x' })
    expect(provider.buildLaunch(c, s).value).toBe(
      'stremio:///detail/movie/kitsu%3Aanime%2F42%20x/kitsu%3Aanime%2F42%20x',
    )
  })

  it('always returns a uri payload, never a media_url', () => {
    expect(provider.buildLaunch(card(), s).kind).toBe('uri')
  })

  /**
   * Three slashes, not two. With `stremio://detail/...` the segment `detail`
   * parses as the URI authority instead of the first path segment: Android
   * still resolves the scheme, so Stremio opens, but the app cannot match the
   * link and shows its home screen — and the autoplay key press then activates
   * whatever happens to be focused there.
   *
   * §6.3 of the spec writes two. Stremio's own documentation writes three:
   * https://stremio.github.io/stremio-addon-sdk/deep-links.html
   */
  it('puts `detail` in the path, not the authority', () => {
    for (const c of [
      card({ content_type: 'movie' }),
      card({ content_type: 'series', external_id: 'tt0903747' }),
      card({ content_type: 'series', external_id: 'tt0903747', season: 2, episode: 5 }),
    ]) {
      const value = provider.buildLaunch(c, s).value
      expect(value.startsWith('stremio:///detail/'), value).toBe(true)

      // The decisive check: parsed as a URI, nothing may sit in the authority.
      const parsed = new URL(value)
      expect(parsed.host, value).toBe('')
      expect(parsed.pathname.startsWith('/detail/'), value).toBe(true)
    }
  })

  it('matches the shapes in Stremio’s published examples', () => {
    // stremio:///detail/movie/tt0066921/tt0066921
    expect(
      provider.buildLaunch(card({ content_type: 'movie', external_id: 'tt0066921' }), s).value,
    ).toBe('stremio:///detail/movie/tt0066921/tt0066921')

    // stremio:///detail/series/tt0108778/tt0108778:1:1
    expect(
      provider.buildLaunch(
        card({ content_type: 'series', external_id: 'tt0108778', season: 1, episode: 1 }),
        s,
      ).value,
    ).toBe('stremio:///detail/series/tt0108778/tt0108778:1:1')
  })
})

// -- §5.1 Cinemeta client ----------------------------------------------------

describe('search', () => {
  it('parses recorded movie search results into normalised previews', async () => {
    const fetchImpl = fetchReturning(searchMovie)
    const provider = new StremioProvider({ fetch: fetchImpl })

    const results = await provider.search('blade runner', 'movie')

    expect(results[0]).toEqual({
      id: 'tt1856101',
      type: 'movie',
      title: 'Blade Runner 2049',
      year: '2017',
      poster: expect.stringContaining('http'),
    })
    // Nothing Cinemeta-shaped leaks through: the frontend must not be able to
    // tell which provider produced a result.
    expect(Object.keys(results[0]!).sort()).toEqual(['id', 'poster', 'title', 'type', 'year'])
  })

  it('hits the verified `top` catalog with an encoded query', async () => {
    const fetchImpl = fetchReturning(searchMovie)
    const provider = new StremioProvider({ fetch: fetchImpl })

    await provider.search('blade runner', 'movie')

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://v3-cinemeta.strem.io/catalog/movie/top/search=blade%20runner.json',
      expect.anything(),
    )
  })

  it('parses series results', async () => {
    const provider = new StremioProvider({ fetch: fetchReturning(searchSeries) })
    const results = await provider.search('breaking bad', 'series')
    expect(results[0]?.type).toBe('series')
    expect(results[0]?.title).toBe('Breaking Bad')
  })

  it('returns nothing for an empty query without calling out', async () => {
    const fetchImpl = fetchReturning(searchMovie)
    const provider = new StremioProvider({ fetch: fetchImpl })
    expect(await provider.search('   ', 'movie')).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('caches within the TTL and refetches after it', async () => {
    const fetchImpl = fetchReturning(searchMovie)
    let clock = 0
    const provider = new StremioProvider({
      fetch: fetchImpl,
      ttlMs: 1000,
      now: () => clock,
    })

    await provider.search('blade runner', 'movie')
    await provider.search('Blade Runner', 'movie')
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    clock = 1001
    await provider.search('blade runner', 'movie')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('drops malformed entries rather than surfacing half-built results', async () => {
    const provider = new StremioProvider({
      fetch: fetchReturning({ metas: [{ id: 'tt1' }, { name: 'no id' }, null] }),
    })
    expect(await provider.search('x', 'movie')).toEqual([])
  })
})

describe('getMeta', () => {
  it('parses a movie', async () => {
    const provider = new StremioProvider({ fetch: fetchReturning(metaMovie) })
    const meta = await provider.getMeta('movie', 'tt0083658')
    expect(meta.title).toBe('Blade Runner')
    expect(meta.videos).toBeUndefined()
  })

  it('normalises series videos and orders them by season then episode', async () => {
    const provider = new StremioProvider({ fetch: fetchReturning(metaSeries) })
    const meta = await provider.getMeta('series', 'tt0903747')

    const ordering = meta.videos!.map((v) => `${v.season}:${v.episode}`)
    // The fixture deliberately lists 1:7 before 1:6, and specials must sort last.
    expect(ordering).toEqual([
      '1:1',
      '1:2',
      '1:3',
      '1:4',
      '1:5',
      '1:6',
      '1:7',
      '2:1',
      '2:2',
      '0:1',
    ])
    expect(meta.videos![0]).toMatchObject({
      id: 'tt0903747:1:1',
      season: 1,
      episode: 1,
      title: 'Pilot',
    })
  })
})

// -- graceful degradation ----------------------------------------------------

describe('when Cinemeta is unreachable', () => {
  it('throws a typed error on a network failure', async () => {
    const provider = new StremioProvider({
      fetch: vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }) as unknown as typeof fetch,
    })

    await expect(provider.search('x', 'movie')).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    )
  })

  it('throws a typed error on a non-2xx response', async () => {
    const provider = new StremioProvider({ fetch: fetchReturning({}, false, 503) })
    await expect(provider.getMeta('movie', 'tt1')).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 503,
    })
  })

  it('throws a typed error on malformed JSON', async () => {
    const provider = new StremioProvider({
      fetch: vi.fn(async () => new Response('<html>nope</html>')) as unknown as typeof fetch,
    })
    await expect(provider.search('x', 'movie')).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    )
  })

  it('throws rather than returning an empty meta when the payload has no meta', async () => {
    const provider = new StremioProvider({ fetch: fetchReturning({}) })
    await expect(provider.getMeta('movie', 'tt1')).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    )
  })
})
