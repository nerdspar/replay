/**
 * Layout maths for print sheets. Everything here is in millimetres, because
 * that is the only unit a printer respects — a "sticker" measured in pixels is
 * a different size on every device.
 */

export interface PageSize {
  id: string
  label: string
  width: number
  height: number
}

// US Letter first: it is the default, and the first entry is what the print
// page opens on.
export const PAGE_SIZES: PageSize[] = [
  { id: 'letter', label: 'US Letter', width: 215.9, height: 279.4 },
  { id: 'a4', label: 'A4', width: 210, height: 297 },
]

export interface StickerPreset {
  id: string
  label: string
  width: number
  height: number
  /** Corner radius in mm. Ignored when `shape` is round. */
  radius: number
  shape: 'rect' | 'round'
  hint: string
}

/*
 * No title caption, deliberately. A poster already carries its title, in better
 * typography than we would set it in — and because a label has to fit a fixed
 * recess, a caption bar could only take its space from the artwork, which would
 * push the art off 2:3 and start cropping the poster. The one fact a poster
 * genuinely cannot tell you is which episode a cartridge is pinned to, and that
 * rides along as a corner badge instead, costing no space.
 */

export const STICKER_PRESETS: StickerPreset[] = [
  {
    id: 'cartridge-label',
    label: 'Cartridge label',
    width: 60,
    height: 90,
    radius: 4,
    shape: 'rect',
    hint: 'Fits the cartridge shell. Exactly 2:3, so posters print uncropped.',
  },
  {
    id: 'tag-dot',
    label: 'Tag dot',
    width: 25,
    height: 25,
    radius: 0,
    shape: 'round',
    hint: 'Matches a 25 mm NTAG215 sticker.',
  },
]

/**
 * Cricut's Print Then Cut works by printing registration marks around the
 * design and reading them back, so the design has to sit inside a smaller box
 * than the page. Cricut publishes the usable design area per paper size; these
 * are the two this app offers, converted from inches.
 *
 * https://help.cricut.com/hc/en-us/articles/360009429814
 */
export const CRICUT_DESIGN_AREA: Record<string, { width: number; height: number }> = {
  letter: { width: 7.44 * 25.4, height: 9.94 * 25.4 }, // 189.0 x 252.5 mm
  a4: { width: 7.2 * 25.4, height: 10.62 * 25.4 }, // 182.9 x 269.7 mm
}

/**
 * Whether one sticker is small enough for Print Then Cut.
 *
 * The limit applies to the sticker rather than to any page: Design Space is
 * handed a single image per cartridge and lays out the sheet itself, so the
 * margins this app uses for its own printed sheet never reach the machine.
 *
 * True if it fits either published area, since which one applies depends on the
 * material chosen in Design Space. Only a hand-typed size can breach this —
 * every preset is far under — but the alternative is a stack of PNGs that
 * Design Space refuses after they have all been made.
 */
export function fitsCricutDesignArea(sticker: {
  width: number
  height: number
}): boolean {
  return Object.values(CRICUT_DESIGN_AREA).some(
    (area) => sticker.width <= area.width && sticker.height <= area.height,
  )
}

export interface SheetLayout {
  page: PageSize
  margin: number
  gap: number
  sticker: { width: number; height: number }
}

export interface GridPlan {
  columns: number
  rows: number
  perPage: number
  /** True when a single sticker cannot fit the page at all. */
  impossible: boolean
}

/**
 * How many stickers fit, given the page, its margins, and the gutter. Computed
 * rather than left to the browser: chunking pages explicitly is far more
 * reliable across print engines than hoping `break-inside` behaves.
 */
export function planGrid({ page, margin, gap, sticker }: SheetLayout): GridPlan {
  const usableWidth = page.width - margin * 2
  const usableHeight = page.height - margin * 2

  const fit = (usable: number, size: number) => {
    if (size <= 0 || usable < size) return 0
    return Math.floor((usable + gap) / (size + gap))
  }

  const columns = fit(usableWidth, sticker.width)
  const rows = fit(usableHeight, sticker.height)

  return {
    columns,
    rows,
    perPage: columns * rows,
    impossible: columns === 0 || rows === 0,
  }
}

/** Splits a flat list into pages of `perPage`. */
export function paginate<T>(items: T[], perPage: number): T[][] {
  if (perPage <= 0) return []
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage))
  }
  return pages
}

/** Repeats each item `copies` times, keeping items adjacent for easy cutting. */
export function withCopies<T>(items: T[], copies: number): T[] {
  const n = Math.max(1, Math.floor(copies))
  return items.flatMap((item) => Array.from({ length: n }, () => item))
}
