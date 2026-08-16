import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PALETTE,
  LED_STATES,
  ReaderLight,
  isWearableAccent,
  normalizePalette,
  packPalette,
  statusForPlayingMode,
} from './reader-light.js'
import { ScanHandler } from './scan-handler.js'
import { FakeTarget, settings } from '../test/helpers.js'
import { testContext, type TestContext } from '../test/context.js'
import type { LedPalette, Settings } from '../types.js'

let active: TestContext | null = null

afterEach(() => {
  active?.cleanup()
  active = null
})

function fakeHa(services: string[] = ['cartridge_reader_set_status']) {
  const calls: { domain: string; service: string; data: Record<string, unknown> }[] = []
  return {
    calls,
    listServices: vi.fn(async () => services),
    callService: vi.fn(async (domain: string, service: string, data: Record<string, unknown>) => {
      calls.push({ domain, service, data })
    }),
  }
}

function light(ha: ReturnType<typeof fakeHa>, overrides: Partial<Settings> = {}) {
  return new ReaderLight({ ha, settings: () => settings(overrides) })
}

describe('packing the palette', () => {
  it('produces eight hex characters per state, in wire order', () => {
    const packed = packPalette(DEFAULT_PALETTE)

    expect(packed).toHaveLength(LED_STATES.length * 8)
    // no_wifi is first: red at 45%, and 45% of 255 is 115 = 0x73.
    expect(packed.slice(0, 8)).toBe('ff000073')
    // ready is third: white at 10%, and 10% of 255 is 26 = 0x1a.
    expect(packed.slice(16, 24)).toBe('ffffff1a')
  })

  it('accepts a colour with or without its hash', () => {
    const withHash = packPalette({ ...DEFAULT_PALETTE, ready: { color: '#123456', brightness: 50 } })
    const without = packPalette({ ...DEFAULT_PALETTE, ready: { color: '123456', brightness: 50 } })

    expect(withHash).toBe(without)
    expect(withHash.slice(16, 24)).toBe('12345680')
  })

  it('falls back to the default rather than emitting junk for a bad colour', () => {
    // A short palette reaches the firmware as a length mismatch and is dropped
    // whole, so one malformed entry would darken the reader entirely.
    const packed = packPalette({
      ...DEFAULT_PALETTE,
      error: { color: 'not-a-colour', brightness: 80 },
    })

    expect(packed).toHaveLength(88)
    expect(packed.slice(64, 72)).toBe('ff0000cc')
  })

  it('clamps brightness into a single byte', () => {
    const packed = packPalette({
      ...DEFAULT_PALETTE,
      ready: { color: '#ffffff', brightness: 400 },
    })
    expect(packed.slice(16, 24)).toBe('ffffffff')
  })
})

describe('normalising a stored palette', () => {
  it('fills in states an older release never saved', () => {
    const partial = { ready: { color: '#00ff00', brightness: 20 } }
    const full = normalizePalette(partial as Partial<LedPalette>)

    expect(Object.keys(full).sort()).toEqual([...LED_STATES].sort())
    expect(full.ready).toEqual({ color: '#00ff00', brightness: 20 })
    expect(full.error).toEqual(DEFAULT_PALETTE.error)
  })

  it('replaces an unusable colour instead of carrying it forward', () => {
    const full = normalizePalette({ ready: { color: 'rgb(1,2,3)', brightness: 20 } } as never)
    expect(full.ready).toEqual(DEFAULT_PALETTE.ready)
  })

  it('survives a null column', () => {
    expect(normalizePalette(null)).toEqual(DEFAULT_PALETTE)
  })
})

describe('what "playing" sends', () => {
  it('holds, confirms, or releases', () => {
    expect(statusForPlayingMode('hold')).toBe('playing_hold')
    expect(statusForPlayingMode('confirm')).toBe('playing')
    // Not "send nothing": the reader is holding a working state and would sit
    // there until its backstop expired, then claim nobody had answered.
    expect(statusForPlayingMode('off')).toBe('ready')
  })
})

