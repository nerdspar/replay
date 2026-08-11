import type { ArtFit, Card } from '../types'
import { fitBackdrop, objectFitFor } from './artFit'

/**
 * Renders one sticker as a PNG for Cricut Design Space.
 *
 * Design Space imports images, not printed pages — JPG, PNG, GIF, SVG, DXF,
 * HEIC or BMP — so a browser print is no use to it. PNG is the right one here
 * because it carries transparency: the area outside the rounded corners is left
 * clear, and Print Then Cut derives its cut line from the opaque shape. Get that
 * wrong and it cuts a square around a rounded sticker.
 *
 * The artwork is loaded from our own origin (`api/artwork/card/:id`). A canvas
 * that has drawn a cross-origin image cannot be read back — `toBlob` throws a
 * SecurityError — and poster hosts do not send CORS headers.
 */

/** 300 dpi is the usual floor for print; Print Then Cut registers happily at it. */
export const EXPORT_DPI = 300

export const mmToPx = (mm: number, dpi = EXPORT_DPI) => Math.round((mm / 25.4) * dpi)

export interface StickerExportOptions {
  widthMm: number
  heightMm: number
  radiusMm: number
  round: boolean
  fit: 'cover' | 'contain'
  dpi?: number
}

/**
 * A card's own fit wins over the sheet's.
 *
 * The sheet setting is about the shape of the sticker; `art_fit` is about one
 * particular cover, chosen while looking at it. Video cards have no `art_fit`
 * and keep whatever the sheet says.
 */
function fitFor(card: Card, sheetFit: 'cover' | 'contain'): 'cover' | 'contain' {
  return card.art_fit ? objectFitFor(card.art_fit) : sheetFit
}

/** Source rectangle for drawing `image` into `w x h` the way object-fit would. */
export function sourceRect(
  imageWidth: number,
  imageHeight: number,
  w: number,
  h: number,
  fit: 'cover' | 'contain',
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  const scale =
    fit === 'cover'
      ? Math.max(w / imageWidth, h / imageHeight)
      : Math.min(w / imageWidth, h / imageHeight)

  const dw = imageWidth * scale
  const dh = imageHeight * scale

  return {
    sx: 0,
    sy: 0,
    sw: imageWidth,
    sh: imageHeight,
    // Centred either way: cover overflows and is clipped, contain leaves margin.
    dx: (w - dw) / 2,
    dy: (h - dh) / 2,
    dw,
    dh,
  }
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(w - r, 0)
  ctx.arcTo(w, 0, w, r, r)
  ctx.lineTo(w, h - r)
  ctx.arcTo(w, h, w - r, h, r)
  ctx.lineTo(r, h)
  ctx.arcTo(0, h, 0, h - r, r)
  ctx.lineTo(0, r)
  ctx.arcTo(0, 0, r, 0, r)
  ctx.closePath()
}

export async function renderStickerPng(
  card: Card,
  options: StickerExportOptions,
): Promise<Blob> {
  const dpi = options.dpi ?? EXPORT_DPI
  const w = mmToPx(options.widthMm, dpi)
  const h = mmToPx(options.heightMm, dpi)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not create the image.')

  // Clip first, so everything outside the sticker shape stays transparent and
  // Print Then Cut traces the right outline.
  if (options.round) {
    ctx.beginPath()
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    ctx.closePath()
  } else {
    roundedRectPath(ctx, w, h, mmToPx(options.radiusMm, dpi))
  }
  ctx.clip()

  const fit = fitFor(card, options.fit)
  const backdrop = await fitBackdrop(card, card.art_fit ?? 'crop')

  // Something opaque behind the artwork: 'contain' leaves bars, and a
  // transparent bar would be cut away rather than printed.
  ctx.fillStyle = backdrop.color
  ctx.fillRect(0, 0, w, h)

  ctx.imageSmoothingQuality = 'high'

  if (backdrop.blurUrl) {
    // A 24px image stretched over the whole sticker. The renderer's own
    // smoothing is the blur — see artFit.ts for why not a filter.
    const tiny = new Image()
    tiny.src = backdrop.blurUrl
    await tiny.decode()
    const b = sourceRect(tiny.naturalWidth, tiny.naturalHeight, w, h, 'cover')
    ctx.drawImage(tiny, b.sx, b.sy, b.sw, b.sh, b.dx, b.dy, b.dw, b.dh)
  }

  const image = new Image()
  image.src = artworkSourceUrl(card)
  await image.decode()

  const r = sourceRect(image.naturalWidth, image.naturalHeight, w, h, fit)
  ctx.drawImage(image, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  )
  if (!blob) throw new Error('Your browser could not create the image.')
  return blob
}

/** Safe, recognisable filename — Design Space shows it in the upload list. */
export function stickerFileName(card: Card, widthMm: number, heightMm: number): string {
  const slug = card.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${slug || 'cartridge'}-${widthMm}x${heightMm}mm.png`
}

/**
 * Where to load a card's artwork from, for drawing onto a canvas.
 *
 * The path is stable per card but its CONTENT changes whenever the artwork
 * does, so the card's `updated_at` rides along as a cache buster. Without it a
 * browser that had already exported a sticker kept serving the old poster from
 * cache — the printed sheet updated, the exported PNG did not.
 */
export function artworkSourceUrl(card: Card): string {
  return `api/artwork/card/${card.id}?v=${card.updated_at}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
