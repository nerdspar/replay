import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEntityPlatformLookup, formatPlatform } from './entity-registry.js'
import { buildServer } from '../http/server.js'
import { testContext, type TestContext } from '../test/context.js'
import type { HomeAssistantWs } from './ws.js'
import type { EntityOption } from './rest.js'

let active: TestContext | null = null

afterEach(() => {
  active?.cleanup()
  active = null
})

function fakeWs(command: HomeAssistantWs['command']): HomeAssistantWs {
  return { command } as unknown as HomeAssistantWs
}

describe('formatPlatform', () => {
  it('uses the names people see on the integrations page', () => {
    expect(formatPlatform('music_assistant')).toBe('Music Assistant')
    expect(formatPlatform('androidtv_remote')).toBe('Android TV Remote')
    expect(formatPlatform('apple_tv')).toBe('Apple TV')
  })

  it('title-cases an integration it has never heard of', () => {
    expect(formatPlatform('some_new_thing')).toBe('Some New Thing')
    expect(formatPlatform('bluesound')).toBe('Bluesound')
  })

  it('leaves acronyms to the known list rather than guessing by word length', () => {
    // "dlna_dmr" is known, so it reads properly...
    expect(formatPlatform('dlna_dmr')).toBe('DLNA')
    // ...while an unknown short word is not shouted at.
    expect(formatPlatform('new_thing')).toBe('New Thing')
  })
})

describe('entity platform lookup', () => {
  it('maps entities to the integration that provides them', async () => {
    const lookup = createEntityPlatformLookup(
      fakeWs(
        vi.fn(async () => [
          {
            entity_id: 'media_player.living_room',
            platform: 'androidtv_remote',
            config_entry_id: 'entry-tv',
          },
          {
            entity_id: 'media_player.living_room_2',
            platform: 'music_assistant',
            config_entry_id: 'entry-mass',
          },
        ]) as unknown as HomeAssistantWs['command'],
      ),
    )

    const map = await lookup()
    expect(map.get('media_player.living_room')).toEqual({
      platform: 'androidtv_remote',
      configEntryId: 'entry-tv',
    })
    // The config entry is what addresses a Music Assistant search, and it is
    // reachable ONLY here — no state or REST endpoint carries it.
    expect(map.get('media_player.living_room_2')).toEqual({
      platform: 'music_assistant',
      configEntryId: 'entry-mass',
    })
  })

  it('caches, so opening Settings repeatedly does not hammer the socket', async () => {
    const command = vi.fn(async () => []) as unknown as HomeAssistantWs['command']
    let clock = 0
    const lookup = createEntityPlatformLookup(fakeWs(command), () => clock)

    await lookup()
    await lookup()
    expect(command).toHaveBeenCalledTimes(1)

    clock = 61_000
    await lookup()
    expect(command).toHaveBeenCalledTimes(2)
  })

  it('collapses concurrent calls into one request', async () => {
    const command = vi.fn(
      async () => new Promise((resolve) => setTimeout(() => resolve([]), 10)),
    ) as unknown as HomeAssistantWs['command']
    const lookup = createEntityPlatformLookup(fakeWs(command))

    await Promise.all([lookup(), lookup(), lookup()])
    expect(command).toHaveBeenCalledTimes(1)
  })

  /** This is only ever an enhancement — it must never break the pickers. */
  it('returns an empty map when the socket is down', async () => {
    const lookup = createEntityPlatformLookup(
      fakeWs(
        vi.fn(async () => {
          throw new Error('not connected to Home Assistant')
        }) as unknown as HomeAssistantWs['command'],
      ),
    )

    await expect(lookup()).resolves.toEqual(new Map())
  })

  it('ignores registry rows that are missing what we need', async () => {
    const lookup = createEntityPlatformLookup(
      fakeWs(
        vi.fn(async () => [
          { entity_id: 'media_player.a' },
          { platform: 'orphan' },
          null,
          { entity_id: 'media_player.b', platform: 'cast' },
        ]) as unknown as HomeAssistantWs['command'],
      ),
    )

    expect([...(await lookup())]).toEqual([
      ['media_player.b', { platform: 'cast', configEntryId: null }],
    ])
  })
})

describe('GET /api/entities', () => {
  const states = [
    {
      entity_id: 'media_player.living_room',
      state: 'idle',
      attributes: { friendly_name: 'Living Room' },
    },
    {
      entity_id: 'media_player.living_room_2',
      state: 'idle',
      attributes: { friendly_name: 'Living Room' },
    },
    { entity_id: 'remote.tv', state: 'on', attributes: { friendly_name: 'TV' } },
  ]

  function withStates(platforms: Map<string, string>) {
    const origins = new Map(
      [...platforms].map(([id, platform]) => [id, { platform, configEntryId: null }]),
    )
    active = testContext()
    const { ctx } = active
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(ctx.ha as any).getStates = async () => states
    ctx.entityPlatforms = async () => origins
    return ctx
  }

  it('labels two identically named players with their integrations', async () => {
    const ctx = withStates(
      new Map([
        ['media_player.living_room', 'androidtv_remote'],
        ['media_player.living_room_2', 'music_assistant'],
      ]),
    )
    const app = buildServer(ctx, { requirePin: false })

    const body = (await app.inject({ method: 'GET', url: '/api/entities' })).json() as {
      mediaPlayers: EntityOption[]
    }

    // Same name, different integration — which is the whole point.
    expect(body.mediaPlayers.map((e) => [e.name, e.platform])).toEqual([
      ['Living Room', 'Android TV Remote'],
      ['Living Room', 'Music Assistant'],
    ])

    await app.close()
  })

  it('still returns entities when the registry is unavailable', async () => {
    const ctx = withStates(new Map())
    const app = buildServer(ctx, { requirePin: false })

    const body = (await app.inject({ method: 'GET', url: '/api/entities' })).json() as {
      mediaPlayers: EntityOption[]
      remotes: EntityOption[]
    }

    expect(body.mediaPlayers).toHaveLength(2)
    expect(body.remotes).toHaveLength(1)
    expect(body.mediaPlayers[0]?.platform).toBeUndefined()

    await app.close()
  })
})
