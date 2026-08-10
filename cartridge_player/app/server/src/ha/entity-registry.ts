import { createLogger } from '../log.js'
import type { HomeAssistantWs } from './ws.js'

const log = createLogger('registry')

const CACHE_TTL_MS = 60_000

interface RegistryEntry {
  entity_id?: string
  platform?: string
}

/**
 * Which integration each entity came from.
 *
 * This exists because friendly names are not unique. A household running both a
 * native integration and Music Assistant ends up with two media players called
 * "Living Room", and a dropdown listing names alone cannot tell them apart. The
 * integration is the thing that distinguishes them, and the entity registry —
 * reachable only over the WebSocket API, not REST — is the only place it lives.
 *
 * Strictly an enhancement: every failure path returns an empty map, and the
 * pickers fall back to disambiguating by entity id.
 */
export function createEntityPlatformLookup(
  ws: HomeAssistantWs,
  now: () => number = Date.now,
): () => Promise<Map<string, string>> {
  let cache: Map<string, string> | null = null
  let fetchedAt = Number.NEGATIVE_INFINITY
  let inFlight: Promise<Map<string, string>> | null = null

  return async () => {
    if (cache && now() - fetchedAt < CACHE_TTL_MS) return cache
    if (inFlight) return inFlight

    inFlight = (async () => {
      try {
        const entries = await ws.command<RegistryEntry[]>({
          type: 'config/entity_registry/list',
        })

        const map = new Map<string, string>()
        for (const entry of entries ?? []) {
          if (entry?.entity_id && entry.platform) map.set(entry.entity_id, entry.platform)
        }
        cache = map
        fetchedAt = now()
        return map
      } catch (error) {
        // Older cores, restricted tokens, or a dropped socket all land here.
        log.debug(`entity registry unavailable: ${(error as Error).message}`)
        return cache ?? new Map<string, string>()
      } finally {
        inFlight = null
      }
    })()

    return inFlight
  }
}

/**
 * Turns `androidtv_remote` into `Android TV Remote`. Names the user recognises
 * from the integrations page, without shipping a lookup table that rots.
 */
export function formatPlatform(platform: string): string {
  const known: Record<string, string> = {
    androidtv: 'Android TV',
    androidtv_remote: 'Android TV Remote',
    music_assistant: 'Music Assistant',
    cast: 'Google Cast',
    dlna_dmr: 'DLNA',
    apple_tv: 'Apple TV',
    sonos: 'Sonos',
    spotify: 'Spotify',
    plex: 'Plex',
    kodi: 'Kodi',
    roku: 'Roku',
    webostv: 'LG webOS',
    samsungtv: 'Samsung TV',
    squeezebox: 'Squeezebox',
    heos: 'HEOS',
    forked_daapd: 'owntone',
  }
  if (known[platform]) return known[platform]

  // Plain title case for anything unknown. Guessing at acronyms by word length
  // turns "some_new_thing" into "Some NEW Thing", which is worse than leaving
  // it alone — the known list above is where acronyms belong.
  return platform
    .split('_')
    .filter((word) => word !== '')
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ')
}
