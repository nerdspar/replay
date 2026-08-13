import { useMemo } from 'react'
import {
  SPINE_HEIGHT_MM,
  SPINE_PAD_RATIO,
  fitSpineText,
  spineMeasurer,
} from '../lib/spine'

/**
 * What this cartridge's spine will look like, at its real size.
 *
 * Drawn in millimetres rather than scaled to the column, because the question
 * this answers is "does my title fit on 7 mm of cartridge edge" and a preview
 * that is not life-size cannot answer it. On a phone 60 mm is around 227 px, so
 * it fits comfortably.
 *
 * The same fitting function the sheet and the PNG export use, so a title shown
 * shortened here is shortened identically on paper.
 */

interface SpinePreviewProps {
  text: string
  background: string
  textColor: string
  widthMm?: number
  heightMm?: number
}

export function SpinePreview({
  text,
  background,
  textColor,
  widthMm = 60,
  heightMm = SPINE_HEIGHT_MM,
}: SpinePreviewProps) {
  const fitted = useMemo(
    () => fitSpineText(text, widthMm, heightMm, spineMeasurer()),
    [text, widthMm, heightMm],
  )

  return (
    <div className="spine-preview">
      <div
        className="spine-preview-face"
        style={{
          width: `${widthMm}mm`,
          height: `${heightMm}mm`,
          padding: `0 ${heightMm * SPINE_PAD_RATIO}mm`,
          background,
        }}
      >
        <span style={{ color: textColor, fontSize: `${fitted.size}mm` }}>
          {fitted.text}
        </span>
      </div>
      <p className="hint">
        {fitted.truncated
          ? 'Too long for the spine, so it is shortened. Type a shorter name to choose where it cuts.'
          : `${widthMm} × ${heightMm} mm, actual size`}
      </p>
    </div>
  )
}
