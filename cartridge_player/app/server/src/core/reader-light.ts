import { createLogger } from '../log.js'
import type { LedPalette, LedPlayingMode, LedStateName, Settings } from '../types.js'

const log = createLogger('light')

/**
 * The reader's status LED, driven from here.
 *
 * The reader shows connection states on its own — no wifi, no Home Assistant,
 * ready, tag read — because those must be legible with this add-on stopped.
 * What a cartridge actually DID is the opposite: the reader cannot know whether
 * a tag is assigned or whether the TV accepted a deep link, so those states are
 * pushed to it from here.
 *
 * Everything in this class is best-effort. A light that fails must never take a
 * scan down with it, so every call swallows its errors.
 */

/**
 * Order is a wire format: the firmware unpacks by position. Appending is safe,
 * reordering is not.
 */
export const LED_STATES: LedStateName[] = [
  'no_wifi',
  'no_ha',
  'ready',
  'read',
  'working',
  'no_answer',
  'playing',
  'new',
  'error',
  // Appended, not inserted: the firmware unpacks by position, and older
  // firmware simply keeps its default for a state it does not know about.
  'paused',
]

/** Matches the fallback palette compiled into the firmware. */
export const DEFAULT_PALETTE: LedPalette = {
  no_wifi: { color: '#ff0000', brightness: 45 },
  no_ha: { color: '#ff8c00', brightness: 45 },
  ready: { color: '#ffffff', brightness: 10 },
  read: { color: '#ffffff', brightness: 100 },
  working: { color: '#ffffff', brightness: 40 },
  no_answer: { color: '#ff8c00', brightness: 80 },
  playing: { color: '#00ff26', brightness: 70 },
  new: { color: '#1a59ff', brightness: 60 },
  error: { color: '#ff0000', brightness: 80 },
  // The playing colour, dimmed. Held rather than a new hue to learn: bright
  // means running, dim means stopped, and it works with a borrowed artwork
  // colour too.
  paused: { color: '#00ff26', brightness: 18 },
}

/** How long a discovered service name is trusted before being looked up again. */
const DISCOVERY_TTL_MS = 5 * 60_000

const HEX_COLOR = /^#?([0-9a-f]{6})$/i

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

/**
 * Nine entries of `RRGGBBLL` — colour plus brightness — with no separators.
 *
 * Fixed width so the firmware's parse is a loop rather than a grammar, and so
 * its only validation is a length check. A push it cannot read is discarded
 * whole, leaving the reader on its previous palette rather than dark.
 */
export function packPalette(palette: LedPalette): string {
  return LED_STATES.map((state) => {
    const entry = palette[state] ?? DEFAULT_PALETTE[state]
    const match = HEX_COLOR.exec(entry.color ?? '')
    const rgb = match ? match[1]! : HEX_COLOR.exec(DEFAULT_PALETTE[state].color)![1]!
    const level = clampByte(((entry.brightness ?? 0) / 100) * 255)
    return `${rgb}${level.toString(16).padStart(2, '0')}`.toLowerCase()
  }).join('')
}

/** Fills in any state the stored palette is missing, so callers get all nine. */
export function normalizePalette(stored: Partial<LedPalette> | null): LedPalette {
  const out = {} as LedPalette
  for (const state of LED_STATES) {
    const entry = stored?.[state]
    out[state] =
      entry && HEX_COLOR.test(entry.color ?? '')
        ? {
            color: entry.color.startsWith('#') ? entry.color : `#${entry.color}`,
            brightness: Math.max(0, Math.min(100, Math.round(entry.brightness ?? 0))),
          }
        : { ...DEFAULT_PALETTE[state] }
  }
  return out
}

/** What the add-on tells the reader once it knows what a cartridge did. */
export type ReaderStatus =
  | 'busy'
  | 'playing'
  | 'playing_hold'
  | 'paused'
  | 'new'
  | 'error'
  | 'ready'
  | 'off'

/** Which playing state a mode sends. `off` still has to release the reader. */
export function statusForPlayingMode(mode: LedPlayingMode): ReaderStatus {
  if (mode === 'hold') return 'playing_hold'
  if (mode === 'confirm') return 'playing'
  // Not "send nothing": the reader is holding a `working` state and would sit
  // there until its backstop expired and then report that nobody answered.
  return 'ready'
}

export interface ServiceCaller {
  callService(domain: string, service: string, data: Record<string, unknown>): Promise<void>
}

export interface ServiceLister {
  /** Service names in one domain, e.g. `replay_cartridge_reader_set_status`. */
  listServices(domain: string): Promise<string[]>
}

