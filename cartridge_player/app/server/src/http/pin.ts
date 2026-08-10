import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32

/** `scrypt$N$r$p$salt$hash`, all base64url. */
export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(pin.normalize('NFKC'), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

export function verifyPin(pin: string, stored: string | null): boolean {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, expected] = parts as [string, string, string, string, string, string]

  let derived: Buffer
  try {
    derived = crypto.scryptSync(pin.normalize('NFKC'), Buffer.from(salt, 'base64url'), KEY_LEN, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    })
  } catch {
    return false
  }

  const expectedBuf = Buffer.from(expected, 'base64url')
  if (expectedBuf.length !== derived.length) return false
  return crypto.timingSafeEqual(expectedBuf, derived)
}

export const SESSION_COOKIE = 'cartridge_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Persisted so a home-screen icon survives an add-on restart without a
 * re-prompt. Rotating this file logs every direct-mode client out.
 */
export function loadOrCreateSessionSecret(dataDir: string): Buffer {
  const file = path.join(dataDir, 'session.key')
  try {
    const existing = fs.readFileSync(file)
    if (existing.length >= 32) return existing
  } catch {
    // fall through and create
  }
  const secret = crypto.randomBytes(32)
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(file, secret, { mode: 0o600 })
  } catch {
    // Read-only /data in a dev sandbox: an in-memory secret still works, it just
    // does not survive a restart.
  }
  return secret
}

export function issueSession(secret: Buffer, now = Date.now()): string {
  const expires = now + SESSION_TTL_MS
  const payload = String(expires)
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifySession(token: string | undefined, secret: Buffer, now = Date.now()): boolean {
  if (!token) return false
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return false
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length) return false
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false

  const expires = Number(payload)
  return Number.isFinite(expires) && expires > now
}
