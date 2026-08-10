import type { FastifyInstance } from 'fastify'
import { loadConfig } from './config.js'
import { createContext } from './context.js'
import { createLogger } from './log.js'
import { HomeAssistantWs } from './ha/ws.js'
import { ensureAddonSlug } from './ha/supervisor.js'
import { createEntityPlatformLookup } from './ha/entity-registry.js'
import { buildServer } from './http/server.js'
import { resolveDirectMode } from './http/direct.js'

const log = createLogger('main')

export const EVENT_INSERTED = 'esphome.nfc_card_inserted'
export const EVENT_REMOVED = 'esphome.nfc_card_removed'

function readUid(data: Record<string, unknown>): string | null {
  const uid = data.uid
  return typeof uid === 'string' && uid.trim() !== '' ? uid.trim() : null
}

async function main(): Promise<void> {
  const config = loadConfig()
  const ctx = createContext(config)

  // Best effort at boot; retried lazily on the routes that need it.
  await ensureAddonSlug(ctx)

  // The add-on is the entire integration surface: no automation, no helper
  // entities, nothing for the user to wire up (§3.2).
  const ws = new HomeAssistantWs({
    url: config.haWsUrl,
    token: config.supervisorToken,
    eventTypes: [EVENT_INSERTED, EVENT_REMOVED],
    onStateChange: (state, detail) =>
      ctx.bus.emit(detail ? { type: 'connection', state, detail } : { type: 'connection', state }),
    onEvent: (event) => {
      const uid = readUid(event.data)
      if (!uid) return
      const handle =
        event.event_type === EVENT_INSERTED
          ? ctx.scans.handleInserted(uid)
          : event.event_type === EVENT_REMOVED
            ? ctx.scans.handleRemoved(uid)
            : null
      handle?.catch((error: Error) => {
        log.error(`handler threw for ${event.event_type}: ${error.message}`)
        ctx.bus.emit({ type: 'error', message: error.message })
      })
    },
  })
  ws.start()

  // Lets the setup dropdowns say which integration each entity came from.
  ctx.entityPlatforms = createEntityPlatformLookup(ws)

  const ingress = buildServer(ctx, { requirePin: false })
  await ingress.listen({ host: '0.0.0.0', port: config.ingressPort })
  log.info(`ingress listening on ${config.ingressPort}`)

  let direct: FastifyInstance | null = null

  const startDirectIfPossible = async (): Promise<void> => {
    if (direct !== null) return

    const decision = resolveDirectMode(config.directPort, ctx.store.getSettings().pin_hash)
    if (!decision.start) {
      if (decision.reason === 'no_pin') log.warn(decision.message)
      return
    }

    direct = buildServer(ctx, { requirePin: true })
    await direct.listen({ host: '0.0.0.0', port: config.directPort })
    ctx.directListening = true
    log.info(decision.message)
  }

  ctx.onSettingsChanged = () => {
    startDirectIfPossible().catch((error: Error) =>
      log.error(`could not start direct listener: ${error.message}`),
    )
  }
  await startDirectIfPossible()

  const shutdown = async (signal: string): Promise<void> => {
    log.info(`${signal} received, shutting down`)
    ws.stop()
    await Promise.allSettled([ingress.close(), direct?.close()])
    ctx.store.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error: Error) => {
  log.error(`fatal: ${error.stack ?? error.message}`)
  process.exit(1)
})