export interface ReaderLightDeps {
  ha: ServiceCaller & ServiceLister
  settings: () => Settings
  now?: () => number
}

export class ReaderLight {
  private cachedPrefix: string | null = null
  private discoveredAt = Number.NEGATIVE_INFINITY

  constructor(private readonly deps: ReaderLightDeps) {}

  private get now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /**
   * Which ESPHome device to talk to, worked out rather than configured.
   *
   * An ESPHome action turns into a service named `<device>_set_status`, so the
   * device that owns one is discoverable. Asking beats a settings field that
   * silently stops matching the day someone renames their reader.
   */
  private async prefix(): Promise<string | null> {
    if (this.cachedPrefix && this.now - this.discoveredAt < DISCOVERY_TTL_MS) {
      return this.cachedPrefix
    }

    try {
      const services = await this.deps.ha.listServices('esphome')
      const found = services.filter((name) => name.endsWith('_set_status'))

      if (found.length === 0) {
        // Firmware too old, or the reader is offline. Not an error: the light
        // is an enhancement and the scan itself is unaffected.
        this.cachedPrefix = null
      } else {
        const configured = this.deps.settings().reader_device?.replace(/-/g, '_') ?? ''
        const match =
          found.find((name) => name === `${configured}_set_status`) ?? found[0]!
        this.cachedPrefix = match.slice(0, -'_set_status'.length)
        if (found.length > 1) {
          log.info(`several readers found; using ${this.cachedPrefix}`)
        }
      }
      this.discoveredAt = this.now
    } catch (error) {
      log.debug(`could not list esphome services: ${(error as Error).message}`)
      this.cachedPrefix = null
      this.discoveredAt = this.now
    }

    return this.cachedPrefix
  }

  /** Whether the reader's firmware knows a given action at all. */
  private async supports(action: string): Promise<boolean> {
    const prefix = await this.prefix()
    if (!prefix) return false
    try {
      return (await this.deps.ha.listServices('esphome')).includes(`${prefix}_${action}`)
    } catch {
      return false
    }
  }

  private async call(action: string, data: Record<string, unknown>): Promise<void> {
    if (!this.deps.settings().led_enabled) return

    const prefix = await this.prefix()
    if (!prefix) return

    try {
      await this.deps.ha.callService('esphome', `${prefix}_${action}`, data)
    } catch (error) {
      // Deliberately swallowed. The cartridge still played; only the light did
      // not follow. Raising here would turn a cosmetic failure into a failed
      // scan, which is far worse than a stale colour.
      log.debug(`${action} failed: ${(error as Error).message}`)
      // Force rediscovery — the usual cause is a renamed or replaced reader.
      this.discoveredAt = Number.NEGATIVE_INFINITY
    }
  }

  /**
   * `color` asks the reader to wear that colour for this state instead of the
   * one in its palette — used to give a playing cartridge the colour of its own
   * artwork.
   *
   * Falls back to the plain call on firmware that predates it, rather than
   * failing. A reader that has not been reflashed should light up in the
   * palette colour, not stay dark.
   */
  /**
   * Whether the reader is connected, and what it is called.
   *
   * Home Assistant registers an ESPHome device's actions when it connects and
   * removes them when it drops, so the presence of `<device>_set_status` is the
   * device's own liveness — no entity naming to guess at, no device registry to
   * walk, and it cannot be fooled by a renamed entity. It is the same list the
   * light already fetches to find the reader in the first place.
   */
  async describe(): Promise<{
    connected: boolean
    device: string | null
    supportsColor: boolean
  }> {
    // Straight past the cache: this is the question "is it there right now",
    // and answering it from a five-minute-old list would defeat the point.
    this.discoveredAt = Number.NEGATIVE_INFINITY

    const prefix = await this.prefix()
    if (!prefix) return { connected: false, device: null, supportsColor: false }

    return {
      connected: true,
      // Back to how it is written on the device itself.
      device: prefix.replace(/_/g, '-'),
      supportsColor: await this.supports('set_status_color'),
    }
  }

  async setStatus(state: ReaderStatus, color?: string | null): Promise<void> {
    if (color && (await this.supports('set_status_color'))) {
      await this.call('set_status_color', { state, color: color.replace(/^#/, '') })
      return
    }
    await this.call('set_status', { state })
  }

  /**
   * Sends the whole palette. Called at startup, whenever settings are saved,
   * and on a slow timer — the reader holds colours in RAM, so a reader that
   * rebooted is back on its built-in defaults with no way to say so.
   */
  async pushPalette(): Promise<void> {
    await this.call('set_palette', { palette: packPalette(this.deps.settings().led_palette) })
  }
}
