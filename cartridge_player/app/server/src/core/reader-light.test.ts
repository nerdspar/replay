import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PALETTE,
  LED_STATES,
  ReaderLight,
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

    expect(packed).toHaveLength(72)
    expect(packed.slice(64)).toBe('ff0000cc')
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
    // A target that succeeds. The real one would fail for want of a Home
    // Assistant token, and every case below would report an error for a reason
    // that has nothing to do with the light.
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

  it('says "busy" before the launch, not after', async () => {
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
        shuffle: false,
        radio_mode: false,
      },
      1,
    )

    await ctx.scans.handleInserted('04-01')

    // The reader gives up on an unanswered event after three seconds; a TV
    // launch takes longer than that, so "busy" has to arrive first.
    expect(said).toEqual(['busy', 'playing_hold'])
  })
})

describe('a cartridge wearing its own colour', () => {
  const COLOUR_ACTIONS = [
    'cartridge_reader_set_status',
    'cartridge_reader_set_status_color',
  ]

  it('sends the colour without its hash', async () => {
    const ha = fakeHa(COLOUR_ACTIONS)
    await light(ha).setStatus('playing_hold', '#1e88e5')

    expect(ha.calls).toEqual([
      {
        domain: 'esphome',
        service: 'cartridge_reader_set_status_color',
        data: { state: 'playing_hold', color: '1e88e5' },
      },
    ])
  })

  it('falls back to the plain call on firmware that predates it', async () => {
    // A reader that has not been reflashed should light up in its palette
    // colour, not fail and stay dark.
    const ha = fakeHa(['cartridge_reader_set_status'])
    await light(ha).setStatus('playing_hold', '#1e88e5')

    expect(ha.calls[0]?.service).toBe('cartridge_reader_set_status')
    expect(ha.calls[0]?.data).toEqual({ state: 'playing_hold' })
  })

  it('uses the plain call when a cartridge has no colour of its own', async () => {
    const ha = fakeHa(COLOUR_ACTIONS)
    await light(ha).setStatus('playing_hold', null)

    expect(ha.calls[0]?.service).toBe('cartridge_reader_set_status')
  })
})

describe('the artwork colour reaches the reader', () => {
  function musicCardOn(ctx: TestContext['ctx'], accent: string | null) {
    ctx.store.createCard(
      {
        tag_uid: '04-09',
        provider: 'stremio',
        content_type: 'movie',
        external_id: 'tt9',
        title: 'Coloured',
        year: null,
        poster_url: 'https://example.test/p.jpg',
        season: null,
        episode: null,
        label: null,
        player_entity: null,
        art_fit: null,
        accent_color: accent,
        shuffle: false,
        radio_mode: false,
      },
      1,
    )
  }

  it('sends it when the setting is on', async () => {
    active = testContext()
    const { ctx } = active
    ctx.store.updateSettings({
      home_delay_ms: 0,
      autoplay_delay_ms: 0,
      led_playing_artwork: true,
    })
    ctx.targets.register('androidtv', () => new FakeTarget())
    musicCardOn(ctx, '#3366cc')

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

    await ctx.scans.handleInserted('04-09')
    expect(said).toEqual(['busy', 'playing_hold:#3366cc'])
  })

  it('falls back to the palette when a cartridge has not been sampled yet', async () => {
    active = testContext()
    const { ctx } = active
    ctx.store.updateSettings({
      home_delay_ms: 0,
      autoplay_delay_ms: 0,
      led_playing_artwork: true,
    })
    ctx.targets.register('androidtv', () => new FakeTarget())
    musicCardOn(ctx, null)

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

    await ctx.scans.handleInserted('04-09')
    expect(said).toEqual(['busy', 'playing_hold'])
  })
})
