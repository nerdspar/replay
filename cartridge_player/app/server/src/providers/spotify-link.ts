import { TtlCache } from './cache.js'
import type { MetaPreview, MusicContentType } from '../types.js'

/**
 * Spotify share links, pasted into the music search box.
 *
 * Searching by name only finds what Music Assistant's search turns up, and a
 * playlist someone made — "Bedtime", "Car songs" — is exactly what that misses:
 * the name is not unique, and other people's playlists are not in the library
 * at all. A share link names one playlist exactly, so it is accepted in place of
 * a search.
 *
 * Nothing here plays anything. The link is turned into the URI Music Assistant
 * itself uses for Spotify items, and Music Assistant's own Spotify provider
 * plays it — so this needs Spotify set up in Music Assistant, and nothing else.
 */

/** Spotify's word for each thing in a link, and what Music Assistant calls it. */
const LINK_TYPES: Record<string, MusicContentType> = {
  playlist: 'playlist',
  album: 'album',
  track: 'track',
  artist: 'artist',
}

/**
 * Public, no key, no auth — the endpoint embed widgets use. It returns a title
 * and a cover for anything that can be shared, which is all a cartridge stores.
 */
export const SPOTIFY_OEMBED = 'https://open.spotify.com/oembed'

const CACHE_TTL_MS = 10 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8000

export interface SpotifyLink {
  type: MusicContentType
  id: string
  /** `spotify://playlist/{id}` — the form Music Assistant resolves itself. */
  uri: string
  /** The canonical https form, which is what oEmbed accepts. */
  shareUrl: string
}

/**
 * Accepts every form the Spotify apps hand out:
 *
 *   https://open.spotify.com/playlist/{id}?si=…
 *   https://open.spotify.com/intl-de/playlist/{id}
 *   https://open.spotify.com/user/{name}/playlist/{id}   (older shares)
 *   spotify:playlist:{id}
 *   spotify://playlist/{id}                              (Music Assistant's own)
 *
 * Returns null for anything else, including a plain search term — which is what
 * lets this sit in front of a search without getting in its way.
 */
export function parseSpotifyLink(input: string): SpotifyLink | null {
  const text = input.trim()

  const match =
    text.match(
      /^(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:user\/[^/?#]+\/)?([a-z]+)\/([A-Za-z0-9]+)(?:[/?#].*)?$/i,
    ) ??
    text.match(/^spotify:([a-z]+):([A-Za-z0-9]+)$/i) ??
    text.match(/^spotify:\/\/([a-z]+)\/([A-Za-z0-9]+)$/i)
  if (!match) return null

  const word = match[1]!.toLowerCase()
  const id = match[2]!
  const type = LINK_TYPES[word]
  if (!type) return null

  return {
    type,
    id,
    uri: `spotify://${type}/${id}`,
    shareUrl: `https://open.spotify.com/${word}/${id}`,
  }
}

interface OEmbedResponse {
  title?: string
  thumbnail_url?: string
}

/** What to call an item oEmbed would not describe. */
const FALLBACK_TITLE: Record<string, string> = {
  playlist: 'Spotify playlist',
  album: 'Spotify album',
  track: 'Spotify track',
  artist: 'Spotify artist',
}

/** Turns a parsed link into a search result, with its title and cover. */
export class SpotifyLinkResolver {
  private readonly cache: TtlCache<MetaPreview>

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    now?: () => number,
  ) {
    this.cache = new TtlCache<MetaPreview>(CACHE_TTL_MS, now)
  }

  /**
   * Never throws. A private playlist has no oEmbed — Spotify answers 404 — yet
   * Music Assistant can still play it from the account that owns it. Refusing
   * it here would turn away the very playlists a household is most likely to
   * paste, so it comes back under a plain name instead, for the label to fix.
   */
  async resolve(link: SpotifyLink): Promise<MetaPreview> {
    const cached = this.cache.get(link.uri)
    if (cached) return cached

    const described = await this.describe(link)
    const preview: MetaPreview = {
      id: link.uri,
      type: link.type,
      title: described?.title?.trim() || FALLBACK_TITLE[link.type] || 'Spotify',
      ...(described?.thumbnail_url ? { poster: described.thumbnail_url } : {}),
    }

    // Only a real answer is kept. A fallback might be a network blip, and
    // caching it would pin the plain name for ten minutes after it recovered.
    if (described) this.cache.set(link.uri, preview)
    return preview
  }

  private async describe(link: SpotifyLink): Promise<OEmbedResponse | null> {
    try {
      const response = await this.fetchImpl(
        `${SPOTIFY_OEMBED}?url=${encodeURIComponent(link.shareUrl)}`,
        {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      if (!response.ok) return null
      return (await response.json()) as OEmbedResponse
    } catch {
      return null
    }
  }
}
