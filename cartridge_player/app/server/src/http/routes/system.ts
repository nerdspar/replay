import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../../context.js'
import type { AppEvent } from '../../core/events.js'
import { ensureAddonSlug } from '../../ha/supervisor.js'
import { formatPlatform } from '../../ha/entity-registry.js'
import type { EntityOption } from '../../ha/rest.js'

const SSE_KEEPALIVE_MS = 20_000

function writeEvent(reply: FastifyReply, event: AppEvent | { type: 'hello' }): void {
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

/** The integration a Music Assistant speaker entity comes from. */
const MUSIC_PLATFORM = 'music_assistant'

export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Supervisor's watchdog target. Deliberately trivial: no database, no Home
   * Assistant call, no auth. It answers "is this process still serving HTTP",
   * which is the only question a watchdog should ask — anything richer risks
   * restarting a healthy add-on because something upstream is down.
   */
  app.get('/health', async () => ({ ok: true }))

  /**
   * Setup dropdowns (§8.3), annotated with the integration each entity came
   * from. Friendly names collide — running Music Assistant alongside a native
   * integration gives two media players with the same name — and the
   * integration is what tells them apart.
   */
  app.get('/api/entities', async () => {
    const [{ remotes, mediaPlayers }, platforms] = await Promise.all([
      ctx.ha.getTargetEntities(),
      ctx.entityPlatforms(),
    ])

    const annotate = (entity: EntityOption): EntityOption => {
      const origin = platforms.get(entity.entity_id)
      return origin ? { ...entity, platform: formatPlatform(origin.platform) } : entity
    }

    const annotated = mediaPlayers.map(annotate)

    return {
      remotes: remotes.map(annotate),
      mediaPlayers: annotated,
      // The speaker picker offers only what Music Assistant can actually play
      // to. Every media player in the house would list the TV and the doorbell.
      musicPlayers: annotated.filter(
        (entity) => platforms.get(entity.entity_id)?.platform === MUSIC_PLATFORM,
      ),
    }
  })

  /**
   * "Did the TV react?" in the first-run wizard (§8.3 step 2). Abstract keys
   * only — the route stays correct for any future target.
   */
  app.post('/api/target/key', async (request) => {
    const { key } = z
      .object({ key: z.enum(['home', 'select', 'back']) })
      .parse(request.body)
    // Always the video target: this is the wizard asking "did the TV react?",
    // and a speaker has no keys to send.
    const target = ctx.targets.createFor('video', ctx.store.getSettings())
    await target.sendKey(key)
    return { ok: true }
  })

  /** Poll fallback for SSE, and the recovery path after backgrounding (§8.2). */
  app.get('/api/pending', async () => ({
    pending: ctx.pending.get(),
    connection: ctx.connection,
  }))

  app.get('/api/scans', async (request) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(request.query)
    return {
      scans: ctx.store.listScans(limit),
      connection: ctx.connection,
      last_error: ctx.lastError,
    }
  })

  /** Removes a stray tag from "seen but not assigned". */
  app.delete<{ Params: { uid: string } }>('/api/scans/:uid', async (request) => {
    const uid = request.params.uid
    const removed = ctx.store.deleteScansByUid(uid)

    // If it is the tag currently waiting to be assigned, stop offering it.
    ctx.pending.clear(uid)
    ctx.bus.emit({ type: 'pending', pending: ctx.pending.get() })
    ctx.bus.emit({ type: 'cards' })

    return { removed }
  })

  app.get('/api/events', (request, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Ingress sits behind a proxy; without this the stream can be buffered.
      'x-accel-buffering': 'no',
    })

    // Send current state immediately so a client that reconnected after being
    // backgrounded is correct without waiting for the next scan.
    writeEvent(reply, { type: 'connection', ...ctx.connection })
    writeEvent(reply, { type: 'pending', pending: ctx.pending.get() })

    const unsubscribe = ctx.bus.subscribe((event) => writeEvent(reply, event))
    const keepalive = setInterval(() => reply.raw.write(': keepalive\n\n'), SSE_KEEPALIVE_MS)

    const cleanup = () => {
      clearInterval(keepalive)
      unsubscribe()
    }
    request.raw.on('close', cleanup)
    request.raw.on('error', cleanup)
  })

  /**
   * §3.4 — `start_url` must be the stable panel URL, not a relative path: the
   * ingress session path rotates. Generated from the configured hostname.
   */
  app.get('/manifest.webmanifest', async (request, reply) => {
    await ensureAddonSlug(ctx)
    const settings = ctx.store.getSettings()
    const base = settings.public_base_url?.replace(/\/+$/, '') ?? null
    const startUrl =
      base && ctx.addonSlug ? `${base}/hassio/ingress/${ctx.addonSlug}` : './'

    reply.header('content-type', 'application/manifest+json')
    reply.header('cache-control', 'no-cache')
    return {
      name: 'Cartridge Player',
      short_name: 'Cartridges',
      description: 'Tap NFC cartridges to launch shows on your TV',
      display: 'standalone',
      orientation: 'portrait',
      start_url: startUrl,
      scope: startUrl,
      background_color: '#12111a',
      theme_color: '#12111a',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }
  })
}
