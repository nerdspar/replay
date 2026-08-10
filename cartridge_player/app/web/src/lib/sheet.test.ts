import { describe, expect, it } from 'vitest'
import {
  PAGE_SIZES,
  STICKER_PRESETS,
  paginate,
  planGrid,
  withCopies,
  type PageSize,
} from './sheet'

const A4 = PAGE_SIZES.find((p) => p.id === 'a4')!
const LETTER = PAGE_SIZES.find((p) => p.id === 'letter')!

const plan = (page: PageSize, w: number, h: number, margin = 10, gap = 3) =>
  planGrid({ page, margin, gap, sticker: { width: w, height: h } })

describe('grid planning', () => {
  it('fits 40 mm labels 4 across and 6 down on A4', () => {
    // 210 - 20 = 190 usable; (190 + 3) / 43 = 4.48 -> 4
    // 297 - 20 = 277 usable; (277 + 3) / 43 = 6.51 -> 6
    expect(plan(A4, 40, 40)).toMatchObject({ columns: 4, rows: 6, perPage: 24 })
  })

  it('accounts for the gutter, not just the sticker', () => {
    // Without the gap in the maths this would wrongly report 4 columns.
    expect(plan(A4, 45, 45, 10, 12).columns).toBe(3)
    expect(plan(A4, 45, 45, 10, 0).columns).toBe(4)
  })

  it('does not count a sticker that only fits by overflowing the margin', () => {
    // Exactly 190 mm of usable width: one 190 fits, 191 does not.
    expect(plan(A4, 190, 40).columns).toBe(1)
    expect(plan(A4, 191, 40).columns).toBe(0)
  })

  it('flags a sticker that cannot fit at all', () => {
    expect(plan(A4, 250, 40).impossible).toBe(true)
    expect(plan(A4, 40, 400).impossible).toBe(true)
    expect(plan(A4, 40, 40).impossible).toBe(false)
  })

  it('treats a zero-margin page as fully usable', () => {
    expect(plan(A4, 105, 99, 0, 0)).toMatchObject({ columns: 2, rows: 3, perPage: 6 })
  })

  it('gives Letter its own answer rather than reusing A4', () => {
    // Letter is wider but shorter, so the row count differs.
    expect(plan(LETTER, 40, 40)).toMatchObject({ columns: 4, rows: 6 })
    expect(plan(LETTER, 40, 50).rows).toBe(4)
    expect(plan(A4, 40, 50).rows).toBe(5)
  })

  it('never returns a negative or fractional count', () => {
    for (const preset of STICKER_PRESETS) {
      for (const page of PAGE_SIZES) {
        const result = plan(page, preset.width, preset.height)
        expect(Number.isInteger(result.columns)).toBe(true)
        expect(Number.isInteger(result.rows)).toBe(true)
        expect(result.columns).toBeGreaterThanOrEqual(0)
        expect(result.rows).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('fits every shipped preset on both page sizes', () => {
    for (const preset of STICKER_PRESETS) {
      for (const page of PAGE_SIZES) {
        expect(plan(page, preset.width, preset.height).impossible, `${preset.id}/${page.id}`).toBe(
          false,
        )
      }
    }
  })
})

describe('pagination', () => {
  it('splits into full pages plus a remainder', () => {
    const pages = paginate(Array.from({ length: 60 }, (_, i) => i), 24)
    expect(pages.map((p) => p.length)).toEqual([24, 24, 12])
  })

  it('returns one page when everything fits', () => {
    expect(paginate([1, 2, 3], 24)).toEqual([[1, 2, 3]])
  })

  it('returns nothing for an empty selection', () => {
    expect(paginate([], 24)).toEqual([])
  })

  it('refuses to loop forever on a zero-capacity page', () => {
    expect(paginate([1, 2, 3], 0)).toEqual([])
  })
})

describe('copies', () => {
  it('keeps duplicates adjacent, so they are easy to cut in a block', () => {
    expect(withCopies(['a', 'b'], 3)).toEqual(['a', 'a', 'a', 'b', 'b', 'b'])
  })

  it('treats a nonsensical count as one', () => {
    expect(withCopies(['a'], 0)).toEqual(['a'])
    expect(withCopies(['a'], -5)).toEqual(['a'])
    expect(withCopies(['a'], 1.7)).toEqual(['a'])
  })
})

describe('presets', () => {
  /** Measured from the cartridge shell — not a guess, so it is pinned. */
  it('matches the cartridge label to the shell: 60 × 90 mm, 4 mm corners', () => {
    const label = STICKER_PRESETS.find((p) => p.id === 'cartridge-label')!
    expect([label.width, label.height, label.radius, label.shape]).toEqual([
      60, 90, 4, 'rect',
    ])
  })

  it('opens on the cartridge label, since that is what the hardware needs', () => {
    expect(STICKER_PRESETS[0]!.id).toBe('cartridge-label')
  })

  it('keeps 2:3 presets at true poster proportions, so nothing is cropped', () => {
    for (const id of ['cartridge-label', 'mini-poster']) {
      const preset = STICKER_PRESETS.find((p) => p.id === id)!
      expect(preset.height / preset.width, id).toBeCloseTo(1.5, 5)
    }
  })

  it('matches the tag dot to a 25 mm NTAG215 sticker', () => {
    const dot = STICKER_PRESETS.find((p) => p.id === 'tag-dot')!
    expect([dot.width, dot.height, dot.shape]).toEqual([25, 25, 'round'])
  })

  it('never lets a corner radius exceed half the shorter side', () => {
    for (const preset of STICKER_PRESETS) {
      expect(preset.radius, preset.id).toBeLessThanOrEqual(
        Math.min(preset.width, preset.height) / 2,
      )
      expect(preset.radius, preset.id).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('the cartridge label on real paper', () => {
  it('fits 3 across and 3 down on A4 — 9 per page', () => {
    // 190 usable / 63 pitch -> 3; 277 usable / 93 pitch -> 3
    expect(plan(A4, 60, 90)).toMatchObject({ columns: 3, rows: 3, perPage: 9 })
  })

  it('loses a row on Letter, which is shorter than A4', () => {
    expect(plan(LETTER, 60, 90)).toMatchObject({ columns: 3, rows: 2, perPage: 6 })
  })

  it('gains a row on A4 if the margin is tightened', () => {
    expect(plan(A4, 60, 90, 3, 3).rows).toBe(3)
    expect(plan(A4, 60, 90, 10, 0).rows).toBe(3)
  })
})
