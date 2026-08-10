import { describe, expect, it } from 'vitest'
import { runFireSequence, runRemovalAction } from './fire-sequence.js'
import { StremioProvider } from '../providers/stremio.js'
import {
  FakeProvider,
  FakeTarget,
  card,
  recordingSleep,
  settings,
} from '../test/helpers.js'
import type { RemovalAction } from '../types.js'

describe('fire sequence — every combination of the toggles (§6.2)', () => {
  const cases: {
    home: boolean
    autoplay: boolean
    expected: string[]
    expectedDelays: number[]
  }[] = [
    { home: true, autoplay: true, expected: ['home', 'launch', 'select'], expectedDelays: [1500, 3000] },
    { home: true, autoplay: false, expected: ['home', 'launch'], expectedDelays: [1500] },
    { home: false, autoplay: true, expected: ['launch', 'select'], expectedDelays: [3000] },
    { home: false, autoplay: false, expected: ['launch'], expectedDelays: [] },
  ]

  for (const { home, autoplay, expected, expectedDelays } of cases) {
    it(`home=${home} autoplay=${autoplay} -> ${expected.join(',')}`, async () => {
      const target = new FakeTarget()
      const { sleep, delays } = recordingSleep()

      const steps = await runFireSequence({
        card: card(),
        settings: settings({ home_first_enabled: home, autoplay_enabled: autoplay }),
        provider: new StremioProvider(),
        target,
        sleep,
      })

      expect(target.calls).toEqual(expected)
      expect(steps).toEqual(expected)
      expect(delays).toEqual(expectedDelays)
    })
  }

  it('waits AFTER home and BEFORE select, not the other way round', async () => {
    const order: string[] = []
    const target = new FakeTarget()

    await runFireSequence({
      card: card(),
      settings: settings({ home_delay_ms: 1500, autoplay_delay_ms: 3000 }),
      provider: new StremioProvider(),
      target: {
        ...target,
        sendKey: async (key) => {
          order.push(`key:${key}`)
        },
        launch: async () => {
          order.push('launch')
        },
      },
      sleep: async (ms) => {
        order.push(`sleep:${ms}`)
      },
    })

    expect(order).toEqual(['key:home', 'sleep:1500', 'launch', 'sleep:3000', 'key:select'])
  })

  it('honours a zero delay without skipping the step', async () => {
    const target = new FakeTarget()
    const { sleep, delays } = recordingSleep()

    await runFireSequence({
      card: card(),
      settings: settings({ home_delay_ms: 0, autoplay_delay_ms: 0 }),
      provider: new StremioProvider(),
      target,
      sleep,
    })

    expect(target.calls).toEqual(['home', 'launch', 'select'])
    expect(delays).toEqual([0, 0])
  })

  it('passes the provider-built payload straight to the target', async () => {
    const target = new FakeTarget()
    await runFireSequence({
      card: card({ content_type: 'series', external_id: 'tt0903747', season: 2, episode: 5 }),
      settings: settings(),
      provider: new StremioProvider(),
      target,
      sleep: async () => {},
    })

    expect(target.launchedWith).toEqual({
      kind: 'uri',
      value: 'stremio:///detail/series/tt0903747/tt0903747:2:5',
    })
  })

  it('stops at the failing step rather than pressing select into nothing', async () => {
    const target = new FakeTarget()
    const failing = {
      ...target,
      launch: async () => {
        throw new Error('remote unavailable')
      },
      sendKey: target.sendKey.bind(target),
    }

    await expect(
      runFireSequence({
        card: card(),
        settings: settings(),
        provider: new StremioProvider(),
        target: failing,
        sleep: async () => {},
      }),
    ).rejects.toThrow('remote unavailable')

    expect(target.calls).toEqual(['home'])
  })
})

describe('removal actions (§6.4)', () => {
  const cases: { action: RemovalAction; expected: string[] }[] = [
    { action: 'none', expected: [] },
    { action: 'pause', expected: ['pause'] },
    { action: 'back', expected: ['back'] },
    { action: 'home', expected: ['home'] },
  ]

  for (const { action, expected } of cases) {
    it(`${action} -> ${expected.join(',') || 'nothing'}`, async () => {
      const target = new FakeTarget()
      const result = await runRemovalAction(settings({ removal_action: action }), target)
      expect(target.calls).toEqual(expected)
      expect(result).toBe(action)
    })
  }
})

describe('device agnosticism (§10.1)', () => {
  it('produces the same abstract calls for any provider/target pairing', async () => {
    const stremioTarget = new FakeTarget()
    const fakeTarget = new FakeTarget()

    await runFireSequence({
      card: card(),
      settings: settings(),
      provider: new StremioProvider(),
      target: stremioTarget,
      sleep: async () => {},
    })
    await runFireSequence({
      card: card({ provider: 'fake' }),
      settings: settings(),
      provider: new FakeProvider(),
      target: fakeTarget,
      sleep: async () => {},
    })

    expect(stremioTarget.calls).toEqual(['home', 'launch', 'select'])
    expect(fakeTarget.calls).toEqual(stremioTarget.calls)
    // Only the payload differs — and only the provider decided it.
    expect(fakeTarget.launchedWith).toEqual({ kind: 'uri', value: 'fake://open/tt0083658' })
  })
})
