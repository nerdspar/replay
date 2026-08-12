import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../errors.js'
import { createLogger } from '../log.js'

const log = createLogger('artwork')

/**
 * §3.5 says store poster URLs and never cache artwork locally — a hundred
 * cartridges of cached art is hundreds of megabytes on a disk with other
 * demands. A user-supplied image has no URL to store, so it is the one thing
 * that must live on disk, and it is bounded on purpose:
 *
 *   - the browser downscales before upload (long edge 1000px, JPEG)
 *   - this cap is the backstop, not the mechanism
 *   - files are content-addressed, so the same art on ten cards costs one file
 *   - anything no card references is deleted
 *
 * A hundred custom covers lands around 15 MB, not hundreds.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

/**
 * Imported originals are only held in memory long enough to hand to the browser
 * for resizing, so this is a sanity ceiling rather than a storage budget.
 * ThePosterDB's print-grade posters run 2–3 MB.
 */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024

/** Filenames are `<sha256>.<ext>` — derived, never user-supplied. */
const NAME_PATTERN = /^[0-9a-f]{64}\.(png|jpg|webp)$/

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
}

/**
 * Sniff the actual bytes rather than trusting a Content-Type header. An
 * uploaded file that is really HTML or SVG must never be stored, because it
 * would later be served from our own origin.
 */
export function detectImageExtension(buffer: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buffer.length < 12) return null

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png'
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'

  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp'
  }

  return null
}

/**
 * Sites a user can pull a single image from by pasting a link.
 *
 * Deliberately an allowlist of exact hosts and exact path shapes, not a general
 * URL fetcher — the server would otherwise happily fetch `http://supervisor/...`
 * or any other address reachable from inside the container on a user's say-so.
 *
 * ThePosterDB has no search or lookup API, and does not permit automated
 * scraping, so nothing here crawls it. This fetches one asset the user already
 * chose in their own browser, which is the same thing as them downloading the
 * file and uploading it — just without the round trip through their phone.
 */
export const IMPORT_SOURCES: { host: string; path: RegExp; label: string }[] = [
  {
    host: 'theposterdb.com',
    path: /^\/api\/assets\/\d+$/,
    label: 'ThePosterDB',
  },
  {
    host: 'www.theposterdb.com',
    path: /^\/api\/assets\/\d+$/,
    label: 'ThePosterDB',
  },
]

/**
 * Hostnames that could reach something inside the install. A card's poster is
 * user-writable, so the card-scoped proxy still refuses to fetch these.
 */
/**
 * Hosts the artwork proxy will not fetch from.
 *
 * Narrowed from "anything private" to loopback and link-local, because the
 * broader rule made the proxy useless for the artwork it most needs to fetch.
 * Music Assistant serves covers over plain http from the local network — either
 * its own port or through Home Assistant — so a blanket ban on private hosts
 * refused every album cover in the house, and the sticker backdrops and light
 * colours that read them quietly fell back to white.
 *
 * What is still refused is what could never be legitimate artwork: loopback,
 * which reaches services on the add-on's own container, and link-local, which
 * is where cloud metadata endpoints live. Everything fetched must additionally
 * survive a magic-byte image sniff and a size cap, so this cannot be turned into
 * a general-purpose reader of internal endpoints.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === 'supervisor') return true
  if (host === '::1') return true

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  return a === 0 || a === 127 || (a === 169 && b === 254)
}

export function resolveImportUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new AppError('bad_import_url', 'That does not look like a link.', 400)
  }

  if (url.protocol !== 'https:') {
    throw new AppError('bad_import_url', 'Only https links can be imported.', 400)
  }

  const source = IMPORT_SOURCES.find(
    (candidate) => candidate.host === url.hostname && candidate.path.test(url.pathname),
  )
  if (!source) {
    throw new AppError(
      'bad_import_url',
      'That link is not a ThePosterDB poster. Open the poster on theposterdb.com, ' +
        'use its download link, and paste that.',
      400,
    )
  }

  // Strip everything but host and path — no credentials, no query, no fragment.
  return new URL(`https://${url.hostname}${url.pathname}`)
}

/** Relative on purpose: it has to resolve under the rotating ingress path. */
export function artworkUrl(name: string): string {
  return `api/artwork/file/${name}`
}

const URL_PATTERN = /^api\/artwork\/file\/([0-9a-f]{64}\.(?:png|jpg|webp))$/

export function artworkNameFromUrl(url: string | null): string | null {
  const match = url?.match(URL_PATTERN)
  return match?.[1] ?? null
}

export class ArtworkStore {
  constructor(private readonly dir: string) {}

  save(buffer: Buffer): { name: string; url: string } {
    if (buffer.length === 0) {
      throw new AppError('empty_upload', 'That file was empty.', 400)
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new AppError(
        'upload_too_large',
        `Images must be under ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
        413,
      )
    }

    const ext = detectImageExtension(buffer)
    if (!ext) {
      throw new AppError(
        'unsupported_image',
        'That file is not a PNG, JPEG, or WebP image.',
        415,
      )
    }

    const name = `${crypto.createHash('sha256').update(buffer).digest('hex')}.${ext}`
    fs.mkdirSync(this.dir, { recursive: true })
    const target = path.join(this.dir, name)
    // Content-addressed: an identical re-upload is already on disk.
    if (!fs.existsSync(target)) fs.writeFileSync(target, buffer)

    return { name, url: artworkUrl(name) }
  }

  /** Returns an absolute path only for a well-formed name that exists. */
  resolve(name: string): { path: string; contentType: string } | null {
    if (!NAME_PATTERN.test(name)) return null
    const target = path.join(this.dir, name)
    // Belt and braces: the pattern already forbids separators and dots.
    if (path.dirname(path.resolve(target)) !== path.resolve(this.dir)) return null
    if (!fs.existsSync(target)) return null

    const ext = name.slice(name.lastIndexOf('.') + 1)
    return { path: target, contentType: MIME_BY_EXT[ext] ?? 'application/octet-stream' }
  }

  list(): string[] {
    try {
      return fs.readdirSync(this.dir).filter((name) => NAME_PATTERN.test(name))
    } catch {
      return []
    }
  }

  /** Deletes every stored image no card points at. */
  collectGarbage(referenced: Set<string>): number {
    let removed = 0
    for (const name of this.list()) {
      if (referenced.has(name)) continue
      try {
        fs.unlinkSync(path.join(this.dir, name))
        removed += 1
      } catch {
        // A file that vanished underneath us needs no handling.
      }
    }
    if (removed > 0) log.info(`removed ${removed} unreferenced image(s)`)
    return removed
  }
}
