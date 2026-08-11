import crypto from 'node:crypto'
import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { buildServer } from '../http/server.js'
import {
  MAX_UPLOAD_BYTES,
  artworkNameFromUrl,
  artworkUrl,
  detectImageExtension,
  resolveImportUrl,
} from './store.js'
import { testContext, type TestContext } from '../test/context.js'

let active: TestContext | null = null

afterEach(() => {
  active?.cleanup()
  active = null
})

function setup() {
  active = testContext()
  return active.ctx
}

// Smallest valid-enough headers for each accepted format.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(64, 1),
])

describe('image sniffing', () => {
  it('accepts PNG, JPEG, and WebP by their magic bytes', () => {
    expect(detectImageExtension(PNG)).toBe('png')
    expect(detectImageExtension(JPEG)).toBe('jpg')
    expect(detectImageExtension(WEBP)).toBe('webp')
  })

  it('rejects things that are not images, whatever they claim to be', () => {
    for (const hostile of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      Buffer.from('<!doctype html><script>alert(1)</script>'),
      Buffer.from('GIF89a' + 'x'.repeat(64)),
      Buffer.from('%PDF-1.7' + 'x'.repeat(64)),
      Buffer.alloc(4),
    ]) {
      expect(detectImageExtension(hostile)).toBeNull()
    }
  })
})

describe('ArtworkStore', () => {
  it('content-addresses, so re-uploading the same image costs one file', () => {
    const ctx = setup()
    const first = ctx.artwork.save(PNG)
    const second = ctx.artwork.save(PNG)

    expect(second.name).toBe(first.name)
    expect(ctx.artwork.list()).toEqual([first.name])
    expect(first.name).toBe(`${crypto.createHash('sha256').update(PNG).digest('hex')}.png`)
  })

  it('refuses an oversized image', () => {
    const ctx = setup()
    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)])
    expect(() => ctx.artwork.save(huge)).toThrow(/under 2 MB/)
  })

  it('refuses an empty body', () => {
    const ctx = setup()
    expect(() => ctx.artwork.save(Buffer.alloc(0))).toThrow(/empty/)
  })

  it('resolves only well-formed names', () => {
    const ctx = setup()
    const saved = ctx.artwork.save(JPEG)

    expect(ctx.artwork.resolve(saved.name)?.contentType).toBe('image/jpeg')
    for (const hostile of [
      '../../../etc/passwd',
      '..%2f..%2fcartridge.db',
      'cartridge.db',
      `${saved.name}/../../cartridge.db`,
      'abc.png',
      `${'a'.repeat(64)}.exe`,
    ]) {
      expect(ctx.artwork.resolve(hostile), hostile).toBeNull()
    }
  })

  it('produces a relative URL that survives the ingress base path', () => {
    const name = `${'a'.repeat(64)}.png`
    expect(artworkUrl(name)).toBe(`api/artwork/file/${name}`)
    expect(artworkUrl(name).startsWith('/')).toBe(false)
    expect(artworkNameFromUrl(artworkUrl(name))).toBe(name)
  })

  it('does not mistake a remote poster URL for a stored file', () => {
    expect(artworkNameFromUrl('https://images.metahub.space/poster/medium/tt1/img')).toBeNull()
    expect(artworkNameFromUrl(null)).toBeNull()
  })
})

describe('import allowlist', () => {
  it('accepts a ThePosterDB asset link', () => {
    expect(resolveImportUrl('https://theposterdb.com/api/assets/123').href).toBe(
      'https://theposterdb.com/api/assets/123',
    )
    expect(resolveImportUrl('https://www.theposterdb.com/api/assets/9').href).toBe(
      'https://www.theposterdb.com/api/assets/9',
    )
  })

  it('strips query, fragment, and credentials rather than passing them upstream', () => {
    expect(
      resolveImportUrl('https://theposterdb.com/api/assets/123?token=abc#frag').href,
    ).toBe('https://theposterdb.com/api/assets/123')
  })

  /**
   * This endpoint makes the server fetch a URL a user supplied, so the
   * allowlist is the whole defence. Everything reachable from inside the
   * add-on container must be refused.
   */
  it('refuses anything that is not an allowlisted poster link', () => {
    for (const hostile of [
      'http://supervisor/core/api/states',
      'https://supervisor/addons/self/info',
      'http://127.0.0.1:8099/api/settings',
      'http://169.254.169.254/latest/meta-data/',
      'https://theposterdb.com/api/assets/123/../../etc/passwd',
      'https://theposterdb.com.evil.test/api/assets/123',
      'https://eviltheposterdb.com/api/assets/123',
      'https://theposterdb.com/posters/123',
      'https://theposterdb.com/api/assets/abc',
      'file:///data/cartridge.db',
      'ftp://theposterdb.com/api/assets/1',
      'not a url at all',
      '',
    ]) {
      expect(() => resolveImportUrl(hostile), hostile).toThrow()
    }
  })

  it('refuses plain http even on an allowlisted host', () => {
    expect(() => resolveImportUrl('http://theposterdb.com/api/assets/1')).toThrow(
      /https/i,
    )
  })
})

