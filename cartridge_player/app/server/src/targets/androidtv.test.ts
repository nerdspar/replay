import { describe, expect, it } from 'vitest'
import { AndroidTvTarget } from './androidtv.js'
import { TargetNotConfiguredError, UnsupportedPayloadError } from '../errors.js'
import { RecordingHa } from '../test/helpers.js'

function make(overrides: { remote?: string | null; player?: string | null } = {}) {
  const ha = new RecordingHa()
  const target = new AndroidTvTarget({
    ha,
    remoteEntity: overrides.remote === undefined ? 'remote.living_room_tv' : overrides.remote,
    mediaPlayerEntity:
      overrides.player === undefined ? 'media_player.living_room' : overrides.player,
  })
  return { ha, target }
}

describe('AndroidTvTarget (§6.1)', () => {
  it('launches a uri as remote.turn_on with an activity', async () => {
    const { ha, target } = make()
    await target.launch({ kind: 'uri', value: 'stremio://detail/movie/tt1/tt1' })

    expect(ha.calls).toEqual([
      {
        domain: 'remote',
        service: 'turn_on',
        data: { entity_id: 'remote.living_room_tv', activity: 'stremio://detail/movie/tt1/tt1' },
      },
    ])
  })

  it('powers the TV down through the remote entity', async () => {
    const { ha, target } = make()
    await target.turnOff()

    expect(ha.calls).toEqual([
      {
        domain: 'remote',
        service: 'turn_off',
        data: { entity_id: 'remote.living_room_tv' },
      },
    ])
  })

  it('says which entity is missing when asked to power off with no remote', async () => {
    const { target } = make({ remote: null })
    await expect(target.turnOff()).rejects.toBeInstanceOf(TargetNotConfiguredError)
  })

  it('maps abstract keys to Android TV commands', async () => {
    const { ha, target } = make()
    await target.sendKey('home')
    await target.sendKey('select')
    await target.sendKey('back')

    expect(ha.calls.map((c) => c.data.command)).toEqual(['HOME', 'DPAD_CENTER', 'BACK'])
    expect(ha.calls.every((c) => c.domain === 'remote' && c.service === 'send_command')).toBe(true)
  })

  it('routes stop and pause to the media player', async () => {
    const { ha, target } = make()
    await target.stop()
    await target.pause()

    expect(ha.calls).toEqual([
      {
        domain: 'media_player',
        service: 'media_stop',
        data: { entity_id: 'media_player.living_room' },
      },
      {
        domain: 'media_player',
        service: 'media_pause',
        data: { entity_id: 'media_player.living_room' },
      },
    ])
  })

  /** §10.1 — required: typed and catchable, never silent, never a generic Error. */
  it('throws a typed UnsupportedPayloadError for a media_url payload', async () => {
    const { ha, target } = make()

    const error = await target
      .launch({ kind: 'media_url', value: 'http://jellyfin.local/s.mkv' })
      .then(() => null)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(UnsupportedPayloadError)
    expect(error).toMatchObject({
      code: 'unsupported_payload',
      targetId: 'androidtv',
      payloadKind: 'media_url',
    })
    // It must not have half-fired something first.
    expect(ha.calls).toEqual([])
  })

  it('reports a missing TV as a typed configuration error', async () => {
    const { target } = make({ remote: null })
    await expect(target.sendKey('home')).rejects.toBeInstanceOf(TargetNotConfiguredError)
  })

  it('reports a missing media player only for the operations that need one', async () => {
    const { target } = make({ player: null })
    await expect(target.pause()).rejects.toBeInstanceOf(TargetNotConfiguredError)
    // Launching does not need a media player.
    await expect(target.launch({ kind: 'uri', value: 'stremio://x' })).resolves.toBeUndefined()
  })
})
