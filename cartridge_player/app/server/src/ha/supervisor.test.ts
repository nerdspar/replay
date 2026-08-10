import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureAddonSlug } from './supervisor.js'
import { testContext, type TestContext } from '../test/context.js'

let active: TestContext | null = null
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  active?.cleanup()
  active = null
})

function stubFetch(responses: (Response | Error)[]) {
  const impl = vi.fn(async () => {
    const next = responses.shift()
    if (next instanceof Error) throw next
    if (!next) throw new Error('no more responses')
    return next
  })
  globalThis.fetch = impl as unknown as typeof fetch
  return impl
}

const okSlug = () =>
  new Response(JSON.stringify({ data: { slug: 'a0d7b954_cartridge_player', version: '0.1.0' } }), {
    headers: { 'content-type': 'application/json' },
  })

describe('add-on slug resolution (§3.4)', () => {
  it('reads the repo-hash-prefixed slug from Supervisor', async () => {
    active = testContext({ SUPERVISOR_TOKEN: 'token' })
    stubFetch([okSlug()])

    expect(await ensureAddonSlug(active.ctx)).toBe('a0d7b954_cartridge_player')
    expect(active.ctx.addonSlug).toBe('a0d7b954_cartridge_player')
  })

  it('caches a resolved slug instead of asking again', async () => {
    active = testContext({ SUPERVISOR_TOKEN: 'token' })
    const impl = stubFetch([okSlug()])

    await ensureAddonSlug(active.ctx)
    await ensureAddonSlug(active.ctx)

    expect(impl).toHaveBeenCalledTimes(1)
  })

  /** Supervisor can be briefly unreachable while the add-on boots. */
  it('recovers on a later request when the first attempt failed', async () => {
    active = testContext({ SUPERVISOR_TOKEN: 'token' })
    let clock = 0
    stubFetch([new Error('ECONNREFUSED'), okSlug()])

    expect(await ensureAddonSlug(active.ctx, () => clock)).toBeNull()

    // Still inside the retry guard: no second request, so still null.
    clock = 30_000
    expect(await ensureAddonSlug(active.ctx, () => clock)).toBeNull()

    clock = 61_000
    expect(await ensureAddonSlug(active.ctx, () => clock)).toBe('a0d7b954_cartridge_player')
  })

  it('stays null without a supervisor token rather than throwing', async () => {
    active = testContext()
    expect(await ensureAddonSlug(active.ctx)).toBeNull()
  })
})
