import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../../context.js'
import { AppError } from '../../errors.js'
import { collectArtworkGarbage } from './artwork.js'

const contentType = z.enum([
  'movie',
  'series',
  'album',
  'playlist',
  'artist',
  'track',
  'radio',
  'podcast',
  'audiobook',
])

const createBody = z.object({
  tag_uid: z.string().min(1),
  provider: z.string().min(1).optional(),
  content_type: contentType,
  external_id: z.string().min(1),
  title: z.string().min(1),
  year: z.string().nullable().optional(),
  poster_url: z.string().nullable().optional(),
  season: z.number().int().nullable().optional(),
  episode: z.number().int().nullable().optional(),
  label: z.string().nullable().optional(),
  player_entity: z.string().nullable().optional(),
  art_fit: z.enum(['crop', 'blur', 'color']).nullable().optional(),
  shuffle: z.boolean().optional(),
  radio_mode: z.boolean().optional(),
  accent_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
})

const patchBody = createBody.partial().omit({ tag_uid: true })

export function registerCardRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/cards', async () => ({ cards: ctx.store.listCards() }))

  app.post('/api/cards', async (request, reply) => {
    const body = createBody.parse(request.body)
    const provider = body.provider ?? ctx.providers.defaultProviderId
    // Resolving here means an unknown provider is rejected at assignment time,
    // not at 2am when someone taps the cartridge.
    ctx.providers.get(provider)

    const now = Date.now()
    const content = {
      provider,
      content_type: body.content_type,
      external_id: body.external_id,
      title: body.title,
      year: body.year ?? null,
      poster_url: body.poster_url ?? null,
      season: body.season ?? null,
      episode: body.episode ?? null,
      label: body.label ?? null,
      player_entity: body.player_entity ?? null,
      art_fit: body.art_fit ?? null,
      shuffle: body.shuffle ?? false,
      radio_mode: body.radio_mode ?? false,
      accent_color: body.accent_color ?? null,
      // Never client-supplied: it records what the player was doing, and only
      // this add-on is in a position to know that.
      resume_hint: null,
    }

    const existing = ctx.store.findCardByUid(body.tag_uid)

    if (existing && existing.status === 'assigned') {
      throw new AppError(
        'uid_taken',
        `That cartridge is already assigned to "${existing.title}".`,
        409,
      )
    }

    // An emptied cartridge keeps its row, so filling it again is an update.
    // Without this, refilling one would collide with its own tag.
    const card = existing
      ? ctx.store.updateCard(existing.id, { ...content, status: 'assigned' }, now)!
      : ctx.store.createCard({ tag_uid: body.tag_uid, ...content }, now)

    ctx.pending.clear(body.tag_uid)
    ctx.bus.emit({ type: 'pending', pending: ctx.pending.get() })
    ctx.bus.emit({ type: 'cards' })

    reply.code(201)
    return { card }
  })

  app.patch<{ Params: { id: string } }>('/api/cards/:id', async (request) => {
    const id = Number(request.params.id)
    const patch = patchBody.parse(request.body)

    // Giving an emptied cartridge something to play makes it assigned again.
    const restores = patch.external_id !== undefined || patch.title !== undefined
    const card = ctx.store.updateCard(
      id,
      restores ? { ...patch, status: 'assigned' } : patch,
      Date.now(),
    )
    if (!card) throw new AppError('not_found', 'No such card', 404)
    // A replaced custom image may now be unreferenced.
    collectArtworkGarbage(ctx)
    ctx.bus.emit({ type: 'cards' })
    return { card }
  })

  /**
   * Empties a cartridge without forgetting it. The physical thing is still on
   * the shelf, so it stays in the library as a bare tag, ready to be filled.
   */
  app.post<{ Params: { id: string } }>('/api/cards/:id/unassign', async (request) => {
    const id = Number(request.params.id)
    if (!ctx.store.getCard(id)) throw new AppError('not_found', 'No such card', 404)

    const card = ctx.store.unassignCard(id, Date.now())
    ctx.bus.emit({ type: 'cards' })
    return { card }
  })

  /** Forgets the cartridge entirely — for one that is lost or damaged. */
  app.delete<{ Params: { id: string } }>('/api/cards/:id', async (request) => {
    const id = Number(request.params.id)
    if (!ctx.store.deleteCard(id)) {
      throw new AppError('not_found', 'No such card', 404)
    }
    collectArtworkGarbage(ctx)
    ctx.bus.emit({ type: 'cards' })
    return { ok: true }
  })

  /** Re-runs the whole fire sequence on demand (§6.2). */
  app.post<{ Params: { id: string } }>('/api/cards/:id/test', async (request) => {
    const card = ctx.store.getCard(Number(request.params.id))
    if (!card) throw new AppError('not_found', 'No such card', 404)

    const outcome = await ctx.scans.fire(card)
    return { scan: outcome.scan, ok: outcome.scan.error === null }
  })
}
