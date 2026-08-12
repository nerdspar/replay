import { useEffect, useState } from 'react'
import { fitBackdrop, objectFitFor, type FitBackdrop } from '../lib/artFit'
import type { ArtFit, Card } from '../types'

/**
 * What this cartridge's sticker will look like.
 *
 * Shown beside the choice, because the choice was previously invisible where it
 * was made: the three options live in the edit sheet and their only effect was
 * on a print preview two screens away. A setting you cannot see the result of
 * reads as a setting that does nothing.
 *
 * Same aspect and the same pipeline as the printed sheet, so what appears here
 * is what comes out of the printer — including a failure to load the artwork,
 * which now shows up as a plain background rather than being swallowed.
 */

/** 60 x 90 mm, at a size that fits beside a radio list on a phone. */
const WIDTH = 60
const HEIGHT = 90

interface StickerPreviewProps {
  card: Card
  fit: ArtFit
  /** The artwork being previewed, which may not be saved yet. */
  poster: string | null
}

export function StickerPreview({ card, fit, poster }: StickerPreviewProps) {
  const [backdrop, setBackdrop] = useState<FitBackdrop | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)

    if (fit === 'crop') {
      setBackdrop(null)
      return
    }

    void fitBackdrop(card, fit).then((result) => {
      if (cancelled) return
      setBackdrop(result)
      // A blur that came back empty means the artwork could not be read —
      // worth saying, since the sticker would print with a plain border and
      // no indication why.
      setFailed(fit === 'blur' && result.blurUrl === null)
    })

    return () => {
      cancelled = true
    }
  }, [card, fit, poster])

  return (
    <div className="sticker-preview">
      <div
        className="sticker-preview-face"
        style={{
          aspectRatio: `${WIDTH} / ${HEIGHT}`,
          background: backdrop?.color ?? '#ffffff',
        }}
      >
        {backdrop?.blurUrl ? (
          <img className="sticker-preview-backdrop" src={backdrop.blurUrl} alt="" />
        ) : null}
        {poster ? (
          <img src={poster} alt="" style={{ objectFit: objectFitFor(fit) }} />
        ) : (
          <span className="sticker-preview-empty">{card.title}</span>
        )}
      </div>
      <p className="hint">
        {failed
          ? 'Could not read this artwork, so the sticker would print on plain white. Try a different image.'
          : '60 × 90 mm, actual proportions'}
      </p>
    </div>
  )
}
