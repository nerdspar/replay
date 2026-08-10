import fs from 'node:fs'
import path from 'node:path'
import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { ZodError } from 'zod'
import type { AppContext } from '../context.js'
import { AppError } from '../errors.js'
import { createLogger } from '../log.js'
import { SESSION_COOKIE, verifySession } from './pin.js'
import { registerArtworkRoutes } from './routes/artwork.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerCardRoutes } from './routes/cards.js'
import { registerCatalogRoutes } from './routes/catalog.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerSystemRoutes } from './routes/system.js'

declare module 'fastify' {
  interface FastifyRequest {
    pinAuthenticated?: boolean
  }
}

const log = createLogger('http')

export interface BuildServerOptions {
  /**
   * True only for the LAN-direct listener. Ingress traffic has already passed
   * Home Assistant's own auth, so it must never see a PIN prompt (§3.4).
   */
  requirePin: boolean
}

/**
 * Read per request rather than cached: index.html is ~1 kB, page loads are rare,
 * and a cached copy goes stale against a rebuilt bundle — serving markup that
 * points at asset filenames which no longer exist.
 */
function readIndexHtml(webRoot: string): string {
  try {
    return fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8')
  } catch {
    return (
      '<!doctype html><meta charset="utf-8"><title>Cartridge Player</title>' +
      '<p>The web UI is missing from this build.</p>'
    )
  }
}

const OPEN_PATHS = new Set([
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/logout',
])

export function buildServer(ctx: AppContext, options: BuildServerOptions): FastifyInstance {
  const app = fastify({ logger: false, bodyLimit: 1024 * 512 })

  app.register(fastifyCookie)

  app.addHook('onRequest', async (request, reply) => {
    request.pinAuthenticated =
      !options.requirePin ||
      verifySession(request.cookies[SESSION_COOKIE], ctx.sessionSecret)

    if (!options.requirePin) return
    const url = request.url.split('?')[0] ?? ''
    if (!url.startsWith('/api/') || OPEN_PATHS.has(url)) return
    if (request.pinAuthenticated) return

    reply.code(401).send({ error: 'pin_required', message: 'PIN required.' })
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({
        error: 'invalid_request',
        message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      })
      return
    }
    if (error instanceof AppError) {
      reply.code(error.status).send({ error: error.code, message: error.message })
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    log.error(`unhandled error on ${request.method} ${request.url}: ${message}`)
    reply.code(500).send({ error: 'internal_error', message })
  })

  registerAuthRoutes(app, ctx, options.requirePin)
  registerArtworkRoutes(app, ctx)
  registerCardRoutes(app, ctx)
  registerCatalogRoutes(app, ctx)
  registerSettingsRoutes(app, ctx)
  registerSystemRoutes(app, ctx)

  app.register(fastifyStatic, {
    root: path.resolve(ctx.config.webRoot),
    prefix: '/',
    // index.html goes through sendIndex so the <base> tag can be injected.
    index: false,
    // Ingress session paths rotate; nothing here may be cached against one.
    cacheControl: false,
  })

  /**
   * Home Assistant proxies us under `/api/hassio_ingress/<session-token>/`, and
   * that token rotates. Vite builds with `base: './'` and every frontend call is
   * relative — but relative resolution against a URL with no trailing slash
   * silently drops the last segment, which is exactly how ingress breaks.
   *
   * So the one absolute path in the whole app is injected here, from
   * `X-Ingress-Path` (§3.3). Outside ingress it is simply `/`.
   */
  const sendIndex = (request: FastifyRequest, reply: FastifyReply): void => {
    const ingressPath = request.headers['x-ingress-path']
    const raw = Array.isArray(ingressPath) ? ingressPath[0] : ingressPath
    const base = raw && raw.trim() !== '' ? `${raw.replace(/\/+$/, '')}/` : '/'

    reply
      .type('text/html')
      .header('cache-control', 'no-store')
      .send(readIndexHtml(ctx.config.webRoot).replace('<!--BASE-->', `<base href="${base}">`))
  }

  app.get('/', sendIndex)

  // Hash routing keeps every route under `/`, but a stray deep path (or a stale
  // home-screen shortcut) should still land in the app rather than a 404 page.
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET' || request.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'not_found', message: 'No such route' })
      return
    }
    sendIndex(request, reply)
  })

  return app
}
