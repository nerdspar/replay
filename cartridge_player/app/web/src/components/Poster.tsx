import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { fitBackdrop, objectFitFor, type FitBackdrop } from '../lib/artFit'
import type { ArtFit, CardKind } from '../types'

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
  /**
   * Show it the way its sticker will look.
   *
   * A tile is the same shape as a sticker, so there is no reason for the two to
   * disagree — and every reason for the grid to be the place you can see what
   * you are about to print. Needs the card, since the blurred and colour
   * treatments are derived from the artwork itself.
   */
  fit?: ArtFit | null
  card?: { id: number; updated_at: number; poster_url: string | null } | null
}

export function Poster({ src, alt, badge, kind = 'video', fit, card }: PosterProps) {
  const [backdrop, setBackdrop] = useState<FitBackdrop | null>(null)
  const active = fit && fit !== 'crop' ? fit : null

  useEffect(() => {
    if (!active || !card) {
      setBackdrop(null)
      return
    }

    let cancelled = false
    // Cached per card, per artwork, per fit — so a grid of forty cartridges
    // reads each cover once, not once per render.
    void fitBackdrop(card as never, active).then((result) => {
      if (!cancelled) setBackdrop(result)
    })

    return () => {
      cancelled = true
    }
  }, [active, card])

  return (
    <div className="poster" style={backdrop ? { background: backdrop.color } : undefined}>
      {backdrop?.blurUrl ? (
        <img className="poster-backdrop" src={backdrop.blurUrl} alt="" aria-hidden="true" />
      ) : null}
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          style={active ? { objectFit: objectFitFor(active) } : undefined}
        />
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
