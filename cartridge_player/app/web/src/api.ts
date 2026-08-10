import type {
  ArtworkOption,
  Card,
  ContentType,
  EntityOption,
  Meta,
  MetaPreview,
  PendingUid,
  ScanEvent,
  Settings,
} from './types'

/**
 * EVERY path here is relative — never a leading slash. Ingress mounts the app
 * under a rotating session path, and an absolute path would escape it (§3.3).
 * The <base> tag the server injects is what anchors these.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  const text = await response.text()
  const body = text === '' ? null : (JSON.parse(text) as unknown)

  if (!response.ok) {
    const err = body as { error?: string; message?: string } | null
    throw new ApiError(
      err?.error ?? 'request_failed',
      err?.message ?? `Request failed (${response.status})`,
      response.status,
    )
  }
  return body as T
}

export const api = {
  listCards: () => request<{ cards: Card[] }>('api/cards').then((r) => r.cards),

  createCard: (input: {
    tag_uid: string
    provider?: string
    content_type: ContentType
    external_id: string
    title: string
    year?: string | null
    poster_url?: string | null
    season?: number | null
    episode?: number | null
    label?: string | null
  }) =>
    request<{ card: Card }>('api/cards', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.card),

  updateCard: (id: number, patch: Partial<Card>) =>
    request<{ card: Card }>(`api/cards/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.card),

  deleteCard: (id: number) => request<{ ok: true }>(`api/cards/${id}`, { method: 'DELETE' }),

  testCard: (id: number) =>
    request<{ scan: ScanEvent; ok: boolean }>(`api/cards/${id}/test`, { method: 'POST' }),

  search: (q: string, type: ContentType, provider = 'stremio') =>
    request<{ provider: string; results: MetaPreview[] }>(
      `api/search?q=${encodeURIComponent(q)}&type=${type}&provider=${provider}`,
    ).then((r) => r.results),

  meta: (provider: string, type: ContentType, id: string) =>
    request<{ meta: Meta }>(
      `api/meta/${provider}/${type}/${encodeURIComponent(id)}`,
    ).then((r) => r.meta),

  artwork: (
    provider: string,
    type: ContentType,
    id: string,
    pinned?: { season: number | null; episode: number | null },
  ) => {
    const query =
      pinned?.season !== null && pinned?.season !== undefined && pinned.episode !== null
        ? `?season=${pinned.season}&episode=${pinned.episode}`
        : ''
    return request<{ provider: string; options: ArtworkOption[] }>(
      `api/artwork/${provider}/${type}/${encodeURIComponent(id)}${query}`,
    ).then((r) => r.options)
  },

  /**
   * Relays one image from an allowlisted site so the browser can resize it and
   * upload it like any other file. Same-origin, so the canvas is not tainted.
   */
  fetchArtwork: async (url: string): Promise<Blob> => {
    const response = await fetch(`api/artwork/fetch?url=${encodeURIComponent(url)}`)
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null
      throw new ApiError(
        body?.error ?? 'import_failed',
        body?.message ?? `Could not fetch that image (${response.status})`,
        response.status,
      )
    }
    return response.blob()
  },

  uploadArtwork: (blob: Blob) =>
    request<{ artwork: ArtworkOption }>('api/artwork/upload', {
      method: 'POST',
      headers: { 'content-type': blob.type || 'image/jpeg' },
      body: blob,
    }).then((r) => r.artwork),

  getSettings: () => request<{ settings: Settings }>('api/settings').then((r) => r.settings),

  saveSettings: (patch: Record<string, unknown>) =>
    request<{ settings: Settings }>('api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }).then((r) => r.settings),

  entities: () =>
    request<{ remotes: EntityOption[]; mediaPlayers: EntityOption[] }>('api/entities'),

  sendKey: (key: 'home' | 'select' | 'back') =>
    request<{ ok: true }>('api/target/key', {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),

  pending: () =>
    request<{ pending: PendingUid | null; connection: { state: string; detail?: string } }>(
      'api/pending',
    ),

  scans: (limit = 50) =>
    request<{
      scans: ScanEvent[]
      connection: { state: string; detail?: string }
      last_error: { message: string; at: number } | null
    }>(`api/scans?limit=${limit}`),

  authStatus: () =>
    request<{ required: boolean; pin_set: boolean; authenticated: boolean }>('api/auth/status'),

  login: (pin: string) =>
    request<{ authenticated: boolean }>('api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),
}
