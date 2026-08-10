import { createLogger } from '../log.js'
import type { AppContext } from '../context.js'

const log = createLogger('supervisor')

const SLUG_RETRY_MS = 60_000

export interface AddonSelfInfo {
  slug: string
  version: string
}

/**
 * The panel URL is `https://<ha-host>/hassio/ingress/<addon_slug>`, and the slug
 * is prefixed by a repository hash when installed from a custom repository — so
 * it is NOT bare `cartridge_player` (§3.4). Ask Supervisor rather than guessing.
 */
/**
 * Resolve the slug lazily, retrying at most once a minute. Supervisor can be
 * briefly unreachable while the add-on boots; without a retry the home-screen
 * link would stay broken until the add-on was restarted.
 */
export async function ensureAddonSlug(
  ctx: AppContext,
  now: () => number = Date.now,
): Promise<string | null> {
  if (ctx.addonSlug !== null) return ctx.addonSlug
  const at = now()
  if (at - ctx.addonSlugCheckedAt < SLUG_RETRY_MS) return null

  ctx.addonSlugCheckedAt = at
  const info = await fetchAddonSelfInfo(
    ctx.config.supervisorToken,
    fetch,
    ctx.config.supervisorUrl,
  )
  if (info) {
    ctx.addonSlug = info.slug
    log.info(`add-on slug: ${info.slug}`)
  }
  return ctx.addonSlug
}

export async function fetchAddonSelfInfo(
  token: string | null,
  fetchImpl: typeof fetch = fetch,
  baseUrl = 'http://supervisor',
): Promise<AddonSelfInfo | null> {
  if (!token) return null
  try {
    const response = await fetchImpl(`${baseUrl}/addons/self/info`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { data?: { slug?: string; version?: string } }
    if (!body.data?.slug) return null
    return { slug: body.data.slug, version: body.data.version ?? '0.0.0' }
  } catch (error) {
    log.warn(`could not read add-on self info: ${(error as Error).message}`)
    return null
  }
}
