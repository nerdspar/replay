import { describe, expect, it, vi } from 'vitest'
import { MusicAssistantProvider } from './musicassistant.js'
import { ProviderUnavailableError } from '../errors.js'
import { card, settings } from '../test/helpers.js'

/**
 * Shaped after what music_assistant.search actually returns: results grouped
 * under plural keys, artists as a list of objects, and cover art sometimes only
 * present in the metadata block.
 */
function searchResponse() {
  return {
    albums: [
      {
        uri: 'library://album/12',
        name: 'Rumours',
        media_type: 'album',
        year: 1977,
        artists: [{ name: 'Fleetwood Mac' }],
        image: 'https://mass.test/rumours.jpg',
      },
    ],
    artists: [
      {
        uri: 'library://artist/3',
        name: 'Fleetwood Mac',
        media_type: 'artist',
        metadata: {
          images: [{ path: 'https://mass.test/fm-thumb.jpg', type: 'thumb' }],
        },
      },
    ],
    playlists: [],
    tracks: [],
    radio: [],
    podcasts: [],
    audiobooks: [],
  }
}

function make(response: unknown = searchResponse(), entryId: string | null = 'entry-1') {
  const callForResponse = vi.fn(async () => response)
  const provider = new MusicAssistantProvider({
    callForResponse: callForResponse as never,
    configEntryId: async () => entryId,
  })
  return { provider, callForResponse }
}

describe('MusicAssistantProvider (§5)', () => {
  it('normalises results into the same shape Stremio produces', async () => {
    const { provider } = make()
    const results = await provider.search('rumours', 'album')

    // Nothing here reveals which provider produced it — that is the seam.
    expect(results).toEqual([
      {
        id: 'library://album/12',
        type: 'album',
        title: 'Rumours',
        year: 'Fleetwood Mac',
        poster: 'https://mass.test/rumours.jpg',
      },
    ])
  })

  it('addresses the search by config entry, not by entity', async () => {
    const { provider, callForResponse } = make()
    await provider.search('rumours', 'album')

    expect(callForResponse).toHaveBeenCalledWith('music_assistant', 'search', {
      config_entry_id: 'entry-1',
      name: 'rumours',
      media_type: ['album'],
      limit: 12,
    })
  })

  it('searches every music type when the caller does not narrow it', async () => {
    const { provider, callForResponse } = make()
    const results = await provider.search('fleetwood', 'movie')

    const data = callForResponse.mock.calls[0]![2] as { media_type: string[] }
    expect(data.media_type).toContain('album')
    expect(data.media_type).toContain('podcast')
    expect(data.media_type).toContain('audiobook')
    // Albums before artists, because a cartridge is most often an album.
    expect(results.map((r) => r.type)).toEqual(['album', 'artist'])
  })

  it('falls back to the metadata image when there is no resolved one', async () => {
    const { provider } = make()
    const results = await provider.search('fleetwood', 'artist')

    expect(results[0]?.poster).toBe('https://mass.test/fm-thumb.jpg')
  })

  it('drops an item with no uri, since there would be nothing to play', async () => {
    const { provider } = make({ albums: [{ name: 'Nameless', media_type: 'album' }] })
    expect(await provider.search('x', 'album')).toEqual([])
  })

  it('says what to do when no speaker has been chosen yet', async () => {
    const { provider } = make(searchResponse(), null)

    await expect(provider.search('rumours', 'album')).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    )
    await expect(provider.search('rumours', 'album')).rejects.toThrow(/pick one in Settings/)
  })

  it('reports a Music Assistant outage rather than returning nothing found', async () => {
    const provider = new MusicAssistantProvider({
      callForResponse: async () => {
        throw new Error('connection refused')
      },
      configEntryId: async () => 'entry-1',
    })

    // "No results" and "the server is down" must not look the same to the user.
    await expect(provider.search('rumours', 'album')).rejects.toThrow(/did not answer/)
  })

  describe('buildLaunch', () => {
    const musicCard = (overrides: Record<string, unknown> = {}) =>
      card({
        kind: 'music',
        provider: 'music_assistant',
        content_type: 'album',
        external_id: 'library://album/12',
        title: 'Rumours',
        ...overrides,
      })

    it('hands over the library item rather than a link to open', async () => {
      const { provider } = make()

      expect(provider.buildLaunch(musicCard(), settings())).toEqual({
        kind: 'media_item',
        value: 'library://album/12',
        mediaType: 'album',
        shuffle: false,
        radioMode: false,
      })
    })

    it('carries the cartridge’s own shuffle and radio mode', async () => {
      const { provider } = make()
      const payload = provider.buildLaunch(
        musicCard({ content_type: 'artist', shuffle: true, radio_mode: true }),
        settings(),
      )

      expect(payload).toMatchObject({ mediaType: 'artist', shuffle: true, radioMode: true })
    })
  })

  describe('getArtwork', () => {
    it('offers the cover of the exact item, matched on uri', async () => {
      const { provider } = make()
      const options = await provider.getArtwork('album', 'library://album/12')

      expect(options).toEqual([
        {
          id: 'cover',
          url: 'https://mass.test/rumours.jpg',
          kind: 'poster',
          label: 'Cover art',
          aspect: 'portrait',
        },
      ])
    })

    it('returns nothing rather than another album’s art when the uri is gone', async () => {
      const { provider } = make()
      expect(await provider.getArtwork('album', 'library://album/999')).toEqual([])
    })
  })

  it('reports an item that has left the library instead of failing silently', async () => {
    const { provider } = make()
    await expect(provider.getMeta('album', 'library://album/999')).rejects.toThrow(
      /no longer has/,
    )
  })
})
