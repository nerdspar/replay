import { ProviderUnavailableError } from '../errors.js'
import type {
  ArtworkOption,
  Card,
  ContentType,
  LaunchPayload,
  Meta,
  MetaPreview,
  Provider,
  Settings,
} from '../types.js'

/**
 * The kinds of thing Music Assistant can search for, in the order a person
 * scanning them would want to see. Albums first because an album is what a
 * cartridge most naturally is.
 */
const MUSIC_TYPES = [
  'album',
  'artist',
  'playlist',
  'track',
  'radio',
  'podcast',
  'audiobook',
] as const

type MusicType = (typeof MUSIC_TYPES)[number]

/** Response keys, which are plurals of the media types — with one irregular. */
const RESPONSE_KEY: Record<MusicType, string> = {
  album: 'albums',
  artist: 'artists',
  playlist: 'playlists',
  track: 'tracks',
  // Not "radios".
  radio: 'radio',
  podcast: 'podcasts',
  audiobook: 'audiobooks',
}

const SEARCH_LIMIT = 12

/** How many results to ask for when the caller wants everything at once. */
const MIXED_SEARCH_LIMIT = 5

interface MassItem {
  uri?: string
  name?: string
  image?: string | null
  media_type?: string
  version?: string
  year?: number
  artists?: { name?: string }[]
  artist?: { name?: string } | string
  album?: { name?: string } | string
  metadata?: { images?: { path?: string; type?: string; remotely_accessible?: boolean }[] }
}

/** What this provider needs from Home Assistant. Narrow on purpose (§5). */
export interface MusicAssistantDeps {
  /** Calls a service that answers back, i.e. with `return_response`. */
  callForResponse<T>(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<T>
  /**
   * The Music Assistant instance to search. Resolved from the speaker chosen in
   * Settings, because the search action is addressed by config entry, not by
   * entity. Null when no speaker has been picked yet.
   */
  configEntryId(): Promise<string | null>
}

function isMusicType(type: string): type is MusicType {
  return (MUSIC_TYPES as readonly string[]).includes(type)
}

/** "Fleetwood Mac" from whichever of the several shapes the item uses. */
function artistName(item: MassItem): string | undefined {
  if (Array.isArray(item.artists) && item.artists.length > 0) {
    const names = item.artists.map((a) => a?.name).filter(Boolean)
    if (names.length > 0) return names.join(', ')
  }
  if (typeof item.artist === 'string') return item.artist
  if (item.artist?.name) return item.artist.name
  return undefined
}

/**
 * Cover art, preferring an image Home Assistant can actually reach.
 *
 * `remotely_accessible: false` marks an image that only exists behind the Music
 * Assistant server's own proxy. `image` is the pre-resolved one, so it is tried
 * first and the metadata list is the fallback.
 */
function coverArt(item: MassItem): string | undefined {
  if (item.image) return item.image
  const images = item.metadata?.images ?? []
  const thumb = images.find((i) => i?.type === 'thumb' && i.path) ?? images.find((i) => i?.path)
  return thumb?.path ?? undefined
}

/**
 * §5 — a second Provider, alongside Stremio, whose results are normalised into
 * the same `MetaPreview` shape. The frontend cannot tell which one produced a
 * result, which is what lets one library hold films and albums.
 */
export class MusicAssistantProvider implements Provider {
  readonly id = 'music_assistant'

  constructor(private readonly deps: MusicAssistantDeps) {}

  async search(query: string, type: ContentType): Promise<MetaPreview[]> {
    // A caller asking for a video type has the wrong provider; answering with
    // albums would be worse than answering with nothing.
    const types: MusicType[] = isMusicType(type) ? [type] : [...MUSIC_TYPES]
    const single = types.length === 1

    const response = await this.call<Record<string, MassItem[]>>('search', {
      name: query,
      media_type: types,
      limit: single ? SEARCH_LIMIT : MIXED_SEARCH_LIMIT,
    })

    const results: MetaPreview[] = []
    for (const musicType of types) {
      const items = response?.[RESPONSE_KEY[musicType]] ?? []
      for (const item of items) {
        const preview = this.toPreview(item, musicType)
        if (preview) results.push(preview)
      }
    }
    return results
  }

  /**
   * There is no metadata endpoint to call: a search result already carries
   * everything a cartridge stores, and the URI is opaque to us. Looking it up
   * again would be a second round trip for the same fields.
   */
  async getMeta(type: string, id: string): Promise<Meta> {
    const [item] = await this.lookup(id, type)
    if (!item) {
      throw new ProviderUnavailableError(
        this.id,
        `Music Assistant no longer has "${id}". It may have been removed from the library.`,
      )
    }
    return item
  }

  async getArtwork(type: string, id: string): Promise<ArtworkOption[]> {
    const [item] = await this.lookup(id, type)
    if (!item?.poster) return []

    return [
      {
        id: 'cover',
        url: item.poster,
        kind: 'poster',
        label: 'Cover art',
        // Square, but the picker only takes this as a shape hint and covers are
        // closer to portrait than to a 16:9 still.
        aspect: 'portrait',
      },
    ]
  }

  /**
   * No deep link and no URL: the target hands the item to Music Assistant,
   * which resolves it against whichever streaming provider owns it. That is why
   * this is `media_item` rather than `uri` — the value means nothing outside
   * Music Assistant.
   */
  buildLaunch(card: Card, _settings: Settings): LaunchPayload {
    return {
      kind: 'media_item',
      value: card.external_id,
      mediaType: card.content_type,
      shuffle: card.shuffle,
      radioMode: card.radio_mode,
    }
  }

  /**
   * Finds one item again by its URI. Search is the only read available, and it
   * matches on name — so this searches by name and filters back to the URI.
   */
  private async lookup(uri: string, type: string): Promise<MetaPreview[]> {
    const name = decodeURIComponent(uri).split('/').pop() ?? uri
    const musicType = isMusicType(type) ? type : undefined

    const response = await this.call<Record<string, MassItem[]>>('search', {
      name,
      ...(musicType ? { media_type: [musicType] } : {}),
      limit: SEARCH_LIMIT,
    })

    const items = Object.values(response ?? {}).flat()
    return items
      .filter((item) => item?.uri === uri)
      .map((item) => this.toPreview(item, (musicType ?? item.media_type ?? 'album') as MusicType))
      .filter((preview): preview is MetaPreview => preview !== null)
  }

  private toPreview(item: MassItem, type: MusicType): MetaPreview | null {
    // The URI is the identity. Without it there is nothing to play later.
    if (!item?.uri || !item.name) return null

    const artist = artistName(item)
    const poster = coverArt(item)

    return {
      id: item.uri,
      type: type as ContentType,
      title: item.name,
      // Doubles as the subtitle in the picker, which is what disambiguates
      // three albums called "Greatest Hits".
      ...(artist ? { year: artist } : item.year ? { year: String(item.year) } : {}),
      ...(poster ? { poster } : {}),
    }
  }

  private async call<T>(service: string, data: Record<string, unknown>): Promise<T> {
    const configEntryId = await this.deps.configEntryId()
    if (!configEntryId) {
      throw new ProviderUnavailableError(
        this.id,
        'No Music Assistant speaker chosen yet — pick one in Settings first.',
      )
    }

    try {
      return await this.deps.callForResponse<T>('music_assistant', service, {
        config_entry_id: configEntryId,
        ...data,
      })
    } catch (error) {
      throw new ProviderUnavailableError(
        this.id,
        `Music Assistant did not answer: ${(error as Error).message}`,
      )
    }
  }
}
