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

    if (payload.shuffle) {
      // After the queue exists, not before: shuffle applies to a queue, and
      // there is none until play_media builds one. The track already starting
      // stays first, and everything behind it is shuffled — which is what
      // Music Assistant's own app does.
      await this.options.ha.callService('media_player', 'shuffle_set', {
        entity_id: entity,
        shuffle: true,
      })
    }
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
