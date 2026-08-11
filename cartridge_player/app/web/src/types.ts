export type ContentType = 'movie' | 'series'
export type RemovalAction = 'none' | 'pause' | 'back' | 'home'
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
