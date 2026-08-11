import { Icon } from './Icon'
import type { CardKind } from '../types'

interface PosterProps {
  /**
   * A URL only — the browser fetches artwork directly and nothing is cached to
   * `/data`. A hundred cartridges of cached posters is hundreds of megabytes on
   * a disk with other demands (§3.5).
   */
  src?: string | null
  alt: string
  badge?: string | null
  /** Decides the placeholder when there is no artwork. */
  kind?: CardKind
}

export function Poster({ src, alt, badge, kind = 'video' }: PosterProps) {
  return (
    <div className="poster">
      {src ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" />
      ) : (
        <div className="fallback">
          <Icon name={kind === 'music' ? 'music' : 'film'} size={30} />
        </div>
      )}
      {badge ? <span className="badge">{badge}</span> : null}
    </div>
  )
}

export function episodeBadge(season: number | null, episode: number | null): string | null {
  if (season === null || episode === null) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `S${pad(season)}E${pad(episode)}`
}
