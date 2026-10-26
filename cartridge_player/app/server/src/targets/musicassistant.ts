import { TargetNotConfiguredError, UnsupportedPayloadError } from '../errors.js'
import type { LaunchPayload, Target, TargetKey } from '../types.js'
import type { ServiceCaller } from './androidtv.js'

export interface MusicAssistantTargetOptions {
  ha: ServiceCaller
  /**
   * Already resolved: the cartridge's own speaker if it names one, otherwise the
   * household default. The target never sees the fallback rule.
   */
  playerEntity: string | null
}

/** §6 — the audio counterpart to AndroidTvTarget. */
export class MusicAssistantTarget implements Target {
  readonly id = 'music_assistant'

  constructor(private readonly options: MusicAssistantTargetOptions) {}

  async launch(payload: LaunchPayload): Promise<void> {
    if (payload.kind !== 'media_item') {
      throw new UnsupportedPayloadError(this.id, payload.kind)
    }
    const entity = this.requirePlayer('play')

    await this.options.ha.callService('music_assistant', 'play_media', {
      entity_id: entity,
      media_id: payload.value,
      media_type: payload.mediaType,
      // The cartridge IS what is playing, so it replaces the queue rather than
      // joining it. Anything else and tapping a tag would do nothing audible
      // until whatever is already queued finished.
      enqueue: 'replace',
      radio_mode: payload.radioMode,
    })

    // After the queue exists, not before: both apply to a queue, and there is
    // none until play_media builds one. The track already starting stays first,
    // and everything behind it is shuffled — which is what Music Assistant's
    // own app does.
    //
    // Set every time, off as well as on. A queue keeps both from whatever
    // played last, so an album cartridge tapped after a shuffled playlist would
    // otherwise come out shuffled — and one tapped after a lullaby on repeat
    // would never end.
    await this.options.ha.callService('media_player', 'shuffle_set', {
      entity_id: entity,
      shuffle: payload.shuffle,
    })
    await this.options.ha.callService('media_player', 'repeat_set', {
      entity_id: entity,
      repeat: payload.repeat,
    })
  }

  /**
   * A speaker has no D-pad. This is not an oversight to be filled in later:
   * the abstract keys exist to steer an on-screen interface, and there is no
   * screen. Failing loudly at the seam beats silently doing nothing (§10.1).
   */
  async sendKey(key: TargetKey): Promise<void> {
    throw new UnsupportedPayloadError(this.id, `key:${key}`)
  }

  async stop(): Promise<void> {
    await this.options.ha.callService('media_player', 'media_stop', {
      entity_id: this.requirePlayer('stop'),
    })
  }

  /**
   * Deliberately not play_media. That takes `enqueue: replace`, which rebuilds
   * the queue and starts the album again from track one — the very thing a
   * pause was meant to avoid.
   */
  async resume(): Promise<void> {
    await this.options.ha.callService('media_player', 'media_play', {
      entity_id: this.requirePlayer('resume'),
    })
  }

  async pause(): Promise<void> {
    await this.options.ha.callService('media_player', 'media_pause', {
      entity_id: this.requirePlayer('pause'),
    })
  }

  async turnOff(): Promise<void> {
    await this.options.ha.callService('media_player', 'turn_off', {
      entity_id: this.requirePlayer('turn off'),
    })
  }

  private requirePlayer(operation: string): string {
    const entity = this.options.playerEntity
    if (!entity) {
      throw new TargetNotConfiguredError(
        `"${operation}" needs a speaker — pick one in Settings, or on this cartridge.`,
      )
    }
    return entity
  }
}
