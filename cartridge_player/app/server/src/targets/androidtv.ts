import { TargetNotConfiguredError, UnsupportedPayloadError } from '../errors.js'
import type { LaunchPayload, Target, TargetKey } from '../types.js'

export interface ServiceCaller {
  callService(domain: string, service: string, data: Record<string, unknown>): Promise<void>
}

/** §6.1 — the abstract keys mapped into Android TV's own vocabulary. */
const KEY_COMMANDS: Record<TargetKey, string> = {
  home: 'HOME',
  select: 'DPAD_CENTER',
  back: 'BACK',
}

export interface AndroidTvTargetOptions {
  ha: ServiceCaller
  remoteEntity: string | null
  mediaPlayerEntity: string | null
}

/** v1 ships exactly one Target implementation (§6). */
export class AndroidTvTarget implements Target {
  readonly id = 'androidtv'

  constructor(private readonly options: AndroidTvTargetOptions) {}

  async launch(payload: LaunchPayload): Promise<void> {
    if (payload.kind !== 'uri') {
      // Typed and catchable, so a future provider returning a stream URL fails
      // loudly at the seam instead of silently doing nothing (§10.1).
      throw new UnsupportedPayloadError(this.id, payload.kind)
    }
    await this.options.ha.callService('remote', 'turn_on', {
      entity_id: this.requireRemote(),
      activity: payload.value,
    })
  }

  async sendKey(key: TargetKey): Promise<void> {
    await this.options.ha.callService('remote', 'send_command', {
      entity_id: this.requireRemote(),
      command: KEY_COMMANDS[key],
    })
  }

  async stop(): Promise<void> {
    await this.options.ha.callService('media_player', 'media_stop', {
      entity_id: this.requireMediaPlayer('stop'),
    })
  }

  async pause(): Promise<void> {
    await this.options.ha.callService('media_player', 'media_pause', {
      entity_id: this.requireMediaPlayer('pause'),
    })
  }

  private requireRemote(): string {
    const entity = this.options.remoteEntity
    if (!entity) {
      throw new TargetNotConfiguredError(
        'No TV selected yet — pick a remote entity in Settings.',
      )
    }
    return entity
  }

  private requireMediaPlayer(operation: string): string {
    const entity = this.options.mediaPlayerEntity
    if (!entity) {
      throw new TargetNotConfiguredError(
        `"${operation}" needs a media player entity — pick one in Settings.`,
      )
    }
    return entity
  }
}
