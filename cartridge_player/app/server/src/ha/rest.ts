import { HomeAssistantError } from '../errors.js'
import type { ServiceCaller } from '../targets/androidtv.js'

export interface HassState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
}

export interface EntityOption {
  entity_id: string
  name: string
  domain: string
  state: string
  /** Integration that provides it, when known. Disambiguates equal names. */
  platform?: string
}

export interface HomeAssistantRestOptions {
  baseUrl: string
  token: string | null
  fetch?: typeof fetch
  timeoutMs?: number
}

/**
 * Talks to Core through Supervisor's proxy using SUPERVISOR_TOKEN (§3.2).
 * No user-supplied long-lived token, no separate auth setup.
 */
export class HomeAssistantRest implements ServiceCaller {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: HomeAssistantRestOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.request(`/services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /**
   * A service call that answers back.
   *
   * Most services return nothing, which is why `callService` returns void. A
   * few — Music Assistant's search among them — exist purely to hand data back,
   * and Home Assistant only includes it when explicitly asked. Without the
   * query parameter the call succeeds and returns an empty body, which looks
   * exactly like "no results".
   */
  async callServiceForResponse<T>(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<T> {
    const body = (await this.request(
      `/services/${domain}/${service}?return_response=true`,
      { method: 'POST', body: JSON.stringify(data) },
    )) as { service_response?: T } | null

    return (body?.service_response ?? ({} as T)) as T
  }

  /**
   * Service names in one domain. Used to find the reader: an ESPHome action
   * surfaces as `<device>_set_status`, so the device that owns one is
   * discoverable rather than something to configure and keep in sync.
   */
  async listServices(domain: string): Promise<string[]> {
    const body = (await this.request('/services', { method: 'GET' })) as
      | { domain?: string; services?: Record<string, unknown> }[]
      | null

    const entry = (body ?? []).find((d) => d?.domain === domain)
    return Object.keys(entry?.services ?? {})
  }

  /** One entity's current state, or null if Home Assistant does not have it. */
  async getState(entityId: string): Promise<HassState | null> {
    try {
      return (await this.request(`/states/${entityId}`, { method: 'GET' })) as HassState
    } catch {
      return null
    }
  }

  async getStates(): Promise<HassState[]> {
    return (await this.request('/states', { method: 'GET' })) as HassState[]
  }

  /** Only what the setup dropdowns need (§7 `api/entities`). */
  async getTargetEntities(): Promise<{ remotes: EntityOption[]; mediaPlayers: EntityOption[] }> {
    const states = await this.getStates()
    const pick = (domain: string): EntityOption[] =>
      states
        .filter((s) => s.entity_id.startsWith(`${domain}.`))
        .map((s) => ({
          entity_id: s.entity_id,
          name: String(s.attributes.friendly_name ?? s.entity_id),
          domain,
          state: s.state,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

    return { remotes: pick('remote'), mediaPlayers: pick('media_player') }
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    if (!this.options.token) {
      throw new HomeAssistantError(
        'No SUPERVISOR_TOKEN in the environment — is this running as a Home Assistant add-on?',
      )
    }

    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.options.token}`,
          'content-type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new HomeAssistantError(`request to ${path} failed: ${(error as Error).message}`)
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new HomeAssistantError(
        `Home Assistant returned ${response.status} for ${path}${body ? `: ${body.slice(0, 200)}` : ''}`,
      )
    }

    const text = await response.text()
    if (text === '') return null
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }
}
