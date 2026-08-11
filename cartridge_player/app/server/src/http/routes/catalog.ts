import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../../context.js'
import type { ContentType } from '../../types.js'

const searchQuery = z.object({
  q: z.string().default(''),
  /*
    `music` is a deliberate widening rather than a content type: the music tab
    has one search box, because putting six toggles (album, artist, playlist,
    radio, podcast, audiobook) above a phone keyboard would be worse than
    showing everything and labelling each result. Providers narrow when given a
    real type and search across their whole vocabulary otherwise.
  */
  type: z
    .enum([
      'movie',
      'series',
      'music',
      'album',
      'playlist',
      'artist',
      'track',
      'radio',
      'podcast',
      'audiobook',
    ])
    .default('movie'),
  // Required by contract, defaulted server-side so the shape stays stable when a
  // second provider lands (§7).
  provider: z.string().optional(),
})

/**
 * Provider APIs are proxied server-side rather than called from the browser:
 * keeps CORS out of the picture and centralises caching (§7).
 */
export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/search', async (request) => {
    const { q, type, provider: providerId } = searchQuery.parse(request.query)
    const provider = ctx.providers.get(providerId ?? ctx.providers.defaultProviderId)
    const results = await provider.search(q, type as ContentType)
    return { provider: provider.id, results }
  })

  app.get<{ Params: { provider: string; type: string; id: string } }>(
    '/api/meta/:provider/:type/:id',
    async (request) => {
      const { provider: providerId, type, id } = request.params
      const provider = ctx.providers.get(providerId)
      const meta = await provider.getMeta(type, id)
      return { provider: provider.id, meta }
    },
  )
}
