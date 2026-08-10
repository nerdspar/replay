import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../../context.js'
import { AppError } from '../../errors.js'
import { SESSION_COOKIE, issueSession, verifyPin } from '../pin.js'

const loginBody = z.object({ pin: z.string().min(1) })

/**
 * Only mounted with a live gate on the LAN-direct listener. Through ingress,
 * Home Assistant has already authenticated the user and this never prompts (§3.4).
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  requirePin: boolean,
): void {
  app.get('/api/auth/status', async (request) => ({
    required: requirePin,
    pin_set: ctx.store.getSettings().pin_hash !== null,
    authenticated: !requirePin || request.pinAuthenticated === true,
  }))

  app.post('/api/auth/login', async (request, reply) => {
    if (!requirePin) return { authenticated: true }

    const { pin } = loginBody.parse(request.body)
    const { pin_hash } = ctx.store.getSettings()
    if (!verifyPin(pin, pin_hash)) {
      throw new AppError('bad_pin', 'That PIN is not right.', 401)
    }

    reply.setCookie(SESSION_COOKIE, issueSession(ctx.sessionSecret), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
    })
    return { authenticated: true }
  })

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { authenticated: false }
  })
}
