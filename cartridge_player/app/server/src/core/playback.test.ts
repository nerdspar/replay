import { describe, expect, it, vi } from 'vitest'
import {
  PlaybackWatcher,
  looksLikeCard,
  playbackFromState,
  playerFor,
} from './playback.js'
import type { ReaderLight } from './reader-light.js'
import { ScanHandler } from './scan-handler.js'
import { FakeProvider, FakeTarget, card, settings } from '../test/helpers.js'
import { testContext } from '../test/context.js'
import type { SeatedCartridge, Settings } from '../types.js'

function watcher(state: string | null, overrides: Partial<Settings> = {}) {
  const said: string[] = []
  const seats: (SeatedCartridge | null)[] = []
  const attributes: Record<string, unknown> = {}

  const w = new PlaybackWatcher({
    ha: {
      getState: async () => (state === null ? null : { state, attributes }),
    },
    light: {
      setStatus: async (s: string, color?: string | null) =>
        void said.push(color ? `${s}:${color}` : s),
    } as unknown as ReaderLight,
    settings: () => settings({ media_player_entity: 'media_player.tv', ...overrides }),
    onSeated: (s) => void seats.push(s),
  })
  return { w, said, seats, attributes }
}

/** start() reports immediately, so one tick has already happened after it. */
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('reading playback out of a player state', () => {
  it('treats buffering as playing, because it is about to be', () => {
    expect(playbackFromState('playing')).toBe('playing')
    expect(playbackFromState('buffering')).toBe('playing')
    expect(playbackFromState('paused')).toBe('paused')
  })

  it('treats everything else as nothing playing', () => {
    for (const state of ['idle', 'standby', 'off', 'unknown', 'unavailable', '']) {
      expect(playbackFromState(state)).toBe('idle')
    }
    expect(playbackFromState(null)).toBe('idle')
    expect(playbackFromState(undefined)).toBe('idle')
  })
})

describe('which player a cartridge belongs to', () => {
  it('sends video to the TV and music to the speaker', () => {
    const s = settings({
      media_player_entity: 'media_player.tv',
      music_player_entity: 'media_player.kitchen',
    })
    expect(playerFor(card({ kind: 'video' }), s)).toBe('media_player.tv')
    expect(playerFor(card({ kind: 'music' }), s)).toBe('media_player.kitchen')
  })

  it('lets one music cartridge name its own speaker', () => {
    const s = settings({ music_player_entity: 'media_player.kitchen' })
    expect(playerFor(card({ kind: 'music', player_entity: 'media_player.den' }), s)).toBe(
      'media_player.den',
    )
  })
})

describe('the bug this exists for', () => {
  it('stops claiming playback when the launch landed on a menu', async () => {
    // The exact case: a deep link opens the detail page, autoplay is off, and
    // nothing ever starts. The old code called that "playing" for ever.
    const { w, said } = watcher('idle')
    w.start(card())
    await settle()

    expect(said).toEqual(['ready'])
    w.stop()
  })

  it('says playing only once something actually is', async () => {
    const { w, said } = watcher('playing')
    w.start(card())
    await settle()

    expect(said).toEqual(['playing_hold'])
    w.stop()
  })

  it('has its own state for paused', async () => {
    const { w, said } = watcher('paused')
    w.start(card())
    await settle()

    expect(said).toEqual(['paused'])
    w.stop()
  })
})

describe('staying quiet', () => {
  it('tells the reader only when something changes', async () => {
    const { w, said } = watcher('playing')
    w.start(card())
    await settle()
    // Two more polls at the same state.
    await w['tick']()
    await w['tick']()

    // Once, not three times: the reader has no use for the same news every 3s.
    expect(said).toEqual(['playing_hold'])
    w.stop()
  })

  it('reports again when the state really does change', async () => {
    const store = { state: 'playing' }
    const said: string[] = []
    const w = new PlaybackWatcher({
      ha: { getState: async () => ({ state: store.state, attributes: {} }) },
      light: { setStatus: async (s: string) => void said.push(s) } as unknown as ReaderLight,
      settings: () => settings({ media_player_entity: 'media_player.tv' }),
      onSeated: () => undefined,
    })

    w.start(card())
    await settle()
    store.state = 'paused'
    await w['tick']()
    store.state = 'idle'
    await w['tick']()

    expect(said).toEqual(['playing_hold', 'paused', 'ready'])
    w.stop()
  })
})

