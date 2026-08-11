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
