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

/**
 * States that mean a player cannot report playback at all.
 *
 * `on` is the trap. It is a perfectly valid media_player state and it is what a
 * television reports when it is awake — it has no idea what an app inside it is
 * doing. A player stuck on it will never say `playing`, so following it forever
 * is not patience, it is a hang. `idle` is NOT here: an idle player is one that
 * could report playback and currently is not, which is worth waiting on.
 */
const UNINFORMATIVE_STATES = new Set(['on', 'unknown', 'unavailable', 'standby'])

/** Polls of nothing useful before we stop believing the player will ever answer. */
const GIVE_UP_AFTER = 4

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

/** The one identifier a player gives for what it currently holds. */
export function contentIdOf(attributes: Record<string, unknown>): string {
  return text(attributes.media_content_id)
}

/** Everything the player says about what it is holding. */
function contentOf(attributes: Record<string, unknown>): string[] {
  return [
    attributes.media_content_id,
    attributes.media_title,
    attributes.media_album_name,
    attributes.media_series_title,
    attributes.media_artist,
  ]
    .map(text)
    .filter(Boolean)
}

function mentions(haystack: string[], card: Card): boolean {
  const title = card.title.toLowerCase().trim()
  const id = card.external_id.toLowerCase()
  return haystack.some((value) => value.includes(title) || value.includes(id))
}

/**
 * Whether what the player reports plausibly belongs to this cartridge.
 *
 * Deliberately generous, and paired with the strict version below because the
 * two are asked for different reasons. This one decides whether to LIGHT UP,
 * where a false positive costs a wrong colour; a player that reports nothing is
 * given the benefit of the doubt, since refusing would quietly disable the
 * light on those integrations entirely.
 */
export function looksLikeCard(
  attributes: Record<string, unknown>,
  card: Card,
): boolean {
  const haystack = contentOf(attributes)
  if (haystack.length === 0) return true
  return mentions(haystack, card)
}

/**
 * Whether the player is holding THIS cartridge's content, strictly.
 *
 * Used to decide whether to resume rather than start again, where the two
 * mistakes are not equal. Guessing wrong and resuming means the cartridge plays
 * something else entirely; guessing wrong and relaunching only costs you your
 * place. So silence is a no here, where for the light it is a yes.
 */
export function isSameContent(
  attributes: Record<string, unknown>,
  card: Card,
): boolean {
  const haystack = contentOf(attributes)
  if (haystack.length === 0) return false
  return mentions(haystack, card)
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
  /** Consecutive polls where the player said nothing that could ever be playback. */
  private uninformative = 0
  private explanation: string | null = null

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
    this.uninformative = 0
    this.explanation = null
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

  /** Why the light is doing what it is doing, when that is not self-evident. */
  get reason(): string | null {
    return this.explanation
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
    let raw: string | null = null
    let assumed = false
    try {
      const state = await this.deps.ha.getState(entity)
      raw = state?.state ?? null
      assumed = state?.attributes?.assumed_state === true
      playback = playbackFromState(raw)
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

    /*
      Give up on a player that cannot answer the question.

      Home Assistant sets `assumed_state` when it is guessing rather than
      reading, and a television parked on `on` will never say `playing` however
      long it is watched. Either way, continuing to follow it means the light
      sits on Ready for ever — indistinguishable from a launch that failed, and
      the reason this needed three rounds of diagnosis to find.

      Reported rather than merely handled: the add-on knows exactly why, and
      leaving the user to infer it from an LED is what made this expensive.
    */
    if (playback === 'idle' && (assumed || (raw !== null && UNINFORMATIVE_STATES.has(raw)))) {
      this.uninformative += 1
      if (this.uninformative >= GIVE_UP_AFTER) {
        this.explanation = assumed
          ? `${entity} is an assumed-state player, so Home Assistant cannot tell whether it is playing. Showing what the launch did instead.`
          : `${entity} reports "${raw}", which is not playback. Showing what the launch did instead.`
        log.info(this.explanation)
        this.push(statusForPlayingMode(settings.led_playing_mode))
        this.stop()
        return
      }
    } else {
      this.uninformative = 0
      this.explanation = null
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
      /*
        Seated, launched, and not playing yet.

        Its own state rather than Ready: an empty reader and a cartridge waiting
        for you to press play are different situations, and showing both as idle
        left the light saying nothing at the one moment it was being watched —
        a deep link that lands on a detail page with autoplay off is exactly
        this, and it looked identical to a failure.
      */
      this.push('waiting')
    }
  }

  /** Only on change: the reader has no need to be told the same thing every 3s. */
  private push(status: ReaderStatus): void {
    if (status === this.last) return
    this.last = status

    const settings = this.deps.settings()
    // Playing, paused and waiting are all about the cartridge on the reader,
    // so all three may wear its colour — which is also exactly the set the
    // firmware applies an accent to. These two lists have to agree.
    const accent =
      settings.led_playing_artwork &&
      (status === 'paused' || status === 'waiting' || status.startsWith('playing'))
        ? this.card?.accent_color
        : null

    void this.deps.light.setStatus(status, accent).catch(() => undefined)
  }
}
