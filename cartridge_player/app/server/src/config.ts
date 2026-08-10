import path from 'node:path'

export interface RuntimeConfig {
  /** Ingress listener. Always on. */
  ingressPort: number
  /**
   * LAN-direct listener (§3.4). 0 = disabled. Requires an app-level PIN,
   * because this bypasses Home Assistant auth entirely.
   */
  directPort: number
  dbPath: string
  /** Directory holding the built SPA. */
  webRoot: string
  /** Where the session-signing key is persisted. */
  dataDir: string
  supervisorToken: string | null
  /** Base URL for Supervisor's proxied Core REST API. */
  haRestBase: string
  haWsUrl: string
  /** Supervisor's own API, used once at boot to learn the add-on slug. */
  supervisorUrl: string
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const dbPath = env.CARTRIDGE_DB_PATH ?? '/data/cartridge.db'
  return {
    ingressPort: intFromEnv('CARTRIDGE_INGRESS_PORT', 8099),
    directPort: intFromEnv('CARTRIDGE_DIRECT_PORT', 0),
    dbPath,
    dataDir: path.dirname(dbPath),
    webRoot: env.CARTRIDGE_WEB_ROOT ?? '/app/web',
    supervisorToken: env.SUPERVISOR_TOKEN ?? null,
    haRestBase: env.CARTRIDGE_HA_REST_BASE ?? 'http://supervisor/core/api',
    haWsUrl: env.CARTRIDGE_HA_WS_URL ?? 'ws://supervisor/core/websocket',
    supervisorUrl: env.CARTRIDGE_SUPERVISOR_URL ?? 'http://supervisor',
  }
}
