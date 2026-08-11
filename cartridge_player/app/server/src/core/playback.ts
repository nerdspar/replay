import { createLogger } from '../log.js'
import { statusForPlayingMode, type ReaderLight, type ReaderStatus } from './reader-light.js'
import type { Card, PlaybackState, SeatedCartridge, Settings } from '../types.js'

const log = createLogger('playback')

/**
 * Watches what is actually playing, for as long as a cartridge is on the reader.
 *
 * The add-on used to report that a cartridge was "playing" the moment its own
 * launch sequence finished without an error. That is a claim about what the
 * ADD-ON did, not about what happened: with autoplay off, a Stremio deep link
 * lands on a detail page and nothing starts. Navigate away and the reader was
 * still insisting something was playing.
 *
 * Home Assistant already knows the truth, because the media player is an
 * entity with a state. So the answer is to read it rather than to guess.
 */

/** How often the player is asked, while a cartridge is seated. */
const POLL_MS = 3000

/**
 * Polled rather than subscribed.
 *
 * The alternatives were receiving every state change in the whole instance and
 * filtering, or trigger subscriptions that must be torn down and re-established
 * on every reconnect and every settings change. This runs only while a
 * cartridge is actually on the reader, costs one small local request every few
 * seconds, and has far less to go wrong. The price is a few seconds of lag on a
 * pause, which is invisible on an ambient light.
 */
export interface StateReader {
  getState(entityId: string): Promise<{ state: string; attributes: Record<string, unknown> } | null>
}

export interface PlaybackWatcherDeps {
  ha: StateReader
  light: ReaderLight
  settings: () => Settings
  /**
   * Called whenever what is on the reader changes, or what it is doing does.
   * Null means nothing is seated. Drives the library's "in the reader" banner.
   */
  onSeated: (seated: SeatedCartridge | null) => void
  now?: () => number
}

const PLAYING_STATES = new Set(['playing', 'buffering'])
const PAUSED_STATES = new Set(['paused'])

export function playbackFromState(state: string | null | undefined): PlaybackState {
  if (!state) return 'idle'
  if (PLAYING_STATES.has(state)) return 'playing'
  if (PAUSED_STATES.has(state)) return 'paused'
  // idle, standby, off, unknown, unavailable — none of them is playback.
  return 'idle'
}

/** Which entity carries this cartridge's playback. */
export function playerFor(card: Card, settings: Settings): string | null {
  if (card.kind === 'music') return card.player_entity ?? settings.music_player_entity
  return settings.media_player_entity
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

/**
 * Whether what the player reports plausibly belongs to this cartridge.
 *
 * Deliberately generous. Matching a deep link against whatever a media player
 * chooses to report is unreliable in both directions — a film's `media_title`
 * often differs from its catalogue title, and some integrations report almost
 * nothing. A strict test would quietly stop the light working; a loose one
 * occasionally lets an unrelated title through, which is the cheaper mistake.
 */
export function looksLikeCard(
  attributes: Record<string, unknown>,
  card: Card,
): boolean {
  const haystack = [
    attributes.media_content_id,
    attributes.media_title,
    attributes.media_album_name,
    attributes.media_series_title,
    attributes.media_artist,
  ]
    .map(text)
    .filter(Boolean)

  if (haystack.length === 0) {
    // The player says nothing about what it holds. Refusing here would mean
    // the setting silently disables the light on those integrations.
    return true
  }

  const title = card.title.toLowerCase().trim()
  const id = card.external_id.toLowerCase()
  return haystack.some((value) => value.includes(title) || value.includes(id))
}

export class PlaybackWatcher {
  private timer: NodeJS.Timeout | null = null
  private card: Card | null = null
  /**
   * Whether that cartridge is still physically on the reader.
   *
   * Separate from `card` because under the `playback` scope the two come apart:
   * the cartridge is lifted, its music keeps going, and the light keeps
   * following it. The library's banner always uses this, since it answers
   * "what is in the reader" and nothing else.
   */
  private seated = false
  private last: ReaderStatus | null = null
  private playback: PlaybackState = 'idle'

  constructor(private readonly deps: PlaybackWatcherDeps) {}

  /** The cartridge on the reader right now, if the app should be tracking one. */
  get seatedCard(): Card | null {
    return this.card
  }

  get seatedPlayback(): PlaybackState {
    return this.playback
  }

  /**
   * Begins following a cartridge that has just been fired.
   *
   * Reports once immediately: the reader is holding a "working" state waiting to
   * hear something, and would otherwise decide nobody had answered.
   */
  start(card: Card, seated = true): void {
    this.stop()
    this.card = card
    this.seated = seated
    this.announce()

    if (!this.deps.settings().led_follow_player) {
      // Not following: say what the launch did and leave it there, which is the
      // old behaviour and all that is possible without a player to read.
      this.push(statusForPlayingMode(this.deps.settings().led_playing_mode))
      return
    }

    void this.tick()
    this.timer = setInterval(() => void this.tick(), POLL_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null

    const had = this.card !== null
    this.card = null
    this.seated = false
    this.last = null
    this.playback = 'idle'
    if (had) this.deps.onSeated(null)
  }

  /**
   * The cartridge came off, but keep following what it started.
   *
   * Only under the `playback` scope, and paired with a lift-off action that
   * lets the music continue: the reader is empty, so the banner clears, while
   * the light stays with what is actually playing until it stops.
   */
  detach(): void {
    if (!this.card) return
    this.seated = false
    this.deps.onSeated(null)
  }

  private announce(): void {
    this.deps.onSeated(
      this.card && this.seated
        ? { card: this.card, playback: this.playback, since: (this.deps.now ?? Date.now)() }
        : null,
    )
  }

  private async tick(): Promise<void> {
    const card = this.card
    if (!card) return

    const settings = this.deps.settings()
    const entity = playerFor(card, settings)
    if (!entity) {
      // Nothing to watch. The media player is optional for video, where it is
      // otherwise only used for pause and stop.
      this.push(statusForPlayingMode(settings.led_playing_mode))
      this.stop()
      return
    }

    let playback: PlaybackState = 'idle'
    try {
      const state = await this.deps.ha.getState(entity)
      playback = playbackFromState(state?.state)
      if (
        playback !== 'idle' &&
        settings.led_match_cartridge &&
        !looksLikeCard(state?.attributes ?? {}, card)
      ) {
        playback = 'idle'
      }
    } catch (error) {
      log.debug(`could not read ${entity}: ${(error as Error).message}`)
      return
    }

    if (playback !== this.playback) {
      this.playback = playback
      this.announce()
    }

    if (playback === 'playing') {
      this.push(statusForPlayingMode(settings.led_playing_mode))
    } else if (playback === 'paused') {
      this.push('paused')
    } else if (!this.seated) {
      // Followed past the cartridge being lifted, and now it has stopped. There
      // is nothing left to be about, so hand the light back.
      this.push('ready')
      this.stop()
    } else {
      // Seated but nothing is playing — which is exactly the case that used to
      // show green for ever.
      this.push('ready')
    }
  }

  /** Only on change: the reader has no need to be told the same thing every 3s. */
  private push(status: ReaderStatus): void {
    if (status === this.last) return
    this.last = status

    const settings = this.deps.settings()
    const accent =
      settings.led_playing_artwork && (status === 'paused' || status.startsWith('playing'))
        ? this.card?.accent_color
        : null

    void this.deps.light.setStatus(status, accent).catch(() => undefined)
  }
}
