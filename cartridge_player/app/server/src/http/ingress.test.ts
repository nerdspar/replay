import { afterEach, describe, expect, it } from 'vitest'
import { buildServer } from './server.js'
import { testContext, type TestContext } from '../test/context.js'

let active: TestContext | null = null

function setup() {
  active = testContext()
  return active.ctx
}

afterEach(() => {
  active?.cleanup()
  active = null
})

/**
 * §3.3 — "the single most likely thing to break". Ingress mounts the app under a
 * rotating `/api/hassio_ingress/<token>/`, and relative resolution against a URL
 * with no trailing slash silently drops the last segment.
 */
describe('ingress base path', () => {
  it('anchors relative URLs to the ingress path from X-Ingress-Path', async () => {
    const app = buildServer(setup(), { requirePin: false })

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-ingress-path': '/api/hassio_ingress/AbC123' },
    })

    expect(response.body).toContain('<base href="/api/hassio_ingress/AbC123/">')
    await app.close()
  })

  it('always emits a trailing slash, even if the header lacks one', async () => {
    const app = buildServer(setup(), { requirePin: false })

    for (const header of ['/api/hassio_ingress/AbC123', '/api/hassio_ingress/AbC123/']) {
      const response = await app.inject({
        method: 'GET',
        url: '/',
        headers: { 'x-ingress-path': header },
      })
      expect(response.body).toContain('<base href="/api/hassio_ingress/AbC123/">')
    }

    await app.close()
  })

  it('falls back to root outside ingress', async () => {
    const app = buildServer(setup(), { requirePin: false })
    const response = await app.inject({ method: 'GET', url: '/' })
    expect(response.body).toContain('<base href="/">')
    await app.close()
  })

  it('is never cached against one session token', async () => {
    const app = buildServer(setup(), { requirePin: false })
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-ingress-path': '/api/hassio_ingress/AbC123' },
    })
    expect(response.headers['cache-control']).toBe('no-store')
    await app.close()
  })

  it('serves the app for an unknown deep path but still 404s the API', async () => {
    const app = buildServer(setup(), { requirePin: false })

    const spa = await app.inject({ method: 'GET', url: '/some/stale/shortcut' })
    expect(spa.statusCode).toBe(200)
    expect(spa.body).toContain('<div id="root">')

    const api = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(api.statusCode).toBe(404)
    expect(api.json()).toMatchObject({ error: 'not_found' })

    await app.close()
  })
})

describe('generated web manifest (§3.4)', () => {
  it('uses a relative start_url until the host is configured', async () => {
    const app = buildServer(setup(), { requirePin: false })
    const response = await app.inject({ method: 'GET', url: '/manifest.webmanifest' })

    expect(response.headers['content-type']).toContain('application/manifest+json')
    expect(response.json()).toMatchObject({ display: 'standalone', start_url: './' })

    await app.close()
  })

  it('uses the stable panel URL once the host and slug are known', async () => {
    const ctx = setup()
    ctx.addonSlug = 'a0d7b954_cartridge_player'
    ctx.store.updateSettings({ public_base_url: 'https://ha.example.com:8123/' })

    const app = buildServer(ctx, { requirePin: false })
    const response = await app.inject({ method: 'GET', url: '/manifest.webmanifest' })

    // Not the session path — that rotates and cannot be a start_url.
    expect(response.json()).toMatchObject({
      start_url: 'https://ha.example.com:8123/hassio/ingress/a0d7b954_cartridge_player',
      display: 'standalone',
    })

    await app.close()
  })

  it('exposes the same panel URL through settings for copying', async () => {
    const ctx = setup()
    ctx.addonSlug = 'a0d7b954_cartridge_player'
    ctx.store.updateSettings({ public_base_url: 'https://ha.example.com:8123' })

    const app = buildServer(ctx, { requirePin: false })
    const response = await app.inject({ method: 'GET', url: '/api/settings' })

    expect((response.json() as { settings: { panel_url: string } }).settings.panel_url).toBe(
      'https://ha.example.com:8123/hassio/ingress/a0d7b954_cartridge_player',
    )

    await app.close()
  })
})