describe('when there is nothing to watch', () => {
  it('falls back to announcing the launch with no player configured', async () => {
    const { w, said } = watcher('playing', { media_player_entity: null })
    w.start(card())
    await settle()

    // The media player is optional for video, where it is otherwise only used
    // for pause and stop. Without one, the old behaviour is all that is possible.
    expect(said).toEqual(['playing_hold'])
  })

  it('does the same when following is switched off', async () => {
    const { w, said } = watcher('idle', { led_follow_player: false })
    w.start(card())
    await settle()

    expect(said).toEqual(['playing_hold'])
    w.stop()
  })

  it('keeps quiet rather than guessing when the player cannot be read', async () => {
    const said: string[] = []
    const w = new PlaybackWatcher({
      ha: {
        getState: async () => {
          throw new Error('home assistant is restarting')
        },
      },
      light: { setStatus: async (s: string) => void said.push(s) } as unknown as ReaderLight,
      settings: () => settings({ media_player_entity: 'media_player.tv' }),
      onSeated: () => undefined,
    })

    w.start(card())
    await settle()

    expect(said).toEqual([])
    w.stop()
  })
})

describe('only for this cartridge', () => {
  const withTitle = card({ title: 'Blade Runner', external_id: 'tt0083658' })

  it('is off by default, so anything playing counts', async () => {
    const { w, said, attributes } = watcher('playing')
    attributes.media_title = 'Something Else Entirely'
    w.start(withTitle)
    await settle()

    expect(said).toEqual(['playing_hold'])
    w.stop()
  })

  it('ignores unrelated content when asked to', async () => {
    const { w, said, attributes } = watcher('playing', { led_match_cartridge: true })
    attributes.media_title = 'Something Else Entirely'
    w.start(withTitle)
    await settle()

    expect(said).toEqual(['ready'])
    w.stop()
  })

  it('matches on the title', () => {
    expect(looksLikeCard({ media_title: 'Blade Runner (1982)' }, withTitle)).toBe(true)
  })

  it('matches on the id, which survives a retitling', () => {
    expect(
      looksLikeCard({ media_content_id: 'stremio:///detail/movie/tt0083658/x' }, withTitle),
    ).toBe(true)
  })

  it('accepts a player that reports nothing about what it holds', () => {
    // Some integrations say only "playing". Refusing there would make the
    // setting quietly switch the whole light off.
    expect(looksLikeCard({}, withTitle)).toBe(true)
    expect(looksLikeCard({ volume_level: 0.4 }, withTitle)).toBe(true)
  })
})

describe('saying which cartridge is in the reader', () => {
  it('announces it the moment it is seated, before anything plays', async () => {
    const { w, seats } = watcher('idle')
    w.start(card({ title: 'Blade Runner' }))

    expect(seats[0]?.card.title).toBe('Blade Runner')
    expect(seats[0]?.playback).toBe('idle')
    w.stop()
  })

  it('announces again when it starts playing', async () => {
    const { w, seats } = watcher('playing')
    w.start(card())
    await settle()

    expect(seats.map((s) => s?.playback)).toEqual(['idle', 'playing'])
    w.stop()
  })

  it('says nothing is seated once the cartridge is lifted', async () => {
    const { w, seats } = watcher('playing')
    w.start(card())
    await settle()
    w.stop()

    expect(seats[seats.length - 1]).toBeNull()
  })

  it('does not announce an empty reader twice', () => {
    const { w, seats } = watcher('idle')
    w.stop()
    w.stop()

    expect(seats).toEqual([])
  })
})

