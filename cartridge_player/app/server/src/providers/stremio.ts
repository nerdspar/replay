import { ProviderUnavailableError } from '../errors.js'
import { TtlCache } from './cache.js'
import type {
  ArtworkOption,
  ArtworkQuery,
  Card,
  ContentType,
  LaunchPayload,
  Meta,
  MetaPreview,
  MetaVideo,
  Provider,
  Settings,
} from '../types.js'

/**
 * Cinemeta is Stremio's own metadata addon: public, no key, no auth. It is the
 * ONLY metadata source we use. Stremio treats items from addons with different
 * id prefixes as separate content — a title from the TMDB addon carries a `tmdb`
 * prefix and won't behave identically. Mixing sources produces cards that look
 * right and behave wrong (§5.1).
 */
export const CINEMETA_BASE = 'https://v3-cinemeta.strem.io'

/**
 * Verified against https://v3-cinemeta.strem.io/manifest.json (2026-08-09):
 * both `movie` and `series` expose catalog id `top` with `search` in
 * `extraSupported`. (§11 open item — resolved.)
 */
export const CINEMETA_SEARCH_CATALOG = 'top'

/** Cinemeta's image host. Serves larger poster variants than `meta.poster`. */
export const METAHUB_BASE = 'https://images.metahub.space'

const CACHE_TTL_MS = 10 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8000

interface CinemetaMetaPreview {
  id?: string
  type?: string
  name?: string
  poster?: string
  releaseInfo?: string
}

interface CinemetaVideo {
  id?: string
  name?: string
  title?: string
  season?: number
  episode?: number
  number?: number
  released?: string
  firstAired?: string
  thumbnail?: string
}

interface CinemetaMeta extends CinemetaMetaPreview {
  description?: string
  year?: string
  background?: string
  logo?: string
  videos?: CinemetaVideo[]
}

type Fetcher = typeof fetch

export interface StremioProviderOptions {
  baseUrl?: string
  fetch?: Fetcher
  ttlMs?: number
  now?: () => number
}

function coerceType(value: string | undefined, fallback: ContentType): ContentType {
  return value === 'movie' || value === 'series' ? value : fallback
}

function toPreview(raw: CinemetaMetaPreview, fallbackType: ContentType): MetaPreview | null {
  if (!raw?.id || !raw?.name) return null
  return {
    id: raw.id,
    type: coerceType(raw.type, fallbackType),
    title: raw.name,
    ...(raw.releaseInfo ? { year: raw.releaseInfo } : {}),
    ...(raw.poster ? { poster: raw.poster } : {}),
  }
}

function toVideo(raw: CinemetaVideo, seriesId: string): MetaVideo | null {
  const season = raw.season
  const episode = raw.episode ?? raw.number
  if (typeof season !== 'number' || typeof episode !== 'number') return null
  const released = raw.released ?? raw.firstAired
  return {
    id: raw.id ?? `${seriesId}:${season}:${episode}`,
    season,
    episode,
    title: raw.name ?? raw.title ?? `Episode ${episode}`,
    ...(released ? { released } : {}),
    ...(raw.thumbnail ? { thumbnail: raw.thumbnail } : {}),
  }
}

export class StremioProvider implements Provider {
  readonly id = 'stremio'

  private readonly baseUrl: string
  private readonly fetchImpl: Fetcher
  private readonly searchCache: TtlCache<MetaPreview[]>
  private readonly metaCache: TtlCache<Meta>