describe('import over HTTP', () => {
  it('rejects a non-allowlisted URL before making any request', async () => {
    const ctx = setup()
    const app = buildServer(ctx, { requirePin: false })
    const calls: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response('', { status: 200 })
    }) as typeof fetch

    const response = await app.inject({
      method: 'GET',
      url: `/api/artwork/fetch?url=${encodeURIComponent('http://supervisor/core/api/states')}`,
    })

    globalThis.fetch = realFetch
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'bad_import_url' })
    // The point: it never reached out at all.
    expect(calls).toEqual([])

    await app.close()
  })

  it('relays an allowlisted image without storing it', async () => {
    const ctx = setup()
    const app = buildServer(ctx, { requirePin: false })
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } })) as typeof fetch

    const response = await app.inject({
      method: 'GET',
      url: `/api/artwork/fetch?url=${encodeURIComponent('https://theposterdb.com/api/assets/42')}`,
    })

    globalThis.fetch = realFetch
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('image/jpeg')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.from(response.rawPayload).equals(JPEG)).toBe(true)
    // The full-size original must never land in /data (§3.5).
    expect(ctx.artwork.list()).toEqual([])

    await app.close()
  })

  it('rejects an allowlisted link that does not return an image', async () => {
    const ctx = setup()
    const app = buildServer(ctx, { requirePin: false })
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(Buffer.from('<!doctype html><h1>nope</h1>'))) as typeof fetch

    const response = await app.inject({
      method: 'GET',
      url: `/api/artwork/fetch?url=${encodeURIComponent('https://theposterdb.com/api/assets/42')}`,
    })

    globalThis.fetch = realFetch
    expect(response.statusCode).toBe(415)

    await app.close()
  })
})

describe('garbage collection', () => {
  const cardWith = (posterUrl: string | null, uid: string) => ({
    tag_uid: uid,
    provider: 'stremio',
    content_type: 'movie' as const,
    external_id: 'tt1',
    title: 'x',
    year: null,
    poster_url: posterUrl,
    season: null,
    episode: null,
    label: null,
  })

  it('keeps images a card points at and deletes the rest', async () => {
    const ctx = setup()
    const kept = ctx.artwork.save(PNG)
    const orphan = ctx.artwork.save(JPEG)
    ctx.store.createCard(cardWith(kept.url, '04-01'), 1)

    const app = buildServer(ctx, { requirePin: false })
    // Any card mutation triggers housekeeping.
    await app.inject({ method: 'PATCH', url: '/api/cards/1', payload: { label: 'blue' } })
    await app.close()

    expect(ctx.artwork.list()).toEqual([kept.name])
    expect(fs.existsSync(ctx.artwork.resolve(kept.name)!.path)).toBe(true)
    expect(ctx.artwork.resolve(orphan.name)).toBeNull()
  })

  it('deletes the old image when a card switches artwork', async () => {
    const ctx = setup()
    // Created with a remote poster, as the assignment flow does — uploads only
    // happen later, through editing.
    ctx.store.createCard(cardWith('https://example.test/p.jpg', '04-01'), 1)
    const app = buildServer(ctx, { requirePin: false })

    // Saved one at a time: housekeeping runs on every card change, so an image
    // saved before it is referenced would be collected straight away.
    const before = ctx.artwork.save(PNG)
    await app.inject({ method: 'PATCH', url: '/api/cards/1', payload: { poster_url: before.url } })

    const after = ctx.artwork.save(JPEG)
    await app.inject({ method: 'PATCH', url: '/api/cards/1', payload: { poster_url: after.url } })
    await app.close()

    expect(ctx.artwork.list()).toEqual([after.name])
  })

  it('keeps an uploaded image that is a card\'s original, so the way back survives', async () => {
    const ctx = setup()
    const original = ctx.artwork.save(PNG)
    ctx.store.createCard(cardWith(original.url, '04-01'), 1)

    const app = buildServer(ctx, { requirePin: false })
    await app.inject({
      method: 'PATCH',
      url: '/api/cards/1',
      payload: { poster_url: 'https://images.metahub.space/poster/medium/tt1/img' },
    })
    await app.close()

    expect(ctx.artwork.list()).toEqual([original.name])
  })

  it('keeps one file when two cards share the same image', async () => {
    const ctx = setup()
    const shared = ctx.artwork.save(PNG)
    ctx.store.createCard(cardWith(shared.url, '04-01'), 1)
    ctx.store.createCard(cardWith(shared.url, '04-02'), 1)

    const app = buildServer(ctx, { requirePin: false })
    // Deleting one card must not pull the image out from under the other.
    await app.inject({ method: 'DELETE', url: '/api/cards/1' })
    await app.close()

    expect(ctx.artwork.list()).toEqual([shared.name])
  })
})

