import { useMemo } from 'react'
import {
  SPINE_HEIGHT_MM,
  SPINE_PAD_RATIO,
  fitSpineText,
  spineMeasurer,
} from '../lib/spine'
import { fontStack } from '../lib/spineFonts'
import type { SpineAlign } from '../types'

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
  /** Id from SPINE_FONTS. */
  font?: string
  align?: SpineAlign
  widthMm?: number
  heightMm?: number
}

export function SpinePreview({
  text,
  background,
  textColor,
  font,
  align = 'left',
  widthMm = 60,
  heightMm = SPINE_HEIGHT_MM,
}: SpinePreviewProps) {
  const stack = fontStack(font)
  // Fitted in the face it will be set in, so a wide face truncating earlier than
  // a narrow one is visible here rather than discovered on paper.
  const fitted = useMemo(
    () => fitSpineText(text, widthMm, heightMm, spineMeasurer(stack)),
    [text, widthMm, heightMm, stack],
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
          justifyContent:
            align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
        }}
      >
        <span
          style={{ color: textColor, fontSize: `${fitted.size}mm`, fontFamily: stack }}
        >
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
