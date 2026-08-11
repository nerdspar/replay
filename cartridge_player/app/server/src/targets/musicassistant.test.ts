import { describe, expect, it } from 'vitest'
import { MusicAssistantTarget } from './musicassistant.js'
import { TargetNotConfiguredError, UnsupportedPayloadError } from '../errors.js'
import { RecordingHa } from '../test/helpers.js'
import type { LaunchPayload } from '../types.js'

function make(player: string | null = 'media_player.kitchen') {
  const ha = new RecordingHa()
  return { ha, target: new MusicAssistantTarget({ ha, playerEntity: player }) }
}

function mediaItem(overrides: Partial<Extract<LaunchPayload, { kind: 'media_item' }>> = {}) {
  return {
    kind: 'media_item' as const,
    value: 'library://album/42',
    mediaType: 'album',
    shuffle: false,
    radioMode: false,
    ...overrides,
  }
}

describe('MusicAssistantTarget (§6)', () => {
  it('plays a library item on the speaker, replacing whatever was queued', async () => {
    const { ha, target } = make()
    await target.launch(mediaItem())

    expect(ha.calls).toEqual([
      {
        domain: 'music_assistant',
        service: 'play_media',
        data: {
          entity_id: 'media_player.kitchen',
          media_id: 'library://album/42',
          media_type: 'album',
          enqueue: 'replace',
          radio_mode: false,
        },
      },
    ])
  })

  it('passes radio mode through, so a tag can keep going after the album ends', async () => {
    const { ha, target } = make()
    await target.launch(mediaItem({ radioMode: true }))

    expect(ha.calls[0]!.data.radio_mode).toBe(true)
  })

  it('shuffles only after the queue exists', async () => {
    const { ha, target } = make()
    await target.launch(mediaItem({ mediaType: 'artist', shuffle: true }))

    // Order is the whole point: shuffle applies to a queue, and play_media is
    // what builds one. Reversed, the shuffle would land on the previous queue.
    expect(ha.calls.map((c) => `${c.domain}.${c.service}`)).toEqual([
      'music_assistant.play_media',
      'media_player.shuffle_set',
    ])
    expect(ha.calls[1]!.data).toEqual({
      entity_id: 'media_player.kitchen',
      shuffle: true,
    })
  })

  it('does not touch shuffle when the cartridge does not ask for it', async () => {
    const { ha, target } = make()
    await target.launch(mediaItem())

    // Not `shuffle: false` — leaving the speaker's own state alone.
    expect(ha.calls).toHaveLength(1)
  })

  it('refuses a payload meant for a screen', async () => {
    const { target } = make()
    await expect(
      target.launch({ kind: 'uri', value: 'stremio:///detail/movie/tt1/tt1' }),
    ).rejects.toBeInstanceOf(UnsupportedPayloadError)
  })

  it('refuses keys, because a speaker has no D-pad', async () => {
    const { target } = make()
    await expect(target.sendKey('select')).rejects.toBeInstanceOf(UnsupportedPayloadError)
  })

  it('pauses and stops through the standard media player domain', async () => {
    const { ha, target } = make()
    await target.pause()
    await target.stop()

    expect(ha.calls.map((c) => `${c.domain}.${c.service}`)).toEqual([
      'media_player.media_pause',
      'media_player.media_stop',
    ])
    expect(ha.calls.every((c) => c.data.entity_id === 'media_player.kitchen')).toBe(true)
  })

  it('says what is missing when no speaker has been chosen', async () => {
    const { target } = make(null)
    await expect(target.launch(mediaItem())).rejects.toBeInstanceOf(
      TargetNotConfiguredError,
    )
    await expect(target.launch(mediaItem())).rejects.toThrow(/pick one in Settings/)
  })
})
