import fs from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../../context.js'
import { AppError } from '../../errors.js'
import {
  MAX_IMPORT_BYTES,
  MAX_UPLOAD_BYTES,
  artworkNameFromUrl,
  detectImageExtension,
  isPrivateHost,
  resolveImportUrl,
} from '../../artwork/store.js'

const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp']

const artworkQuery = z.object({
  season: z.coerce.number().int().optional(),
  episode: z.coerce.number().int().optional(),
})

/** Names of every uploaded image a card currently points at. */
export function referencedArtwork(ctx: AppContext): Set<string> {
  const names = new Set<string>()
  for (const card of ctx.store.listCards()) {
    // Both, because a card's original artwork stays offered in the picker for
    // as long as the card exists — collecting it would break the way back.
    for (const url of [card.poster_url, card.original_poster_url]) {
      const name = artworkNameFromUrl(url)
      if (name) names.add(name)
    }
  }
  return names
}

export function collectArtworkGarbage(ctx: AppContext): void {
  try {
    ctx.artwork.collectGarbage(referencedArtwork(ctx))
  } catch {
    // Housekeeping must never fail a user's action.
  }
}

export function registerArtworkRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Raw image bodies. Avoids a multipart dependency for a single-file upload.
  app.addContentTypeParser(
    UPLOAD_TYPES,
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
    (_request, body, done) => done(null, body),
  )

  /** Artwork the provider can offer for a title. */
  app.get<{ Params: { provider: string; type: string; id: string } }>(
    '/api/artwork/:provider/:type/:id',
    async (request) => {
      const { provider: providerId, type, id } = request.params
      const { season, episode } = artworkQuery.parse(request.query)
      const provider = ctx.providers.get(providerId)

      const options = await provider.getArtwork(type, id, {
        season: season ?? null,
        episode: episode ?? null,
      })
      return { provider: provider.id, options }
    },
  )

  /**
   * Upload your own. The browser downscales first (§3.5) — this is the backstop.
   */
  app.post('/api/artwork/upload', async (request, reply) => {
    const body = request.body
    if (!Buffer.isBuffer(body)) {
      throw new AppError(
        'unsupported_image',
        'Send the image as a PNG, JPEG, or WebP body.',
        415,
      )
    }

    const saved = ctx.artwork.save(body)
    reply.code(201)
    return { artwork: { id: 'custom', url: saved.url, kind: 'custom', label: 'Your image', aspect: 'portrait' } }
  })

  /**
   * Relays ONE image the user picked on an allowlisted site, so the browser can
   * downscale it and upload it through the normal path. Nothing is stored here:
   * the full-size original never touches `/data` (§3.5), and the copy that does
   * is the same bounded, resized JPEG any other upload produces.
   */
  app.get('/api/artwork/fetch', async (request, reply) => {
    const { url } = z.object({ url: z.string().min(1) }).parse(request.query)
    const target = resolveImportUrl(url)

    let upstream: Response
    try {
      upstream = await fetch(target, {
        redirect: 'error',
        headers: { accept: 'image/*' },
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new AppError(
        'import_failed',
        `Could not download that image: ${(error as Error).message}`,
        502,
      )
    }

    if (!upstream.ok) {
      throw new AppError(
        'import_failed',
        `That link returned ${upstream.status}. Check it opens in your browser.`,
        502,
      )
    }

    const body = Buffer.from(await upstream.arrayBuffer())
    if (body.length > MAX_IMPORT_BYTES) {
      throw new AppError('import_too_large', 'That image is unusually large.', 413)
    }

    const ext = detectImageExtension(body)
    if (!ext) {
      throw new AppError('unsupported_image', 'That link is not an image.', 415)
    }

    reply
      .type(ext === 'jpg' ? 'image/jpeg' : `image/${ext}`)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
    return reply.send(body)
  })

  /**
   * Serves a card's artwork from our own origin.
   *
   * Exporting a sticker means drawing the poster onto a canvas, and a canvas
   * that has touched a cross-origin image cannot be read back — the export
   * throws a SecurityError. Poster hosts do not send CORS headers, so the bytes
   * have to come through here.
   *
   * Takes a CARD ID, never a URL: the address fetched is one the server looked
   * up, which is what keeps this from being an open proxy.
   */
  app.get<{ Params: { id: string } }>('/api/artwork/card/:id', async (request, reply) => {
    const card = ctx.store.getCard(Number(request.params.id))
    if (!card?.poster_url) throw new AppError('not_found', 'No artwork for that card', 404)

    // Already ours — serve it straight off disk.
    const stored = artworkNameFromUrl(card.poster_url)
    if (stored) {
      const file = ctx.artwork.resolve(stored)
      if (!file) throw new AppError('not_found', 'No such image', 404)
      reply.type(file.contentType).header('x-content-type-options', 'nosniff')
      return reply.send(fs.createReadStream(file.path))
    }

    let target: URL
    try {
      target = new URL(card.poster_url)
    } catch {
      throw new AppError('not_found', 'That artwork is not a fetchable image', 404)
    }
    if (target.protocol !== 'https:' || isPrivateHost(target.hostname)) {
      throw new AppError('not_found', 'That artwork is not a fetchable image', 404)
    }

    let upstream: Response
    try {
      upstream = await fetch(target, {
        redirect: 'follow',
        headers: { accept: 'image/*' },
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new AppError('import_failed', `Could not load that artwork: ${(error as Error).message}`, 502)
    }
    if (!upstream.ok) {
      throw new AppError('import_failed', `Artwork host returned ${upstream.status}`, 502)
    }

    const body = Buffer.from(await upstream.arrayBuffer())
    const ext = detectImageExtension(body)
    if (!ext) throw new AppError('unsupported_image', 'That artwork is not an image', 415)

    reply
      .type(ext === 'jpg' ? 'image/jpeg' : `image/${ext}`)
      .header('cache-control', 'private, max-age=3600')
      .header('x-content-type-options', 'nosniff')
    return reply.send(body)
  })

  app.get<{ Params: { name: string } }>('/api/artwork/file/:name', async (request, reply) => {
    const file = ctx.artwork.resolve(request.params.name)
    if (!file) throw new AppError('not_found', 'No such image', 404)

    reply
      .type(file.contentType)
      // Content-addressed, so the bytes behind a name never change.
      .header('cache-control', 'private, max-age=31536000, immutable')
      // A stored file must never be interpreted as anything but an image.
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('content-disposition', 'inline')

    return reply.send(fs.createReadStream(file.path))
  })
}
