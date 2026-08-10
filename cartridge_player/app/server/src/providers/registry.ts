import type { Provider } from '../types.js'
import { UnknownProviderError } from '../errors.js'

/**
 * Providers are resolved by id. Call sites never branch on a provider name —
 * that is the whole point of the registry (§5).
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>()
  private defaultId: string | null = null

  register(provider: Provider, options: { asDefault?: boolean } = {}): this {
    this.providers.set(provider.id, provider)
    if (options.asDefault || this.defaultId === null) this.defaultId = provider.id
    return this
  }

  get(id: string): Provider {
    const provider = this.providers.get(id)
    if (!provider) throw new UnknownProviderError(id)
    return provider
  }

  has(id: string): boolean {
    return this.providers.has(id)
  }

  /**
   * `provider` is a required parameter on the API even though one value is
   * valid today; this is what it defaults to server-side (§7).
   */
  get defaultProviderId(): string {
    if (this.defaultId === null) throw new UnknownProviderError('<none registered>')
    return this.defaultId
  }

  ids(): string[] {
    return [...this.providers.keys()]
  }
}
