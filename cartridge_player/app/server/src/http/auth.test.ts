import { afterEach, describe, expect, it } from 'vitest'
import { buildServer } from './server.js'
import { resolveDirectMode } from './direct.js'
import { hashPin, verifyPin } from './pin.js'
import { testContext, type TestContext } from '../test/context.js'

let active: TestContext | null = null

function setup(env?: Record<string, string>) {
  active = testContext(env)
  return active.ctx
}

afterEach(() => {
  active?.cleanup()
  active = null
})

describe('PIN hashing', () => {
  it('verifies a correct PIN and rejects a wrong one', () => {
    const hash = hashPin('4821')
    expect(verifyPin('4821', hash)).toBe(true)
    expect(verifyPin('4822', hash)).toBe(false)
    expect(verifyPin('4821', null)).toBe(false)
    expect(verifyPin('4821', 'garbage')).toBe(false)
  })

  it('salts, so the same PIN hashes differently every time', () => {
    expect(hashPin('4821')).not.toBe(hashPin('4821'))
  })
})

describe('direct mode refuses to start without a PIN (§3.4)', () => {
  it('stays off when a port is set but no PIN exists', () => {
    const decision = resolveDirectMode(8100, null)
    expect(decision.start).toBe(false)
    expect(decision.reason).toBe('no_pin')
  })

  it('starts once a PIN exists', () => {
    expect(resolveDirectMode(8100, hashPin('4821')).start).toBe(true)
  })

  it('stays off when direct mode was never requested', () => {
    expect(resolveDirectMode(0, hashPin('4821'))).toMatchObject({
      start: false,
      reason: 'disabled',
    })
  })
})

describe('ingress listener', () => {
  it('never prompts for a PIN, even when one is set', async () => {
    const ctx = setup()
    ctx.store.updateSettings({ pin_hash: hashPin('4821') })
    const app = buildServer(ctx, { requirePin: false })

    const cards = await app.inject({ method: 'GET', url: '/api/cards' })
    expect(cards.statusCode).toBe(200)

    const status = await app.inject({ method: 'GET', url: '/api/auth/status' })
    expect(status.json()).toMatchObject({ required: false, authenticated: true })

    await app.close()
  })
})

describe('direct listener', () => {
  it('rejects API calls without a session', async () => {
    const ctx = setup({ CARTRIDGE_DIRECT_PORT: '8100' })
    ctx.store.updateSettings({ pin_hash: hashPin('4821') })
    const app = buildServer(ctx, { requirePin: true })

    const response = await app.inject({ method: 'GET', url: '/api/cards' })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: 'pin_required' })

    await app.close()
  })

  it('lets a correct PIN through and keeps the session for later calls', async () => {
    const ctx = setup({ CARTRIDGE_DIRECT_PORT: '8100' })
    ctx.store.updateSettings({ pin_hash: hashPin('4821') })
    const app = buildServer(ctx, { requirePin: true })

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { pin: '4821' },
    })
    expect(login.statusCode).toBe(200)

    const cookie = login.cookies[0]!
    const cards = await app.inject({
      method: 'GET',
      url: '/api/cards',
      cookies: { [cookie.name]: cookie.value },
    })
    expect(cards.statusCode).toBe(200)

    await app.close()
  })

  it('rejects a wrong PIN', async () => {
    const ctx = setup({ CARTRIDGE_DIRECT_PORT: '8100' })
    ctx.store.updateSettings({ pin_hash: hashPin('4821') })
    const app = buildServer(ctx, { requirePin: true })

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { pin: '9999' },
    })
    expect(login.statusCode).toBe(401)
    expect(login.cookies).toHaveLength(0)

    await app.close()
  })

  it('rejects a forged session cookie', async () => {
    const ctx = setup({ CARTRIDGE_DIRECT_PORT: '8100' })
    ctx.store.updateSettings({ pin_hash: hashPin('4821') })
    const app = buildServer(ctx, { requirePin: true })

    const response = await app.inject({
      method: 'GET',
      url: '/api/cards',
      cookies: { cartridge_session: `${Date.now() + 100000}.forged` },
    })
    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('still serves the SPA so the PIN screen can render', async () => {
    const ctx = setup({ CARTRIDGE_DIRECT_PORT: '8100' })
    ctx.store.updateSettings({ pin_hash: hashPin('4821') })
    const app = buildServer(ctx, { requirePin: true })

    const response = await app.inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('<div id="root">')

    await app.close()
  })
})

describe('settings never leak the PIN', () => {
  it('returns pin_set instead of pin_hash', async () => {
    const ctx = setup()
    const app = buildServer(ctx, { requirePin: false })

    await app.inject({ method: 'PUT', url: '/api/settings', payload: { pin: '4821' } })
    const response = await app.inject({ method: 'GET', url: '/api/settings' })

    const body = response.json() as { settings: Record<string, unknown> }
    expect(body.settings.pin_set).toBe(true)
    expect(body.settings.pin_hash).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('scrypt')

    await app.close()
  })
})