describe('upload and serve over HTTP', () => {
  it('stores an uploaded image and serves it back with defensive headers', async () => {
    const ctx = setup()
    const app = buildServer(ctx, { requirePin: false })

    const upload = await app.inject({
      method: 'POST',
      url: '/api/artwork/upload',
      headers: { 'content-type': 'image/png' },
      payload: PNG,
    })
    expect(upload.statusCode).toBe(201)

    const url = (upload.json() as { artwork: { url: string } }).artwork.url
    expect(url.startsWith('api/')).toBe(true)

    const fetched = await app.inject({ method: 'GET', url: `/${url}` })
    expect(fetched.statusCode).toBe(200)
    expect(fetched.headers['content-type']).toContain('image/png')
    expect(fetched.headers['x-content-type-options']).toBe('nosniff')
    expect(fetched.headers['content-security-policy']).toContain("default-src 'none'")
    expect(Buffer.from(fetched.rawPayload).equals(PNG)).toBe(true)

    await app.close()
  })

  it('rejects a disguised HTML payload', async () => {
    const ctx = setup()
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/artwork/upload',
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from('<!doctype html><script>alert(1)</script>'),
    })

    expect(response.statusCode).toBe(415)
    expect(response.json()).toMatchObject({ error: 'unsupported_image' })
    expect(ctx.artwork.list()).toEqual([])

    await app.close()
  })

  it('rejects a body that is not an accepted image type at all', async () => {
    const ctx = setup()
    const app = buildServer(ctx, { requirePin: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/artwork/upload',
      headers: { 'content-type': 'text/html' },
      payload: '<script>alert(1)</script>',
    })

    expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect(ctx.artwork.list()).toEqual([])

    await app.close()
  })

  it('404s an unknown or malformed image name', async () => {
    const ctx = setup()
    const app = buildServer(ctx, { requirePin: false })

    for (const name of [`${'a'.repeat(64)}.png`, 'nope.png']) {
      const response = await app.inject({ method: 'GET', url: `/api/artwork/file/${name}` })
      expect(response.statusCode).toBe(404)
    }

    await app.close()
  })

  it('requires a PIN in direct mode, like every other API route', async () => {
    active = testContext({ CARTRIDGE_DIRECT_PORT: '8100' })
    const ctx = active.ctx
    const saved = ctx.artwork.save(PNG)
    ctx.store.updateSettings({ pin_hash: 'scrypt$16384$8$1$c2FsdA$aGFzaA' })

    const app = buildServer(ctx, { requirePin: true })
    const response = await app.inject({ method: 'GET', url: `/${saved.url}` })

    expect(response.statusCode).toBe(401)
    await app.close()
  })
})

describe('serving a card\'s artwork from our own origin', () => {
  /**
   * Exporting a sticker draws the poster onto a canvas, and a canvas that has
   * touched a cross-origin image cannot be read back. This route exists so the
   * bytes are same-origin — and it takes a card id, never a URL, so it cannot
   * be turned into an open proxy.
   */
  const remoteCard = (posterUrl: string) => ({
    tag_uid: '04-01',
    provider: 'stremio',
    content_type: 'movie' as const,
    external_id: 'tt1',
    title: 'x',
    year: null,
    poster_url: posterUrl,
    season: null,
    episode: null,
    label: null,
  })

  it('serves an uploaded image straight off disk', async () => {
    const ctx = setup()
    const saved = ctx.artwork.save(PNG)
    ctx.store.createCard(remoteCard(saved.url), 1)

    const app = buildServer(ctx, { requirePin: false })
    const response = await app.inject({ method: 'GET', url: '/api/artwork/card/1' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('image/png')
    await app.close()
  })

  it('relays a remote poster', async () => {
    const ctx = setup()
    ctx.store.createCard(remoteCard('https://images.metahub.space/poster/medium/tt1/img'), 1)
    const app = buildServer(ctx, { requirePin: false })

    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JPEG)) as typeof fetch
    const response = await app.inject({ method: 'GET', url: '/api/artwork/card/1' })
    globalThis.fetch = realFetch

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('image/jpeg')
    await app.close()
  })

  it('refuses to reach anything inside the install, even via a card', async () => {
    const ctx = setup()
    const app = buildServer(ctx, { requirePin: false })
    const calls: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response(JPEG)
    }) as typeof fetch

    for (const [i, hostile] of [
      'http://supervisor/core/api/states',
      'https://supervisor/addons/self/info',
      'https://127.0.0.1:8099/api/settings',
      'https://192.168.1.10/secret.png',
      'https://10.0.0.5/secret.png',
      'https://169.254.169.254/latest/meta-data/',
      'https://homeassistant.local/x.png',
    ].entries()) {
      ctx.store.createCard(remoteCard(hostile), i + 1)
      const response = await app.inject({ method: 'GET', url: `/api/artwork/card/${i + 1}` })
      expect(response.statusCode, hostile).toBe(404)
      ctx.store.deleteCard(i + 1)
    }

    globalThis.fetch = realFetch
    // Never reached out at all.
    expect(calls).toEqual([])
    await app.close()
  })

  it('404s a card with no artwork', async () => {
    const ctx = setup()
    const app = buildServer(ctx, { requirePin: false })
    const response = await app.inject({ method: 'GET', url: '/api/artwork/card/999' })
    expect(response.statusCode).toBe(404)
    await app.close()
  })
})
