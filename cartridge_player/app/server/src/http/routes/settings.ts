import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../../context.js'
import type { Settings } from '../../types.js'
import { AppError } from '../../errors.js'
import { hashPin } from '../pin.js'
import { ensureAddonSlug } from '../../ha/supervisor.js'
import { normalizePalette } from '../../core/reader-light.js'

const putBody = z.object({
  target_type: z.string().min(1).optional(),
  remote_entity: z.string().nullable().optional(),
  media_player_entity: z.string().nullable().optional(),
  home_first_enabled: z.boolean().optional(),
  home_delay_ms: z.number().int().min(0).max(60_000).optional(),
  autoplay_enabled: z.boolean().optional(),
  autoplay_delay_ms: z.number().int().min(0).max(60_000).optional(),
  removal_action: z.enum(['none', 'pause', 'back', 'home', 'off']).optional(),
  music_player_entity: z.string().nullable().optional(),
  music_removal_action: z.enum(['none', 'pause', 'stop']).optional(),
  led_enabled: z.boolean().optional(),
  led_playing_mode: z.enum(['hold', 'confirm', 'off']).optional(),
  led_palette: z
    .record(
      z.string(),
      z.object({
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        brightness: z.number().int().min(0).max(100),
      }),
    )
    .optional(),
  reader_device: z.string().nullable().optional(),
  public_base_url: z.string().nullable().optional(),
  setup_complete: z.boolean().optional(),
  /** Write-only. `null` clears it; the hash is never returned. */
  pin: z.string().min(4).max(64).nullable().optional(),
})

export interface PublicSettings extends Omit<Settings, 'pin_hash'> {
  pin_set: boolean
  direct_mode: {
    enabled: boolean
    port: number
    /** False when direct mode was requested but refused for want of a PIN (§3.4). */
    running: boolean
  }
  /** Stable, bookmarkable panel URL for the home-screen icon (§3.4, §8.6). */
  panel_url: string | null
  addon_slug: string | null
}

export function toPublicSettings(ctx: AppContext): PublicSettings {
  const { pin_hash, ...rest } = ctx.store.getSettings()
  const directRequested = ctx.config.directPort !== 0
  const base = rest.public_base_url?.replace(/\/+$/, '') ?? null

  return {
    ...rest,
    pin_set: pin_hash !== null,
    direct_mode: {
      enabled: directRequested,
      port: ctx.config.directPort,
      running: ctx.directListening,
    },
    panel_url:
      base && ctx.addonSlug ? `${base}/hassio/ingress/${ctx.addonSlug}` : null,
    addon_slug: ctx.addonSlug,
  }
}

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/settings', async () => {
    // The panel URL needs the slug; keep trying if Supervisor was down at boot.
    await ensureAddonSlug(ctx)
    return { settings: toPublicSettings(ctx) }
  })

  app.put('/api/settings', async (request) => {
    const { pin, ...rest } = putBody.parse(request.body)

    if (rest.target_type !== undefined && !ctx.targets.has(rest.target_type)) {
      throw new AppError('unknown_target', `No target named "${rest.target_type}"`, 400)
    }

    const patch: Record<string, unknown> = { ...rest }
    if (pin !== undefined) {
      patch.pin_hash = pin === null ? null : hashPin(pin)
    }
    // Stored as JSON, sent to the reader packed. The packed form is a wire
    // detail for the last hop and has no business in the database.
    if (rest.led_palette !== undefined) {
      patch.led_palette = JSON.stringify(normalizePalette(rest.led_palette as never))
    }

    ctx.store.updateSettings(patch)

    // Straight after the write, so dragging a colour picker shows up on the
    // reader immediately rather than at the next scan.
    if (rest.led_palette !== undefined || rest.led_enabled !== undefined) {
      void ctx.light.pushPalette()
    }
    // Setting a PIN is what unblocks the direct listener; bring it up now rather
    // than making the user restart the add-on.
    ctx.onSettingsChanged?.()
    return { settings: toPublicSettings(ctx) }
  })
}
