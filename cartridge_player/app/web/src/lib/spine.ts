import type { Card } from '../types'
import { fitBackdrop } from './artFit'

/**
 * The label on the cartridge's spine — the edge you see on a shelf.
 *
 * 60 x 7 mm is a hard place to put words. There is room for roughly 25-30
 * characters, which is fine for "Kind of Blue" and hopeless for "The Lord of
 * the Rings: The Fellowship of the Ring", so everything here is about failing
 * legibly: shrink while that still reads, then truncate, and let the per-card
 * text override be the real answer.
 *
 * Nothing is stored unless it has been overridden. A card's spine follows its
 * artwork, so replacing a cover updates the spine for free.
 */

/** Default spine, in mm. The width follows the face label — same cartridge. */
export const SPINE_HEIGHT_MM = 7

/**
 * Type sizes as a fraction of the spine's height, largest first.
 *
 * Tried in order until one fits. The floor is not a guess at the smallest
 * readable type so much as the point past which shrinking stops buying room and
 * starts costing legibility — below it, truncating reads better than squinting.
 */
const TEXT_SCALES = [0.62, 0.56, 0.5, 0.45, 0.4]

/** Side padding, as a fraction of the spine's height. */
export const SPINE_PAD_RATIO = 0.45

export interface SpineType {
  /** Font size in the same unit as the height passed in. */
  size: number
  /** The text as it will appear, truncated with an ellipsis if it had to be. */
  text: string
  /** True when even the smallest size could not fit it whole. */
  truncated: boolean
}

/**
 * What a spine actually says, given how wide it is.
 *
 * `measure` returns the width of a string at a given font size, so this works
 * the same against a canvas context and against a DOM measurement — the printed
 * sheet and the PNG export must agree, and they only do if they ask the same
 * question.
 */
export function fitSpineText(
  text: string,
  widthMm: number,
  heightMm: number,
  measure: (text: string, size: number) => number,
): SpineType {
  const room = widthMm - heightMm * SPINE_PAD_RATIO * 2

  for (const scale of TEXT_SCALES) {
    const size = heightMm * scale
    if (measure(text, size) <= room) return { size, text, truncated: false }
  }

  // Past the floor: keep the smallest size and cut characters instead. Binary
  // search rather than a walk, because the DOM measurement behind this is not
  // free and a long title would otherwise measure dozens of times.
  const size = heightMm * TEXT_SCALES[TEXT_SCALES.length - 1]!
  let low = 0
  let high = text.length

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (measure(`${text.slice(0, mid).trimEnd()}…`, size) <= room) low = mid
    else high = mid - 1
  }

  if (low === 0) return { size, text: '…', truncated: true }
  return { size, text: `${text.slice(0, low).trimEnd()}…`, truncated: true }
}

/**
 * Text measurement in millimetres, using the page's own font.
 *
 * A canvas rather than a DOM node: measuring text by inserting elements and
 * reading offsetWidth forces a layout per attempt, and the printed sheet does
 * this once per cartridge. Text width scales linearly with font size, so
 * measuring at a fixed multiple and dividing gives millimetres directly.
 */
const MEASURE_PX_PER_MM = 10
let measureCtx: CanvasRenderingContext2D | null = null

export function spineMeasurer(): (text: string, sizeMm: number) => number {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  const ctx = measureCtx
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif'

  return (text, sizeMm) => {
    if (!ctx) return text.length * sizeMm * 0.5
    ctx.font = `600 ${sizeMm * MEASURE_PX_PER_MM}px ${family}`
    return ctx.measureText(text).width / MEASURE_PX_PER_MM
  }
}

const HEX = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

export function parseHex(color: string): [number, number, number] | null {
  const match = HEX.exec(color.trim())
  if (!match) return null
  return [
    parseInt(match[1]!, 16),
    parseInt(match[2]!, 16),
    parseInt(match[3]!, 16),
  ]
}

/**
 * Black or white, whichever can be read on `background`.
 *
 * A dominant colour can come back anywhere from near-black to pale cream, so a
 * fixed text colour is invisible on some fraction of any real library. This is
 * the sRGB relative luminance from WCAG, and the 0.179 threshold is the point
 * where black and white contrast equally against a colour — so whichever side
 * of it the background falls, the answer is the higher-contrast one.
 */
export function readableTextColor(background: string): string {
  const rgb = parseHex(background)
  if (!rgb) return '#000000'

  const [r, g, b] = rgb.map((channel) => {
    const v = channel / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.179 ? '#000000' : '#ffffff'
}

/** What a spine says when nothing has been written for it. */
export function spineText(card: Card): string {
  const override = card.spine_text?.trim()
  return override && override.length > 0 ? override : card.title
}

/**
 * The spine's colours: the override if there is one, otherwise the artwork's.
 *
 * Deliberately the same call the sticker's Colour fit makes, rather than a
 * second sampler that agrees with it today. The spine and the face are two
 * edges of one physical object, so a cartridge whose label sits on a green
 * block and whose spine came out olive would look like a mistake — and it is
 * already cached per card, so the print sheet decodes each cover once.
 *
 * Falls back to white with black text, which is what a cartridge with no
 * artwork gets. A plain spine is a cosmetic disappointment; throwing here would
 * take a whole print sheet down with it.
 */
export async function spineColors(
  card: Card,
): Promise<{ background: string; text: string }> {
  const background = card.spine_color ?? (await fitBackdrop(card, 'color')).color

  return {
    background,
    text: card.spine_text_color ?? readableTextColor(background),
  }
}
