import type { ArtFit, Card } from '../types'
import { artworkSourceUrl } from './exportSticker'

/**
 * Reconciling square cover art with a 60x90 sticker.
 *
 * Album covers are 1:1 and the sticker is 2:3, so a third of the height has to
 * come from somewhere. The three answers — crop it, blur it, colour it — are a
 * per-cartridge choice, because the right one depends on the cover: a photo
 * survives cropping, a cover with the title along the bottom does not.
 *
 * Everything here is shared by the printable sheet and the Cricut PNG export.
 * They used to compute artwork separately and silently drifted apart; one
 * pipeline is the fix.
 */

/**
 * Width of the blurred backdrop before it is stretched back up.
 *
 * The blur comes from scaling a tiny image up and letting the renderer smooth
 * it, NOT from a CSS or canvas filter. Filters are the obvious approach and the
 * wrong one here: browsers are inconsistent about applying them when printing,
 * and a dropped filter would put a razor-sharp zoomed cover behind a small one.
 * Upscaling degrades to "slightly less blurry" everywhere instead.
 */
const BACKDROP_PX = 24

/** Sampling grid for the dominant colour. Bigger buys nothing perceptible. */
const SAMPLE_PX = 32

/** Channel bits kept when bucketing colours. 4 bits gives 4096 buckets. */
const QUANTIZE_SHIFT = 4

export interface FitBackdrop {
  /** CSS colour for the area a contained cover does not fill. */
  color: string
  /** Data URL of the tiny image to stretch behind it, when the fit blurs. */
  blurUrl: string | null
}

/** How the cover itself is drawn. `crop` fills the sticker; the rest inset it. */
export function objectFitFor(fit: ArtFit): 'cover' | 'contain' {
  return fit === 'crop' ? 'cover' : 'contain'
}

function saturationOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/**
 * The colour a cover reads as, from its raw RGBA pixels.
 *
 * Frequency rather than average: averaging a red cover with a black border
 * gives a muddy brown that appears nowhere in the image. Frequency picks a
 * colour actually present.
 *
 * The saturation preference exists because the most common bucket on a great
 * many covers is near-black or near-white — technically correct and visually
 * dead. A saturated colour that is nearly as common reads far better as a
 * border, so it wins ties generously.
 */
export function dominantColor(pixels: Uint8ClampedArray): string {
  const counts = new Map<number, { count: number; r: number; g: number; b: number }>()

  for (let i = 0; i < pixels.length; i += 4) {
    // Transparent padding is not part of the artwork.
    if (pixels[i + 3]! < 128) continue

    const r = pixels[i]!
    const g = pixels[i + 1]!
    const b = pixels[i + 2]!
    const key =
      ((r >> QUANTIZE_SHIFT) << 8) | ((g >> QUANTIZE_SHIFT) << 4) | (b >> QUANTIZE_SHIFT)

    const bucket = counts.get(key)
    if (bucket) {
      bucket.count += 1
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      counts.set(key, { count: 1, r, g, b })
    }
  }

  if (counts.size === 0) return '#ffffff'

  let best: { score: number; r: number; g: number; b: number } | null = null
  for (const bucket of counts.values()) {
    const r = Math.round(bucket.r / bucket.count)
    const g = Math.round(bucket.g / bucket.count)
    const b = Math.round(bucket.b / bucket.count)

    // A saturated colour counts for up to twice its frequency.
    const score = bucket.count * (1 + saturationOf(r, g, b))
    if (!best || score > best.score) best = { score, r, g, b }
  }

  const { r, g, b } = best!
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

async function loadArtwork(card: Card): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = artworkSourceUrl(card)
  await image.decode()
  return image
}

