import { describe, expect, it, vi } from 'vitest'
import { parseSpotifyLink, SpotifyLinkResolver, SPOTIFY_OEMBED } from './spotify-link.js'

const ID = '37i9dQZF1DXcBWIGoYBM5M'

/** Shaped after what Spotify's oEmbed returns, minus the embed markup. */
function oembed() {
  return {
    type: 'rich',
    version: '1.0',
    provider_name: 'Spotify',
    title: "Today's Top Hits",
    thumbnail_url: 'https://image-cdn-ak.spotifycdn.com/image/ab67706f0000000254',
    thumbnail_width: 300,
    thumbnail_height: 300,
  }
}

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

describe('parseSpotifyLink', () => {
  it.each([
    [`https://open.spotify.com/playlist/${ID}`],
    [`https://open.spotify.com/playlist/${ID}?si=04a63c8234ac413e`],
    [`open.spotify.com/playlist/${ID}`],
    [`https://open.spotify.com/intl-de/playlist/${ID}`],
    [`https://open.spotify.com/user/someone/playlist/${ID}`],
    [`spotify:playlist:${ID}`],
    [`spotify://playlist/${ID}`],
    [`  https://open.spotify.com/playlist/${ID}  `],
  ])('reads %s as the same playlist', (input) => {
    expect(parseSpotifyLink(input)).toEqual({
      type: 'playlist',
      id: ID,
      uri: `spotify://playlist/${ID}`,
      shareUrl: `https://open.spotify.com/playlist/${ID}`,
    })
  })

  it('reads albums, tracks and artists too', () => {
    expect(parseSpotifyLink('https://open.spotify.com/album/abc123')?.uri).toBe(
      'spotify://album/abc123',
    )
    expect(parseSpotifyLink('spotify:track:abc123')?.type).toBe('track')
    expect(parseSpotifyLink('https://open.spotify.com/artist/abc123')?.type).toBe('artist')
  })

  it('keeps the id’s case, which Spotify ids depend on', () => {
    expect(parseSpotifyLink('SPOTIFY:PLAYLIST:AbC')?.id).toBe('AbC')
  })

  it.each([
    ['fleetwood mac'],
    ['Spotify playlist'],
    ['https://example.com/playlist/abc'],
    [`https://open.spotify.com/episode/${ID}`],
    ['library://playlist/7'],
  ])('leaves %s to the ordinary search', (input) => {
    expect(parseSpotifyLink(input)).toBeNull()
  })
})

describe('SpotifyLinkResolver', () => {
  const link = parseSpotifyLink(`https://open.spotify.com/playlist/${ID}?si=x`)!

  it('names and covers the playlist from oEmbed', async () => {
    const fetch = respond(oembed())
    const resolver = new SpotifyLinkResolver(fetch as never)

    expect(await resolver.resolve(link)).toEqual({
      id: `spotify://playlist/${ID}`,
      type: 'playlist',
      title: "Today's Top Hits",
      poster: 'https://image-cdn-ak.spotifycdn.com/image/ab67706f0000000254',
    })
    // The share form, with the tracking parameter gone.
    expect(fetch).toHaveBeenCalledWith(
      `${SPOTIFY_OEMBED}?url=${encodeURIComponent(`https://open.spotify.com/playlist/${ID}`)}`,
      expect.anything(),
    )
  })

  it('still offers a private playlist, under a plain name', async () => {
    const resolver = new SpotifyLinkResolver(respond({ error: 'not found' }, 404) as never)

    expect(await resolver.resolve(link)).toEqual({
      id: `spotify://playlist/${ID}`,
      type: 'playlist',
      title: 'Spotify playlist',
    })
  })

  it('does not throw when Spotify cannot be reached', async () => {
    const resolver = new SpotifyLinkResolver((async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }) as never)

    expect((await resolver.resolve(link)).title).toBe('Spotify playlist')
  })

  it('asks once for the same link, but asks again after a failure', async () => {
    const good = respond(oembed())
    const resolver = new SpotifyLinkResolver(good as never)
    await resolver.resolve(link)
    await resolver.resolve(link)
    expect(good).toHaveBeenCalledTimes(1)

    const bad = respond({}, 500)
    const flaky = new SpotifyLinkResolver(bad as never)
    await flaky.resolve(link)
    await flaky.resolve(link)
    expect(bad).toHaveBeenCalledTimes(2)
  })
})
