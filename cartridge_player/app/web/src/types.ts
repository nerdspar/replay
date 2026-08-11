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

/** Which device a cartridge reaches, and which library tab it appears under. */
export type CardKind = 'video' | 'music'

/** How a cover that is not 2:3 is reconciled with the 60x90 sticker. */
export type ArtFit = 'crop' | 'blur' | 'color'

export type RemovalAction = 'none' | 'pause' | 'back' | 'home' | 'off'
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
export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export interface MetaPreview {
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
  thumbnail?: string
}

export interface Meta extends MetaPreview {
  description?: string
  background?: string
  logo?: string
  videos?: MetaVideo[]
}

export type ArtworkKind = 'poster' | 'background' | 'logo' | 'episode' | 'custom'

export interface ArtworkOption {
  id: string
  url: string
  kind: ArtworkKind
  label: string
  aspect: 'portrait' | 'landscape'
}

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
  /** Overrides the default speaker for this one cartridge. */
  player_entity: string | null
  art_fit: ArtFit | null
  shuffle: boolean
  radio_mode: boolean
  created_at: number
  updated_at: number
}

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
  reader_device: string | null
  public_base_url: string | null
  setup_complete: boolean
  pin_set: boolean
  direct_mode: { enabled: boolean; port: number; running: boolean }
  panel_url: string | null
  addon_slug: string | null
}

export interface EntityOption {
  entity_id: string
  name: string
  domain: string
  state: string
  /** Integration that provides it, when Home Assistant could tell us. */
  platform?: string
}

export interface ScanEvent {
  id: number
  tag_uid: string
  matched_card_id: number | null
  action_taken: string | null
  error: string | null
  created_at: number
}

export interface PendingUid {
  uid: string
  seen_at: number
}

export type AppEvent =
  | { type: 'pending'; pending: PendingUid | null }
  | { type: 'scan'; scan: ScanEvent; card: Card | null }
  | { type: 'connection'; state: ConnectionState; detail?: string }
  | { type: 'cards' }
  | { type: 'error'; message: string }
