import { describe, expect, it } from 'vitest'
import { pickEpisode, playableEpisodes } from './episode-pick.js'
import type { MetaVideo } from '../types.js'

const ep = (season: number, episode: number): MetaVideo => ({
  id: `tt1:${season}:${episode}`,
  season,
  episode,
  title: `S${season}E${episode}`,
})

/** Three seasons of two, plus a special, deliberately out of order. */
const show = [ep(2, 1), ep(1, 2), ep(0, 1), ep(3, 1), ep(1, 1), ep(2, 2), ep(3, 2)]

describe('which episodes are playable', () => {
  it('sorts by season then episode', () => {
    expect(playableEpisodes(show).map((v) => `${v.season}-${v.episode}`)).toEqual([
      '1-1',
      '1-2',
      '2-1',
      '2-2',
      '3-1',
      '3-2',
    ])
  })

  it('leaves out specials', () => {
    // Season 0 is where recaps and Christmas specials live. Nobody asking for
    // the next episode wants one between episodes four and five.
    expect(playableEpisodes(show).some((v) => v.season === 0)).toBe(false)
  })

  it('keeps them when a series is nothing but specials', () => {
    // Otherwise the cartridge could never play anything at all.
    expect(playableEpisodes([ep(0, 1), ep(0, 2)])).toHaveLength(2)
  })
})

describe('the next episode', () => {
  const next = (cursor: { season: number | null; episode: number | null }) =>
    pickEpisode('next', show, cursor)

  it('starts at the first episode when nothing has played', () => {
    expect(next({ season: null, episode: null })).toMatchObject({ season: 1, episode: 1 })
  })

  it('advances one', () => {
    expect(next({ season: 1, episode: 1 })).toMatchObject({ season: 1, episode: 2 })
  })

  it('crosses a season boundary', () => {
    expect(next({ season: 1, episode: 2 })).toMatchObject({ season: 2, episode: 1 })
  })

  it('wraps at the end rather than going dead', () => {
    expect(next({ season: 3, episode: 2 })).toMatchObject({ season: 1, episode: 1 })
  })

  it('starts over when the cursor names an episode the series no longer lists', () => {
    // A re-indexed show would otherwise strand the cartridge for ever.
    expect(next({ season: 9, episode: 9 })).toMatchObject({ season: 1, episode: 1 })
  })

  it('never returns a special, even when the cursor is one', () => {
    expect(next({ season: 0, episode: 1 })).toMatchObject({ season: 1, episode: 1 })
  })
})

describe('a random episode', () => {
  it('picks from the playable list', () => {
    const picked = pickEpisode('random', show, { season: null, episode: null }, () => 0.5)
    expect(playableEpisodes(show)).toContainEqual(picked)
  })

  it('never repeats what just played', () => {
    // The whole point of the mode. Checked across every draw rather than one,
    // because a single sample passes by luck.
    const cursor = { season: 2, episode: 1 }
    for (let i = 0; i < 20; i++) {
      const picked = pickEpisode('random', show, cursor, () => i / 20)
      expect(`${picked!.season}-${picked!.episode}`).not.toBe('2-1')
    }
  })

  it('reaches every other episode', () => {
    const cursor = { season: 1, episode: 1 }
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const picked = pickEpisode('random', show, cursor, () => i / 50)
      seen.add(`${picked!.season}-${picked!.episode}`)
    }
    expect(seen.size).toBe(5)
  })

  it('replays the only episode there is rather than returning nothing', () => {
    const one = [ep(1, 1)]
    expect(pickEpisode('random', one, { season: 1, episode: 1 })).toMatchObject({
      season: 1,
      episode: 1,
    })
  })

  it('survives a random() that returns exactly 1', () => {
    // Math.random() never does, but a seeded stand-in might, and an index one
    // past the end would be undefined rather than an episode.
    const picked = pickEpisode('random', show, { season: null, episode: null }, () => 1)
    expect(picked).not.toBeUndefined()
    expect(picked).not.toBeNull()
  })
})

describe('the modes that resolve nothing', () => {
  it('leaves list and pinned to the existing path', () => {
    expect(pickEpisode('list', show, { season: null, episode: null })).toBeNull()
    expect(pickEpisode('pinned', show, { season: 1, episode: 1 })).toBeNull()
  })

  it('returns null for a series with no episodes listed', () => {
    expect(pickEpisode('next', [], { season: null, episode: null })).toBeNull()
  })
})
