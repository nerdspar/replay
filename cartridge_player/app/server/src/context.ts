import path from 'node:path'
import type { RuntimeConfig } from './config.js'
import { Store } from './db/index.js'
import { EventBus, type ConnectionState } from './core/events.js'
import { PendingUidStore } from './core/pending.js'
import { ScanHandler } from './core/scan-handler.js'
import { ProviderRegistry } from './providers/registry.js'
import { StremioProvider } from './providers/stremio.js'
import { TargetRegistry } from './targets/registry.js'
import { AndroidTvTarget } from './targets/androidtv.js'
import { HomeAssistantRest } from './ha/rest.js'
import { loadOrCreateSessionSecret } from './http/pin.js'
import { ArtworkStore } from './artwork/store.js'

export interface AppContext {
  config: RuntimeConfig
  store: Store
  artwork: ArtworkStore
  providers: ProviderRegistry
  targets: TargetRegistry
  pending: PendingUidStore
  bus: EventBus
  scans: ScanHandler
  ha: HomeAssistantRest
  sessionSecret: Buffer
  /** Live Home Assistant WebSocket state, surfaced in the UI (§8.6). */
  connection: { state: ConnectionState; detail?: string }
  lastError: { message: string; at: number } | null
  /** Resolved from Supervisor; repo-hash-prefixed (§3.4). Retried lazily. */
  addonSlug: string | null
  /** Last time we asked Supervisor for the slug, so retries stay cheap. */
  addonSlugCheckedAt: number
  /** True once the LAN-direct listener is actually accepting connections. */
  directListening: boolean
  /**
   * Called after settings are written. Lets the runtime bring up the direct
   * listener the moment a PIN exists, without an add-on restart.
   */
  onSettingsChanged?: () => void
}

/**
 * Wires the one Provider and the one Target v1 ships. Adding a second of either
 * is a `register()` call here and nothing else — no call site, schema, or
 * frontend change (§0, §12.2).
 */
export function createContext(config: RuntimeConfig): AppContext {
  const store = new Store(config.dbPath)
  const bus = new EventBus()
  const pending = new PendingUidStore()

  const ha = new HomeAssistantRest({
    baseUrl: config.haRestBase,
    token: config.supervisorToken,
  })

  const providers = new ProviderRegistry().register(new StremioProvider(), {
    asDefault: true,
  })

  const targets = new TargetRegistry().register(
    'androidtv',
    (settings) =>
      new AndroidTvTarget({
        ha,
        remoteEntity: settings.remote_entity,
        mediaPlayerEntity: settings.media_player_entity,
      }),
  )

  const context: AppContext = {
    config,
    store,
    artwork: new ArtworkStore(path.join(config.dataDir, 'artwork')),
    providers,
    targets,
    pending,
    bus,
    ha,
    scans: new ScanHandler({ store, providers, targets, pending, bus }),
    sessionSecret: loadOrCreateSessionSecret(config.dataDir),
    connection: { state: 'disconnected' },
    lastError: null,
    addonSlug: null,
    // -Infinity, not 0: the retry guard must never block the first attempt.
    addonSlugCheckedAt: Number.NEGATIVE_INFINITY,
    directListening: false,
  }

  bus.subscribe((event) => {
    if (event.type === 'error') {
      context.lastError = { message: event.message, at: Date.now() }
    }
    if (event.type === 'connection') {
      context.connection = event.detail
        ? { state: event.state, detail: event.detail }
        : { state: event.state }
    }
  })

  return context
}