describe('artwork colour', () => {
  it('rides along with playing and paused, and nothing else', async () => {
    const store = { state: 'playing' }
    const said: string[] = []
    const w = new PlaybackWatcher({
      ha: { getState: async () => ({ state: store.state, attributes: {} }) },
      light: {
        setStatus: async (s: string, c?: string | null) =>
          void said.push(c ? `${s}:${c}` : s),
      } as unknown as ReaderLight,
      settings: () =>
        settings({ media_player_entity: 'media_player.tv', led_playing_artwork: true }),
      onSeated: () => undefined,
    })

    w.start(card({ accent_color: '#3366cc' }))
    await settle()
    store.state = 'paused'
    await w['tick']()
    store.state = 'idle'
    await w['tick']()

    // "ready" is about the reader, not the cartridge, so it keeps its own colour.
    expect(said).toEqual(['playing_hold:#3366cc', 'paused:#3366cc', 'ready'])
    w.stop()
  })
})

/**
 * Lifting a cartridge while its launch is still running.
 *
 * Easy to do: a Music Assistant play_media can take seconds to resolve a URI
 * against a streaming provider, and a tap-and-lift is quicker than that.
 */
describe('a cartridge lifted mid-launch', () => {
  function slowLaunch() {
    const active = testContext()
    const { ctx } = active
    ctx.store.updateSettings({ home_delay_ms: 0, autoplay_delay_ms: 0 })

    const said: string[] = []
    let release: () => void = () => undefined
    const launched = new Promise<void>((r) => (release = r))

    // A target that does not finish until we say so.
    ctx.targets.register('androidtv', () => ({
      id: 'slow',
      launch: async () => launched,
      sendKey: async () => undefined,
      stop: async () => undefined,
      pause: async () => undefined,
      turnOff: async () => undefined,
    }))

    ctx.store.createCard(
      {
        tag_uid: '04-77',
        provider: 'stremio',
        content_type: 'movie',
        external_id: 'tt7',
        title: 'Slow To Start',
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

    const watched: string[] = []
    ctx.scans = new ScanHandler({
      store: ctx.store,
      providers: ctx.providers,
      targets: ctx.targets,
      pending: ctx.pending,
      bus: ctx.bus,
      light: { setStatus: async (s) => void said.push(s) } as unknown as ReaderLight,
      playback: {
        start: (c: { title: string }, seated = true) =>
          void watched.push(`start:${c.title}${seated ? '' : ':unseated'}`),
        stop: () => void watched.push('stop'),
        detach: () => void watched.push('detach'),
      } as never,
    })

    return { ctx, said, watched, release, cleanup: active.cleanup }
  }

  it('does not start following one that has already been taken off', async () => {
    const { ctx, watched, release, cleanup } = slowLaunch()

    const firing = ctx.scans.handleInserted('04-77')
    // Lifted before the launch finishes.
    await ctx.scans.handleRemoved('04-77')
    release()
    await firing

    // Following it here would relight the reader for a cartridge that is no
    // longer in it, and leave it stuck on the playing colour.
    expect(watched).toEqual(['stop'])
    cleanup()
  })

  it('does follow it when the light is about playback rather than the reader', async () => {
    const { ctx, watched, release, cleanup } = slowLaunch()
    ctx.store.updateSettings({ led_scope: 'playback' })

    const firing = ctx.scans.handleInserted('04-77')
    await ctx.scans.handleRemoved('04-77')
    release()
    await firing

    // Started, but told it is not seated — so the banner stays empty while the
    // light follows what the launch set going.
    expect(watched).toEqual(['detach', 'start:Slow To Start:unseated'])
    cleanup()
  })

  it('still follows one that stayed put', async () => {
    const { ctx, watched, release, cleanup } = slowLaunch()

    const firing = ctx.scans.handleInserted('04-77')
    release()
    await firing

    expect(watched).toEqual(['start:Slow To Start'])
    cleanup()
  })

  it('is not fooled by the uid being written differently', async () => {
    const { ctx, watched, release, cleanup } = slowLaunch()

    const firing = ctx.scans.handleInserted('04-77')
    // The reader reports removal in whatever format it likes.
    await ctx.scans.handleRemoved('0477')
    release()
    await firing

    expect(watched).toEqual(['stop'])
    cleanup()
  })
})

/**
 * Whether the light is about the reader or about what is playing.
 *
 * They only differ in one moment: a cartridge lifted off while its music
 * carries on, which is itself a setting — so the two belong together.
 */
describe('what the light is about', () => {
  it('follows past the lift-off, then hands back when the music stops', async () => {
    const store = { state: 'playing' }
    const said: string[] = []
    const seats: (SeatedCartridge | null)[] = []
    const w = new PlaybackWatcher({
      ha: { getState: async () => ({ state: store.state, attributes: {} }) },
      light: { setStatus: async (s: string) => void said.push(s) } as unknown as ReaderLight,
      settings: () => settings({ media_player_entity: 'media_player.tv' }),
      onSeated: (s) => void seats.push(s),
    })

    w.start(card())
    await settle()
    w.detach()
    // Still playing, so the light stays with it.
    await w['tick']()
    expect(said).toEqual(['playing_hold'])
    // The reader is empty either way, so the banner has already cleared.
    expect(seats[seats.length - 1]).toBeNull()

    store.state = 'idle'
    await w['tick']()
    expect(said).toEqual(['playing_hold', 'ready'])
    w.stop()
  })

  it('does not detach something it was never following', () => {
    const { w, seats } = watcher('playing')
    w.detach()
    expect(seats).toEqual([])
  })

  it('keeps the banner honest while it is still seated', async () => {
    const { w, seats } = watcher('playing')
    w.start(card({ title: 'Rumours' }))
    await settle()

    expect(seats[seats.length - 1]?.card.title).toBe('Rumours')
    w.stop()
  })
})

/**
 * Putting a cartridge back after a pause.
 *
 * "Pause" as a lift-off action promises that putting the cartridge back carries
 * on where it stopped. It did not: every insert ran a full launch, and Music
 * Assistant's play_media takes `enqueue: replace`, which rebuilds the queue
 * from track one.
 */
describe('putting a paused cartridge back on', () => {
  function reader(playerState: string, attributes: Record<string, unknown> = {}) {
    const active = testContext()
    const { ctx } = active
    ctx.store.updateSettings({
      home_delay_ms: 0,
      autoplay_delay_ms: 0,
      music_player_entity: 'media_player.kitchen',
    })

    const target = new FakeTarget()
    ctx.targets.register('music_assistant', () => target)
    ctx.providers.register(new FakeProvider('music_assistant'))
    ctx.store.createCard(
      {
        tag_uid: '04-88',
        provider: 'music_assistant',
        content_type: 'album',
        external_id: 'library://album/12',
        title: 'Rumours',
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

    ctx.scans = new ScanHandler({
      store: ctx.store,
      providers: ctx.providers,
      targets: ctx.targets,
      pending: ctx.pending,
      bus: ctx.bus,
      ha: { getState: async () => ({ state: playerState, attributes }) },
    })

    return { ctx, target, cleanup: active.cleanup }
  }

  it('resumes rather than starting the album again', async () => {
    const { ctx, target, cleanup } = reader('paused', { media_title: 'Rumours' })
    const { scan } = await ctx.scans.handleInserted('04-88')

    expect(target.calls).toEqual(['resume'])
    expect(scan.action_taken).toBe('resume')
    cleanup()
  })

  it('starts it properly when the speaker is idle', async () => {
    const { ctx, target, cleanup } = reader('idle')
    await ctx.scans.handleInserted('04-88')

    expect(target.calls).toContain('launch')
    expect(target.calls).not.toContain('resume')
    cleanup()
  })

  it('starts it properly when something else is paused', async () => {
    // Resuming here would play the wrong thing entirely, which is a far worse
    // mistake than losing your place.
    const { ctx, target, cleanup } = reader('paused', { media_title: 'Kind of Blue' })
    await ctx.scans.handleInserted('04-88')

    expect(target.calls).toContain('launch')
    expect(target.calls).not.toContain('resume')
    cleanup()
  })

  it('starts it properly when the player says nothing about what it holds', async () => {
    // Silence is a NO here, where for the light it is a yes: the two questions
    // have different costs when answered wrongly.
    const { ctx, target, cleanup } = reader('paused', {})
    await ctx.scans.handleInserted('04-88')

    expect(target.calls).toContain('launch')
    expect(target.calls).not.toContain('resume')
    cleanup()
  })

  it('matches on the id, so a retitling does not restart the album', async () => {
    const { ctx, target, cleanup } = reader('paused', {
      media_content_id: 'library://album/12',
      media_title: 'Rumours (2004 Remaster)',
    })
    await ctx.scans.handleInserted('04-88')

    expect(target.calls).toEqual(['resume'])
    cleanup()
  })
})

/**
 * A playlist cartridge.
 *
 * The case that showed matching-by-content to be the wrong idea: the card is
 * named for the playlist, and the player reports whichever track it is on, so
 * they never match and the whole playlist restarted every time.
 */
describe('carrying on with something the player cannot name', () => {
  function playlistReader(playerState: string, contentId: string, hint: string | null) {
    const active = testContext()
    const { ctx } = active
    ctx.store.updateSettings({
      home_delay_ms: 0,
      autoplay_delay_ms: 0,
      music_player_entity: 'media_player.kitchen',
      music_removal_action: 'pause',
    })

    const target = new FakeTarget()
    ctx.targets.register('music_assistant', () => target)
    ctx.providers.register(new FakeProvider('music_assistant'))
    const card = ctx.store.createCard(
      {
        tag_uid: '04-99',
        provider: 'music_assistant',
        content_type: 'playlist',
        external_id: 'library://playlist/7',
        title: 'Sunday Morning',
        year: null,
        poster_url: null,
        season: null,
        episode: null,
        label: null,
        player_entity: null,
        art_fit: null,
        accent_color: null,
        resume_hint: hint,
        shuffle: false,
        radio_mode: false,
      },
      1,
    )

    ctx.scans = new ScanHandler({
      store: ctx.store,
      providers: ctx.providers,
      targets: ctx.targets,
      pending: ctx.pending,
      bus: ctx.bus,
      // Nothing here mentions the playlist — only the track it is on.
      ha: {
        getState: async () => ({
          state: playerState,
          attributes: {
            media_content_id: contentId,
            media_title: 'Dreams',
            media_artist: 'Fleetwood Mac',
          },
        }),
      },
    })

    return { ctx, card, target, cleanup: active.cleanup }
  }

  it('resumes a playlist paused where we left it', async () => {
    const { ctx, target, cleanup } = playlistReader('paused', 'library://track/991', 'library://track/991')
    await ctx.scans.handleInserted('04-99')

    expect(target.calls).toEqual(['resume'])
    cleanup()
  })

  it('starts over when something else has been played since', async () => {
    const { ctx, target, cleanup } = playlistReader('paused', 'library://track/222', 'library://track/991')
    await ctx.scans.handleInserted('04-99')

    expect(target.calls).toContain('launch')
    expect(target.calls).not.toContain('resume')
    cleanup()
  })

  it('starts over when it was never paused by lifting it off', async () => {
    const { ctx, target, cleanup } = playlistReader('paused', 'library://track/991', null)
    await ctx.scans.handleInserted('04-99')

    // No mark, and the playlist's name appears nowhere in what the player says.
    expect(target.calls).toContain('launch')
    cleanup()
  })

  it('remembers where it was when the cartridge comes off', async () => {
    const { ctx, card, cleanup } = playlistReader('playing', 'library://track/991', null)
    await ctx.scans.handleInserted('04-99')
    await ctx.scans.handleRemoved('04-99')

    expect(ctx.store.getCard(card.id)?.resume_hint).toBe('library://track/991')
    cleanup()
  })

  it('forgets it once the playlist is started from the top again', async () => {
    const { ctx, card, cleanup } = playlistReader('idle', 'library://track/991', 'library://track/000')
    await ctx.scans.handleInserted('04-99')

    // Relaunched, so whatever it was paused at is now in the past.
    expect(ctx.store.getCard(card.id)?.resume_hint).toBeNull()
    cleanup()
  })
})
