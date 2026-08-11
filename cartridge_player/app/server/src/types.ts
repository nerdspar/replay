/**
 * Shared domain types.
 *
 * `MetaPreview` / `Meta` are NORMALISED shapes, not any provider's wire format.
 * The frontend must never be able to tell which provider produced a result (§5).
 */

/**
 * Every kind of thing a cartridge can point at, across all providers. The
 * `CardKind` a type belongs to is what routes a scan to a device.
 */
export type VideoContentType = 'movie' | 'series'

export type MusicContentType =
  | 'album'
  | 'playlist'
  | 'artist'
  | 'track'
  | 'radio'
  | 'podcast'
  | 'audiobook'

export type ContentType = VideoContentType | MusicContentType

/** Which device a cartridge reaches. Never inferred from a provider name (§10.1). */
export type CardKind = 'video' | 'music'

const MUSIC_CONTENT_TYPES = new Set<string>([
  'album',
  'playlist',
  'artist',
  'track',
  'radio',
  'podcast',
  'audiobook',
])

export function kindOfContentType(type: ContentType): CardKind {
  return MUSIC_CONTENT_TYPES.has(type) ? 'music' : 'video'
}

/**
 * How a cover that is not 2:3 is reconciled with the 60x90 sticker. Album art
 * is square; the sticker is not. Purely a print concern.
 */
export type ArtFit = 'crop' | 'blur' | 'color'

export interface MetaPreview {
  /** Provider-scoped external id (IMDb id for Stremio). */
  id: string
  type: ContentType
  title: string
  year?: string
  poster?: string
}

export interface MetaVideo {
  id: string
  season: number
  episode: number
  title: string
  released?: string
  /** Episode still, when the provider has one. */
  thumbnail?: string
}

export interface Meta extends MetaPreview {
  description?: string
  /** Alternate artwork, when the provider has it. Feeds the artwork picker. */
  background?: string
  logo?: string
  /** Populated for series — the source for the episode picker. */
  videos?: MetaVideo[]
}

export type LaunchPayload =
  | { kind: 'uri'; value: string }
  | { kind: 'media_url'; value: string }
  /**
   * A library item to hand to a music system, rather than a link to open. The
   * value is provider-scoped (a Music Assistant URI, or a plain name it will
   * resolve); `mediaType` narrows an ambiguous name to the right kind of thing.
   */
  | {
      kind: 'media_item'
      value: string
      mediaType: string
      shuffle: boolean
      radioMode: boolean
    }

/** Abstract, not a raw keycode. Each target maps it to its own vocabulary (§6). */
export type TargetKey = 'home' | 'select' | 'back'

export type RemovalAction = 'none' | 'pause' | 'back' | 'home' | 'off'

/** A speaker has no Back, Home, or power. Lifting can only ever do these three. */
export type MusicRemovalAction = 'none' | 'pause' | 'stop'

/** The nine things the reader's light can be saying. */
export type LedStateName =
  | 'no_wifi'
  | 'no_ha'
  | 'ready'
  | 'read'
  | 'working'
  | 'no_answer'
  | 'playing'
  | 'new'
  | 'error'

export interface LedStateStyle {
  /** `#rrggbb`. A grey is driven through the LED's white die. */
  color: string
  /** 0-100. */
  brightness: number
}

export type LedPalette = Record<LedStateName, LedStateStyle>

/** What the light does while a cartridge sits on the reader playing. */
export type LedPlayingMode = 'hold' | 'confirm' | 'off'

/**
 * `unassigned` is a cartridge you still own that currently plays nothing —
 * distinct from deleting it, which is for a cartridge that is lost or broken.
 */
export type CardStatus = 'assigned' | 'unassigned'

export interface Card {
  id: number
  status: CardStatus
  tag_uid: string
  kind: CardKind
  provider: string
  content_type: ContentType
  external_id: string
  title: string
  year: string | null
  poster_url: string | null
  /** Artwork the card was created with. Written once, never updated. */
  original_poster_url: string | null
  season: number | null
  episode: number | null
  label: string | null
  /** Overrides the default speaker for this one cartridge. NULL means default. */
  player_entity: string | null
  art_fit: ArtFit | null
  /** Music only. Shuffles the queue this cartridge builds. */
  shuffle: boolean
  /** Music only. Keeps playing similar music once the selection runs out. */
  radio_mode: boolean
  created_at: number
  updated_at: number
}

export type CardInput = Omit<
  Card,
  'id' | 'created_at' | 'updated_at' | 'status' | 'original_poster_url' | 'kind'
>

export interface Settings {
  id: 1
  target_type: string
  remote_entity: string | null
  media_player_entity: string | null
  home_first_enabled: boolean
  home_delay_ms: number
  autoplay_enabled: boolean
  autoplay_delay_ms: number
  removal_action: RemovalAction
  music_player_entity: string | null
  music_removal_action: MusicRemovalAction
  led_enabled: boolean
  led_playing_mode: LedPlayingMode
  led_palette: LedPalette
  /** ESPHome device name. Blank means "whichever reader answers" (§1.2). */
  reader_device: string | null
  pin_hash: string | null
  public_base_url: string | null
  setup_complete: boolean
}

export interface ScanEvent {
  id: number
  tag_uid: string
  matched_card_id: number | null
  action_taken: string | null
  error: string | null
  created_at: number
}

export type ArtworkKind = 'poster' | 'background' | 'logo' | 'episode' | 'custom'

export interface ArtworkOption {
  /** Stable within one option list, so the UI can key and compare selections. */
  id: string
  url: string
  kind: ArtworkKind
  label: string
  /** Hint for the picker's tile shape. Not authoritative. */
  aspect: 'portrait' | 'landscape'
}

export interface ArtworkQuery {
  season?: number | null
  episode?: number | null
}

export interface Provider {
  readonly id: string
  search(query: string, type: ContentType): Promise<MetaPreview[]>
  getMeta(type: string, id: string): Promise<Meta>
  /**
   * Every artwork this provider can offer for a title. Normalised like `Meta` —
   * the picker must not know which provider produced the list.
   */
  getArtwork(type: string, id: string, query?: ArtworkQuery): Promise<ArtworkOption[]>
  buildLaunch(card: Card, settings: Settings): LaunchPayload
}

export interface Target {
  readonly id: string
  launch(payload: LaunchPayload): Promise<void>
  sendKey(key: TargetKey): Promise<void>
  stop(): Promise<void>
  pause(): Promise<void>
  turnOff(): Promise<void>
}