describe('finding the reader', () => {
  it('derives the device from the action it exposes', async () => {
    const ha = fakeHa(['cartridge_reader_set_status', 'cartridge_reader_set_palette'])
    await light(ha).setStatus('playing')

    expect(ha.calls).toEqual([
      {
        domain: 'esphome',
        service: 'cartridge_reader_set_status',
        data: { state: 'playing' },
      },
    ])
  })

  it('prefers the configured reader when a household has two', async () => {
    const ha = fakeHa(['hallway_reader_set_status', 'den_reader_set_status'])
    await light(ha, { reader_device: 'den-reader' }).setStatus('playing')

    expect(ha.calls[0]?.service).toBe('den_reader_set_status')
  })

  it('does nothing at all when no reader exposes the action', async () => {
    const ha = fakeHa([])
    await light(ha).setStatus('playing')

    // Firmware too old, or the reader is offline. Neither is an error worth
    // surfacing — the cartridge still plays.
    expect(ha.callService).not.toHaveBeenCalled()
  })

  it('looks up once and reuses the answer', async () => {
    const ha = fakeHa()
    const reader = light(ha)

    await reader.setStatus('busy')
    await reader.setStatus('playing')

    expect(ha.listServices).toHaveBeenCalledTimes(1)
  })

  it('looks again after a failure, since a renamed reader is the usual cause', async () => {
    const ha = fakeHa()
    ha.callService.mockRejectedValueOnce(new Error('service not found'))
    const reader = light(ha)

    await reader.setStatus('busy')
    await reader.setStatus('playing')

    expect(ha.listServices).toHaveBeenCalledTimes(2)
  })
})

describe('staying out of the way', () => {
  it('sends nothing when the light is switched off', async () => {
    const ha = fakeHa()
    await light(ha, { led_enabled: false }).setStatus('playing')
    expect(ha.callService).not.toHaveBeenCalled()
  })

  it('swallows a failed call rather than raising', async () => {
    const ha = fakeHa()
    ha.callService.mockRejectedValue(new Error('reader is asleep'))

    // A light that cannot be updated must never become a failed scan.
    await expect(light(ha).setStatus('playing')).resolves.toBeUndefined()
  })

  it('sends the packed palette, not the stored JSON', async () => {
    const ha = fakeHa()
    await light(ha).pushPalette()

    expect(ha.calls[0]?.service).toBe('cartridge_reader_set_palette')
    expect(ha.calls[0]?.data).toEqual({ palette: packPalette(DEFAULT_PALETTE) })
  })
})

describe('a scan drives the light', () => {
  /** Records what the reader was told, in order. */
  function withLight(overrides: Partial<Settings> = {}) {
    active = testContext()
    const { ctx } = active
    ctx.store.updateSettings({ home_delay_ms: 0, autoplay_delay_ms: 0, ...overrides })
    ctx.targets.register('androidtv', () => new FakeTarget())

    const said: string[] = []
    ctx.scans = new ScanHandler({
      store: ctx.store,
      providers: ctx.providers,
      targets: ctx.targets,
      pending: ctx.pending,
      bus: ctx.bus,
      light: {
        setStatus: async (s, color) => void said.push(color ? `${s}:${color}` : s),
      } as unknown as ReaderLight,
    })
    return { ctx, said }
  }

  it('says "not set up" for a tag it has never seen', async () => {
    const { ctx, said } = withLight()
    await ctx.scans.handleInserted('04-A3-B8')

    expect(said).toEqual(['new'])
  })

  it('says "busy" before the launch and then says nothing itself', async () => {
    const { ctx, said } = withLight()
    ctx.store.createCard(
      {
        tag_uid: '04-01',
        provider: 'stremio',
        content_type: 'movie',
        external_id: 'tt1',
        title: 'A Film',
        year: null,
        poster_url: null,
        season: null,
        episode: null,
        label: null,
        player_entity: null,
        art_fit: null,
        accent_color: null,
        shuffle: false,
        radio_mode: false,
      },
      1,
    )

    await ctx.scans.handleInserted('04-01')

    // "busy" arrives before the launch because the reader gives up on an
    // unanswered event after three seconds and a TV takes longer than that.
    // What happens AFTER the launch is no longer decided here: finishing the
    // sequence means the deep link went out, not that anything is playing.
    expect(said).toEqual(['busy'])
  })
})

/**
 * Is the reader there?
 *
 * Home Assistant registers an ESPHome device's actions when it connects and
 * removes them when it drops, so their presence IS the device's liveness. No
 * entity naming to guess at, and a renamed entity cannot fool it.
 */
