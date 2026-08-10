import { afterEach, describe, expect, it } from 'vitest'
import { testContext, type TestContext } from '../test/context.js'
import { FakeProvider, FakeTarget } from '../test/helpers.js'
import type { Card, RemovalAction } from '../types.js'

let active: TestContext | null = null

afterEach(() => {
  active?.cleanup()
  active = null
})

function setup(overrides: Record<string, unknown> = {}) {
  active = testContext()
  const { ctx } = active
  const target = new FakeTarget()

  ctx.providers.register(new FakeProvider())
  ctx.targets.register('fake', () => target)
  ctx.store.updateSettings({
    target_type: 'fake',
    home_delay_ms: 0,
    autoplay_delay_ms: 0,
    ...overrides,
  })

  const card = ctx.store.createCard(
    {
      tag_uid: '04-A3-B8-8B-32-02-89',
      provider: 'fake',
      content_type: 'movie',
      external_id: 'fake-1',
      title: 'Fake Movie',
      year: null,
      poster_url: null,
      season: null,
      episode: null,
      label: null,
    },
    Date.now(),
  )

  return { ctx, target, card }
}

describe('inserting an assigned cartridge', () => {
  it('fires the sequence and logs what it did', async () => {
    const { ctx, target, card } = setup()

    const outcome = await ctx.scans.handleInserted(card.tag_uid)

    expect(target.calls).toEqual(['home', 'launch', 'select'])
    expect(outcome.scan).toMatchObject({
      matched_card_id: card.id,
      action_taken: 'home,launch,select',
      error: null,
    })
  })

  it('records a failure instead of throwing at the caller', async () => {
    active = testContext()
    const { ctx } = active
    ctx.providers.register(new FakeProvider())
    ctx.targets.register('exploding', () => ({
      id: 'exploding',
      launch: async () => {
        throw new Error('TV unplugged')
      },
      sendKey: async () => {},
      stop: async () => {},
      pause: async () => {},
    }))
    ctx.store.updateSettings({
      target_type: 'exploding',
      home_delay_ms: 0,
      autoplay_delay_ms: 0,
    })
    const card: Card = ctx.store.createCard(
      {
        tag_uid: '04-01',
        provider: 'fake',
        content_type: 'movie',
        external_id: 'fake-1',
        title: 'Fake',
        year: null,
        poster_url: null,
        season: null,
        episode: null,
        label: null,
      },
      1,
    )

    const outcome = await ctx.scans.handleInserted(card.tag_uid)

    expect(outcome.scan.error).toContain('TV unplugged')
    expect(ctx.lastError?.message).toContain('TV unplugged')
  })
})

describe('removing a cartridge (§6.4)', () => {
  const cases: { action: RemovalAction; expected: string[] }[] = [
    { action: 'none', expected: [] },
    { action: 'pause', expected: ['pause'] },
    { action: 'back', expected: ['back'] },
    { action: 'home', expected: ['home'] },
  ]

  for (const { action, expected } of cases) {
    it(`removal_action=${action} sends ${expected.join(',') || 'nothing'}`, async () => {
      const { ctx, target, card } = setup({ removal_action: action })

      const outcome = await ctx.scans.handleRemoved(card.tag_uid)

      expect(target.calls).toEqual(expected)
      expect(outcome?.scan.action_taken).toBe(`removed:${action}`)
    })
  }

  it('ignores removal of a cartridge that was never assigned', async () => {
    const { ctx, target } = setup({ removal_action: 'pause' })
    expect(await ctx.scans.handleRemoved('04-NOT-A-CARD')).toBeNull()
    expect(target.calls).toEqual([])
  })

  it('matches the card however the UID is formatted', async () => {
    const { ctx, target } = setup({ removal_action: 'home' })
    await ctx.scans.handleRemoved('04a3b88b320289')
    expect(target.calls).toEqual(['home'])
  })
})
