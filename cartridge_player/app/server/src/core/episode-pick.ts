import type { EpisodeMode, MetaVideo } from '../types.js'

/**
 * Which episode a series cartridge should open this time.
 *
 * Pure, and deliberately so: "the next one after the last one, wrapping at the
 * end, skipping specials" is a pile of off-by-one decisions, and they are worth
 * testing without a provider, a database or a television in the way.
 */

export interface EpisodeCursor {
  season: number | null
  episode: number | null
}

/**
 * Regular episodes, in order, with specials excluded.
 *
 * Season 0 is where metadata sources put specials, recaps and behind-the-scenes
 * features. Working through a show, or dipping into one at random, means the
 * actual episodes — nobody asking for "next" wants a 1998 Christmas special
 * between episodes four and five. A series that is ENTIRELY specials keeps
 * them, because the alternative is a cartridge that can never play anything.
 */
export function playableEpisodes(videos: MetaVideo[]): MetaVideo[] {
  const regular = videos.filter((video) => video.season > 0)
  const usable = regular.length > 0 ? regular : videos

  return [...usable].sort((a, b) =>
    a.season === b.season ? a.episode - b.episode : a.season - b.season,
  )
}

const samePlace = (video: MetaVideo, cursor: EpisodeCursor): boolean =>
  video.season === cursor.season && video.episode === cursor.episode

/**
 * Returns null when there is nothing to choose from, which the caller treats as
 * "open the episode list" — a cartridge that cannot resolve an episode should
 * still land somewhere useful rather than failing the scan.
 */
export function pickEpisode(
  mode: EpisodeMode,
  videos: MetaVideo[],
  cursor: EpisodeCursor,
  random: () => number = Math.random,
): MetaVideo | null {
  if (mode !== 'random' && mode !== 'next') return null

  const episodes = playableEpisodes(videos)
  if (episodes.length === 0) return null
  if (episodes.length === 1) return episodes[0]!

  if (mode === 'next') {
    const at = episodes.findIndex((video) => samePlace(video, cursor))
    // Never played, or the cursor points at an episode this series no longer
    // lists: start at the beginning rather than guessing a position.
    if (at === -1) return episodes[0]!
    // Wraps. A show you have finished should start again, not go dead.
    return episodes[(at + 1) % episodes.length]!
  }

  // Random, excluding whatever just played. Without this a shelf of two-episode
  // picks repeats often enough to look broken, and the whole point of the mode
  // is not getting the same thing twice.
  const candidates = episodes.filter((video) => !samePlace(video, cursor))
  const pool = candidates.length > 0 ? candidates : episodes
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))
  return pool[index]!
}
