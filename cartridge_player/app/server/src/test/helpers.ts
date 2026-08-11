import { Store } from '../db/index.js'
import { DEFAULT_PALETTE } from '../core/reader-light.js'
import type {
  ArtworkOption,
  Card,
  ContentType,
  LaunchPayload,
  Meta,
  MetaPreview,
  Provider,
  Settings,
  Target,
  TargetKey,
} from '../types.js'

export function memoryStore(): Store {
  return new Store(':memory:')
}

export function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    id: 1,
    target_type: 'androidtv',
    remote_entity: 'remote.living_room_tv',
    media_player_entity: 'media_player.living_room',
    home_first_enabled: true,
    home_delay_ms: 1500,
    autoplay_enabled: true,
    autoplay_delay_ms: 3000,
    removal_action: 'none',
    music_player_entity: 'media_player.kitchen',
    music_removal_action: 'pause',
    led_enabled: true,
    led_playing_mode: 'hold',
    led_playing_artwork: false,
    led_follow_player: true,
    led_match_cartridge: false,
    led_scope: 'cartridge',
    led_palette: DEFAULT_PALETTE,
    reader_device: null,
    pin_hash: null,
    public_base_url: null,
    setup_complete: true,
    ...overrides,
  }
}

export function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 1,
    status: 'assigned',
    tag_uid: '04-A3-B8-8B-32-02-89',
    kind: 'video',
    provider: 'stremio',
    content_type: 'movie' as ContentType,
    external_id: 'tt0083658',
    title: 'Blade Runner',
    year: '1982',
    poster_url: null,
    original_poster_url: null,
    season: null,
    episode: null,
    label: null,
    player_entity: null,
    art_fit: null,
    accent_color: null,
    shuffle: false,
    radio_mode: false,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

/**
 * §10.1 — a full Target implementation that records the ABSTRACT calls it
 * receives. The fire sequence must produce the same ordered vocabulary
 * regardless of which target is plugged in.
 */
export class FakeTarget implements Target {
  readonly id = 'fake'
  readonly calls: string[] = []
  launchedWith: LaunchPayload | null = null

  async launch(payload: LaunchPayload): Promise<void> {
    this.launchedWith = payload
    this.calls.push('launch')
  }

  async sendKey(key: TargetKey): Promise<void> {
    this.calls.push(key)
  }

  async stop(): Promise<void> {
    this.calls.push('stop')
  }

  async pause(): Promise<void> {
    this.calls.push('pause')
  }

  async resume(): Promise<void> {
    this.calls.push('resume')
  }

  async turnOff(): Promise<void> {
    this.calls.push('off')
  }
}

/**
 * §10.1 — a second Provider, registered alongside StremioProvider, returning
 * canned normalised results. If any call site had branched on a provider name,
 * this would break.
 */
export class FakeProvider implements Provider {
  readonly id: string
  readonly searches: { query: string; type: ContentType }[] = []

  constructor(id = 'fake') {
    this.id = id
  }

  async search(query: string, type: ContentType): Promise<MetaPreview[]> {
    this.searches.push({ query, type })
    return [
      { id: 'fake-1', type, title: `${query} (fake)`, year: '2001', poster: 'https://x/p.jpg' },
    ]
  }

  async getMeta(type: string, id: string): Promise<Meta> {
    return {
      id,
      type: type === 'series' ? 'series' : 'movie',
      title: 'Fake Title',
      videos:
        type === 'series'
          ? [{ id: `${id}:1:1`, season: 1, episode: 1, title: 'Fake Pilot' }]
          : undefined,
    }
  }

  async getArtwork(_type: string, id: string): Promise<ArtworkOption[]> {
    return [
      {
        id: 'poster',
        url: `https://fake.example/${id}/poster.jpg`,
        kind: 'poster',
        label: 'Poster',
        aspect: 'portrait',
      },
    ]
  }

  buildLaunch(c: Card): LaunchPayload {
    return { kind: 'uri', value: `fake://open/${c.external_id}` }
  }
}

/** A provider whose payload no v1 target can handle — used to prove the seam. */
export class MediaUrlProvider implements Provider {
  readonly id = 'media-url'

  async search(): Promise<MetaPreview[]> {
    return []
  }

  async getMeta(): Promise<Meta> {
    return { id: 'x', type: 'movie', title: 'x' }
  }

  async getArtwork(): Promise<ArtworkOption[]> {
    return []
  }

  buildLaunch(): LaunchPayload {
    return { kind: 'media_url', value: 'http://jellyfin.local/stream.mkv' }
  }
}

/** Records Home Assistant service calls instead of making them. */
export class RecordingHa {
  readonly calls: { domain: string; service: string; data: Record<string, unknown> }[] = []

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    this.calls.push({ domain, service, data })
  }
}

/** Collects the delays the fire sequence asks for, without actually waiting. */
export function recordingSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = []
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms)
    },
  }
}
