import path from 'node:path'
import type { RuntimeConfig } from './config.js'
import { Store } from './db/index.js'
import { EventBus, type ConnectionState } from './core/events.js'
import { PendingUidStore } from './core/pending.js'
import { ScanHandler } from './core/scan-handler.js'
import { ReaderLight } from './core/reader-light.js'
import { ProviderRegistry } from './providers/registry.js'
import { StremioProvider } from './providers/stremio.js'
import { MusicAssistantProvider } from './providers/musicassistant.js'
import { TargetRegistry } from './targets/registry.js'
import { AndroidTvTarget } from './targets/androidtv.js'
import { MusicAssistantTarget } from './targets/musicassistant.js'
import { HomeAssistantRest } from './ha/rest.js'
import type { EntityOrigin } from './ha/entity-registry.js'
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
  light: ReaderLight
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
   * entity_id → integration, for telling apart entities that share a friendly
   * name. Returns an empty map when unavailable; callers must degrade quietly.
   */
  entityPlatforms: () => Promise<Map<string, EntityOrigin>>
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

  const providers = new ProviderRegistry()
    .register(new StremioProvider(), { asDefault: true })
    .register(
      new MusicAssistantProvider({
        callForResponse: (domain, service, data) =>
          ha.callServiceForResponse(domain, service, data),
        /*
          Which Music Assistant server to search.

          Its search action is addressed by config entry rather than by entity,
          and that id is a UUID nobody could be asked to find and paste. So it
          is derived: the speaker chosen in Settings belongs to exactly one
          Music Assistant instance, and the entity registry knows which. Read
          fresh each time, because changing the speaker may change the server.
        */
        configEntryId: async () => {
          const entity = store.getSettings().music_player_entity
          if (!entity) return null
          const origins = await context.entityPlatforms()
          return origins.get(entity)?.configEntryId ?? null
        },
      }),
    )

  const targets = new TargetRegistry()
    .register(
      'androidtv',
      (settings) =>
        new AndroidTvTarget({
          ha,
          remoteEntity: settings.remote_entity,
          mediaPlayerEntity: settings.media_player_entity,
        }),
    )
    .register(
      'music_assistant',
      (settings, card) =>
        new MusicAssistantTarget({
          ha,
          // The cartridge wins over the household default, so one album can
          // live in the kitchen without moving everything else there.
          playerEntity: card?.player_entity ?? settings.music_player_entity,
        }),
    )

  const light = new ReaderLight({ ha, settings: () => store.getSettings() })

  const context: AppContext = {
    config,
    store,
    artwork: new ArtworkStore(path.join(config.dataDir, 'artwork')),
    providers,
    targets,
    pending,
    bus,
    ha,
    light,
    scans: new ScanHandler({ store, providers, targets, pending, bus, light }),
    sessionSecret: loadOrCreateSessionSecret(config.dataDir),
    connection: { state: 'disconnected' },
    lastError: null,
    addonSlug: null,
    // -Infinity, not 0: the retry guard must never block the first attempt.
    addonSlugCheckedAt: Number.NEGATIVE_INFINITY,
    directListening: false,
    // Replaced at boot once the WebSocket exists; harmless until then.
    entityPlatforms: async () => new Map<string, EntityOrigin>(),
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