describe('reporting whether the reader is connected', () => {
  it('names the device, in the form it is written on the device itself', async () => {
    const ha = fakeHa(['cartridge_reader_set_status', 'cartridge_reader_set_status_color'])

    expect(await light(ha).describe()).toEqual({
      connected: true,
      device: 'cartridge-reader',
      supportsColor: true,
    })
  })

  it('says not connected when Home Assistant offers no actions for it', async () => {
    const ha = fakeHa([])

    expect(await light(ha).describe()).toEqual({
      connected: false,
      device: null,
      supportsColor: false,
    })
  })

  it('reports firmware that predates the artwork colours', async () => {
    const ha = fakeHa(['cartridge_reader_set_status'])
    const described = await light(ha).describe()

    expect(described.connected).toBe(true)
    expect(described.supportsColor).toBe(false)
  })

  it('asks again rather than answering from the cache', async () => {
    const ha = fakeHa()
    const reader = light(ha)

    await reader.setStatus('playing')
    ha.listServices.mockResolvedValue([])
    // "Is it there RIGHT NOW" — a five-minute-old list would defeat the point.
    expect((await reader.describe()).connected).toBe(false)
  })

  it('says not connected rather than throwing when Home Assistant is unreachable', async () => {
    const ha = fakeHa()
    ha.listServices.mockRejectedValue(new Error('connection refused'))

    expect((await light(ha).describe()).connected).toBe(false)
  })
})

/**
 * The bug this exists for: a cartridge whose stored colour was `#0d1117`, dark
 * enough that ESPHome's normalisation turned it into `#90bcff` at the LED. The
 * setting looked broken, and every layer reported success.
 */
describe('refusing a colour the reader cannot show', () => {
  it('accepts what the browser sampler produces', () => {
    // That sampler scales to full value, so its output always has a full
    // channel. These are real values from a library.
    expect(isWearableAccent('#1cffe6')).toBe(true)
    expect(isWearableAccent('#00ff26')).toBe(true)
    expect(isWearableAccent('1cffe6')).toBe(true)
  })

  it('rejects a near-black colour, whatever its hue', () => {
    expect(isWearableAccent('#0d1117')).toBe(false)
    expect(isWearableAccent('#101012')).toBe(false)
    expect(isWearableAccent('#000000')).toBe(false)
  })

  it('rejects a grey, which would light the reader as plain white', () => {
    expect(isWearableAccent('#ffffff')).toBe(false)
    expect(isWearableAccent('#c0c0c0')).toBe(false)
  })

  it('rejects nothing at all, rather than treating it as a colour', () => {
    expect(isWearableAccent(null)).toBe(false)
    expect(isWearableAccent(undefined)).toBe(false)
    expect(isWearableAccent('rgb(1,2,3)')).toBe(false)
  })

  it('falls back to the palette instead of sending an unwearable colour', async () => {
    const ha = fakeHa(['cartridge_reader_set_status', 'cartridge_reader_set_status_color'])
    await light(ha).setStatus('playing', '#0d1117')

    // The plain action, so the reader wears its own green rather than a wash.
    expect(ha.calls).toEqual([
      { domain: 'esphome', service: 'cartridge_reader_set_status', data: { state: 'playing' } },
    ])
  })

  it('still sends a colour the reader can show', async () => {
    const ha = fakeHa(['cartridge_reader_set_status', 'cartridge_reader_set_status_color'])
    await light(ha).setStatus('playing', '#1cffe6')

    expect(ha.calls[0]).toEqual({
      domain: 'esphome',
      service: 'cartridge_reader_set_status_color',
      data: { state: 'playing', color: '1cffe6' },
    })
  })
})

describe('a reader that has been renamed', () => {
  it('follows the new name without being told', async () => {
    // The device name is a substitution in the firmware, and Home Assistant
    // derives its action names from it. Discovery matches on the action's
    // suffix precisely so that renaming the reader needs no setting changed.
    const ha = fakeHa([
      'replay_cartridge_reader_set_status',
      'replay_cartridge_reader_set_palette',
      'replay_cartridge_reader_set_status_color',
    ])

    await light(ha).setStatus('playing_hold', '#3366cc')

    expect(ha.calls[0]?.service).toBe('replay_cartridge_reader_set_status_color')
    expect(await light(ha).describe()).toMatchObject({
      connected: true,
      device: 'replay-cartridge-reader',
    })
  })
})
