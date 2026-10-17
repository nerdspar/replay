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

/**
 * Tapping Sesame Street should not open the same first episode for ever.
 *
 * The picker is tested on its own; what matters here is that a tap actually
 * resolves an episode, launches THAT one, and moves the cursor on — and that a
 * metadata source being down degrades to the episode list rather than failing
 * the scan.
 */
describe('a series cartridge that picks its own episode', () => {
  function series(episode_mode: 'next' | 'random' | 'list') {
    active = testContext()
    const { ctx } = active
    const target = new FakeTarget()
    const provider = new FakeProvider()
    provider.seriesVideos = [
      { id: 'sesame:1:2', season: 1, episode: 2, title: 'Two' },
      { id: 'sesame:1:1', season: 1, episode: 1, title: 'One' },
      { id: 'sesame:2:1', season: 2, episode: 1, title: 'Three' },
    ]

    ctx.providers.register(provider)
    ctx.targets.register('fake', () => target)
    ctx.store.updateSettings({ target_type: 'fake', home_delay_ms: 0, autoplay_delay_ms: 0 })

    const card = ctx.store.createCard(
      {
        tag_uid: '04-SESAME',
        provider: 'fake',
        content_type: 'series',
        external_id: 'sesame',
        title: 'Sesame Street',
        year: null,
        poster_url: null,
        season: null,
        episode: null,
        label: null,
        episode_mode,
      } as never,
      Date.now(),
    )
    return { ctx, target, provider, card }
  }

  it('walks the show one episode at a time, in order', async () => {
    const { ctx, target, card } = series('next')

    await ctx.scans.handleInserted(card.tag_uid)
    expect(target.launchedWith).toEqual({ kind: 'uri', value: 'fake://open/sesame/1/1' })

    await ctx.scans.handleInserted(card.tag_uid)
    expect(target.launchedWith).toEqual({ kind: 'uri', value: 'fake://open/sesame/1/2' })

    await ctx.scans.handleInserted(card.tag_uid)
    expect(target.launchedWith).toEqual({ kind: 'uri', value: 'fake://open/sesame/2/1' })

    // And round again, rather than going dead at the end of the series.
    await ctx.scans.handleInserted(card.tag_uid)
    expect(target.launchedWith).toEqual({ kind: 'uri', value: 'fake://open/sesame/1/1' })
  })

  it('remembers where it got to, so a restart does not start the show again', async () => {
    const { ctx, card } = series('next')
    await ctx.scans.handleInserted(card.tag_uid)

    expect(ctx.store.getCard(card.id)).toMatchObject({
      cursor_season: 1,
      cursor_episode: 1,
      // The pinned fields stay empty: this cartridge is not pinned to anything.
      season: null,
      episode: null,
    })
  })

  it('never plays the same episode twice running on random', async () => {
    const { ctx, target, card } = series('random')

    const played: string[] = []
    for (let i = 0; i < 6; i++) {
      await ctx.scans.handleInserted(card.tag_uid)
      played.push(target.launchedWith!.value)
    }

    for (let i = 1; i < played.length; i++) {
      expect(played[i]).not.toBe(played[i - 1])
    }
  })

  it('opens the episode list when metadata cannot be reached', async () => {
    const { ctx, target, provider, card } = series('next')
    provider.getMeta = async () => {
      throw new Error('cinemeta is down')
    }

    const outcome = await ctx.scans.handleInserted(card.tag_uid)

    // Degraded, not failed: the cartridge still opens the show.
    expect(outcome.scan.error).toBeNull()
    expect(target.launchedWith).toEqual({ kind: 'uri', value: 'fake://open/sesame' })
  })

  it('leaves an ordinary series cartridge alone', async () => {
    const { ctx, provider, card } = series('list')
    await ctx.scans.handleInserted(card.tag_uid)

    // No metadata fetch at all — the old path is untouched.
    expect(provider.metaCalls).toEqual([])
  })
})
