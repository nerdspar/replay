import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from './log.js'

const log = createLogger('config')

/**
 * Supervisor writes the add-on's options here. Reading it directly is what
 * `bashio::config` does, and doing it in-process means the container does not
 * depend on a shell helper library being present in the base image.
 */
export function readAddonOptions(
  file = '/data/options.json',
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  } catch (error) {
    // Absent outside Home Assistant, and malformed should never be fatal —
    // every option has a working default.
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') log.warn(`could not read ${file}: ${(error as Error).message}`)
    return {}
  }
}

function intFromOption(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number.parseInt(value, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

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

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: Record<string, unknown> = readAddonOptions(),
): RuntimeConfig {
  const dbPath = env.CARTRIDGE_DB_PATH ?? '/data/cartridge.db'

  // The add-on option wins; the env var stays for development outside HA.
  const directPort =
    intFromOption(options.direct_port) ?? intFromEnv(env, 'CARTRIDGE_DIRECT_PORT', 0)

  return {
    ingressPort: intFromEnv(env, 'CARTRIDGE_INGRESS_PORT', 8099),
    directPort,
    dbPath,
    dataDir: path.dirname(dbPath),
    webRoot: env.CARTRIDGE_WEB_ROOT ?? '/app/web',
    supervisorToken: env.SUPERVISOR_TOKEN ?? null,
    haRestBase: env.CARTRIDGE_HA_REST_BASE ?? 'http://supervisor/core/api',
    haWsUrl: env.CARTRIDGE_HA_WS_URL ?? 'ws://supervisor/core/websocket',
    supervisorUrl: env.CARTRIDGE_SUPERVISOR_URL ?? 'http://supervisor',
  }
}