function scaleToFit(width: number, height: number, box: number): [number, number] {
  const scale = box / Math.max(width, height)
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

/** Draws `image` into a small canvas and hands back its context. */
function downscale(image: HTMLImageElement, box: number): CanvasRenderingContext2D | null {
  const [w, h] = scaleToFit(image.naturalWidth || box, image.naturalHeight || box, box)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h

  // Read back repeatedly for the colour sample, so say so up front.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, w, h)
  return ctx
}

/** Below these, a colour cannot read as light — it reads as "off". */
const LIGHT_MIN_SATURATION = 0.35
const LIGHT_MIN_VALUE = 0.25

/**
 * Whether a stored accent colour is one the reader could actually wear.
 *
 * `lightAccent` scales its answer to full value, so anything it returns passes
 * this. Anything that does NOT pass therefore came from somewhere else — an
 * older release, a hand-edited row — and is worth resampling rather than
 * leaving in place, because nothing else ever looks at it again.
 *
 * The add-on applies the same floors before sending a colour to the reader.
 */
export function isWearableAccent(color: string | null | undefined): boolean {
  if (!color || !/^#?[0-9a-f]{6}$/i.test(color)) return false

  const hex = color.replace(/^#/, '')
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ]

  return (
    Math.max(r, g, b) / 255 >= LIGHT_MIN_VALUE &&
    saturationOf(r, g, b) >= LIGHT_MIN_SATURATION
  )
}

/**
 * The colour a cover should light an LED with.
 *
 * Deliberately NOT `dominantColor`, though the first version of this reused it
 * and was wrong. A sticker background wants the cover's dominant tone, so a
 * mostly-black cover correctly gets a black border. An LED asked for that same
 * near-black shows nothing at all, and a cover with a dark background and one
 * vivid element — which is most film posters — produced an unlit reader.
 *
 * So this asks a different question: what is the most identifiable colour here
 * that would actually be visible as light? Candidates below a minimum
 * saturation and value are discarded outright rather than dimmed, and the
 * winner is scaled to full value so hue is all it contributes. How bright the
 * reader gets is the palette's business, not the artwork's.
 *
 * Returns null when nothing qualifies — a black-and-white cover has no colour
 * to offer, and saying so lets the caller fall back to the fixed palette
 * instead of showing a muddy grey.
 */
export function lightAccent(pixels: Uint8ClampedArray): string | null {
  const counts = new Map<number, { count: number; r: number; g: number; b: number }>()

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue

    const r = pixels[i]!
    const g = pixels[i + 1]!
    const b = pixels[i + 2]!
    if (Math.max(r, g, b) / 255 < LIGHT_MIN_VALUE) continue
    if (saturationOf(r, g, b) < LIGHT_MIN_SATURATION) continue

    const key =
      ((r >> QUANTIZE_SHIFT) << 8) | ((g >> QUANTIZE_SHIFT) << 4) | (b >> QUANTIZE_SHIFT)
    const bucket = counts.get(key)
    if (bucket) {
      bucket.count += 1
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      counts.set(key, { count: 1, r, g, b })
    }
  }

  if (counts.size === 0) return null

  let best: { score: number; r: number; g: number; b: number } | null = null
  for (const bucket of counts.values()) {
    const r = Math.round(bucket.r / bucket.count)
    const g = Math.round(bucket.g / bucket.count)
    const b = Math.round(bucket.b / bucket.count)
    const score = bucket.count * (1 + saturationOf(r, g, b))
    if (!best || score > best.score) best = { score, r, g, b }
  }

  // Scaled to full value: a teal sampled at half brightness and a teal sampled
  // at full should light the reader identically, because they are the same hue.
  const { r, g, b } = best!
  const scale = 255 / Math.max(r, g, b)
  return `#${[r, g, b]
    .map((c) => Math.min(255, Math.round(c * scale)).toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * The colour a cartridge's artwork should light the reader with, or null.
 *
 * Sampled in the browser rather than on the server: the server has no image
 * decoder, and adding one to look at a cover it never displays would be a heavy
 * dependency for a cosmetic feature.
 */
export async function accentColor(card: Card): Promise<string | null> {
  if (!card.poster_url) return null
  try {
    const image = await loadArtwork(card)
    const ctx = downscale(image, SAMPLE_PX)
    if (!ctx) return null
    const { width, height } = ctx.canvas
    return lightAccent(ctx.getImageData(0, 0, width, height).data)
  } catch {
    return null
  }
}

const cache = new Map<string, FitBackdrop>()

const cacheKey = (card: Card, fit: ArtFit) => `${card.id}:${card.updated_at}:${fit}`

/**
 * What to put behind a cover that does not fill the sticker.
 *
 * Falls back to white on any failure — a sticker with a plain border is a
 * cosmetic disappointment, whereas a thrown error would take the whole print
 * sheet down with it.
 */
export async function fitBackdrop(card: Card, fit: ArtFit): Promise<FitBackdrop> {
  if (fit === 'crop') return { color: '#ffffff', blurUrl: null }

  const key = cacheKey(card, fit)
  const hit = cache.get(key)
  if (hit) return hit

  let result: FitBackdrop = { color: '#ffffff', blurUrl: null }
  try {
    const image = await loadArtwork(card)

    if (fit === 'color') {
      const ctx = downscale(image, SAMPLE_PX)
      if (ctx) {
        const { width, height } = ctx.canvas
        result = {
          color: dominantColor(ctx.getImageData(0, 0, width, height).data),
          blurUrl: null,
        }
      }
    } else {
      const ctx = downscale(image, BACKDROP_PX)
      if (ctx) {
        result = {
          // Under the blur in case the image has transparency of its own.
          color: '#ffffff',
          blurUrl: ctx.canvas.toDataURL('image/png'),
        }
      }
    }
  } catch {
    // Artwork unreachable, or a canvas the browser refuses to read back.
  }

  cache.set(key, result)
  return result
}