  constructor(options: StremioProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? CINEMETA_BASE).replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? fetch
    const ttl = options.ttlMs ?? CACHE_TTL_MS
    this.searchCache = new TtlCache<MetaPreview[]>(ttl, options.now)
    this.metaCache = new TtlCache<Meta>(ttl, options.now)
  }

  async search(query: string, type: ContentType): Promise<MetaPreview[]> {
    const trimmed = query.trim()
    if (trimmed === '') return []

    const key = `${type}:${trimmed.toLowerCase()}`
    const cached = this.searchCache.get(key)
    if (cached) return cached

    const url =
      `${this.baseUrl}/catalog/${type}/${CINEMETA_SEARCH_CATALOG}` +
      `/search=${encodeURIComponent(trimmed)}.json`

    const body = await this.getJson<{ metas?: CinemetaMetaPreview[] }>(url)
    const results = (body.metas ?? [])
      .map((m) => toPreview(m, type))
      .filter((m): m is MetaPreview => m !== null)

    this.searchCache.set(key, results)
    return results
  }

  async getMeta(type: string, id: string): Promise<Meta> {
    const contentType = coerceType(type, 'movie')
    const key = `${contentType}:${id}`
    const cached = this.metaCache.get(key)
    if (cached) return cached

    const url = `${this.baseUrl}/meta/${contentType}/${encodeURIComponent(id)}.json`
    const body = await this.getJson<{ meta?: CinemetaMeta }>(url)
    const raw = body.meta
    if (!raw?.id || !raw?.name) {
      throw new ProviderUnavailableError(this.id, `no metadata returned for ${id}`)
    }

    const videos = (raw.videos ?? [])
      .map((v) => toVideo(v, raw.id!))
      .filter((v): v is MetaVideo => v !== null)
      // Specials land in season 0; keep them, but list them last.
      .sort((a, b) =>
        a.season === b.season
          ? a.episode - b.episode
          : (a.season === 0 ? Infinity : a.season) - (b.season === 0 ? Infinity : b.season),
      )

    const meta: Meta = {
      id: raw.id,
      type: coerceType(raw.type, contentType),
      title: raw.name,
      ...(raw.releaseInfo ?? raw.year ? { year: raw.releaseInfo ?? raw.year } : {}),
      ...(raw.poster ? { poster: raw.poster } : {}),
      ...(raw.description ? { description: raw.description } : {}),
      ...(raw.background ? { background: raw.background } : {}),
      ...(raw.logo ? { logo: raw.logo } : {}),
      ...(videos.length > 0 ? { videos } : {}),
    }

    this.metaCache.set(key, meta)
    return meta
  }

  /**
   * Cinemeta carries several images per title, and metahub serves a larger
   * poster than the one `meta.poster` points at — worth offering, because the
   * small one is thin at sticker print sizes.
   */
  async getArtwork(
    type: string,
    id: string,
    query: ArtworkQuery = {},
  ): Promise<ArtworkOption[]> {
    const meta = await this.getMeta(type, id)
    const options: ArtworkOption[] = []
    const seen = new Set<string>()

    const add = (option: ArtworkOption) => {
      if (!option.url || seen.has(option.url)) return
      seen.add(option.url)
      options.push(option)
    }

    // Only IMDb ids resolve on metahub (Cinemeta declares idPrefixes: ["tt"]).
    if (/^tt\d+$/.test(meta.id)) {
      add({
        id: 'poster-hi',
        url: `${METAHUB_BASE}/poster/medium/${meta.id}/img`,
        kind: 'poster',
        label: 'Poster — high resolution',
        aspect: 'portrait',
      })
    }

    if (meta.poster) {
      add({ id: 'poster', url: meta.poster, kind: 'poster', label: 'Poster', aspect: 'portrait' })
    }

    if (meta.background) {
      add({
        id: 'background',
        url: meta.background,
        kind: 'background',
        label: 'Background',
        aspect: 'landscape',
      })
    }

    if (meta.logo) {
      add({ id: 'logo', url: meta.logo, kind: 'logo', label: 'Logo', aspect: 'landscape' })
    }

    // A card pinned to an episode can use that episode's still.
    if (query.season !== null && query.season !== undefined && query.episode !== null && query.episode !== undefined) {
      const video = meta.videos?.find(
        (v) => v.season === query.season && v.episode === query.episode,
      )
      if (video?.thumbnail) {
        add({
          id: 'episode',
          url: video.thumbnail,
          kind: 'episode',
          label: `Episode still — S${String(video.season).padStart(2, '0')}E${String(video.episode).padStart(2, '0')}`,
          aspect: 'landscape',
        })
      }
    }

    return options
  }

  /**
   * §6.3. Format is `stremio://detail/{type}/{id}/{videoId}`; an empty videoId
   * opens the episode list, which is the default for series — the user picks a
   * stream manually anyway, so the list costs one click and avoids stale cards.
   *
   * Built at fire time from `provider` + `external_id`, never stored
   * pre-assembled, so the format can change without a data migration (§4).
   */
  buildLaunch(card: Card, _settings: Settings): LaunchPayload {
    const id = encodeURIComponent(card.external_id)

    if (card.content_type === 'movie') {
      return { kind: 'uri', value: `stremio://detail/movie/${id}/${id}` }
    }

    const pinned = card.season !== null && card.episode !== null
    const videoId = pinned ? `${id}:${card.season}:${card.episode}` : ''
    return { kind: 'uri', value: `stremio://detail/series/${id}/${videoId}` }
  }

  private async getJson<T>(url: string): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      // The UI must be able to say "metadata is unreachable" rather than hang.
      throw new ProviderUnavailableError(this.id, (error as Error).message)
    }

    if (!response.ok) {
      throw new ProviderUnavailableError(this.id, `HTTP ${response.status} from ${url}`)
    }

    try {
      return (await response.json()) as T
    } catch (error) {
      throw new ProviderUnavailableError(this.id, `malformed JSON: ${(error as Error).message}`)
    }
  }
}
