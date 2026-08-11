import { describe, expect, it } from 'vitest'
import { EXPORT_DPI, mmToPx, sourceRect, stickerFileName } from './exportSticker'
import type { Card } from '../types'

const card = (overrides: Partial<Card> = {}): Card =>
  ({
    id: 1,
    status: 'assigned',
    tag_uid: '04-A3',
    provider: 'stremio',
    content_type: 'movie',
    external_id: 'tt1',
    title: 'Lady and the Tramp',
    year: '1955',
    poster_url: null,
    original_poster_url: null,
    season: null,
    episode: null,
    label: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }) as Card

describe('physical size', () => {
  it('renders a 60 x 90 mm sticker at 300 dpi', () => {
    // 60 mm = 2.362 in -> 709 px; 90 mm = 3.543 in -> 1063 px
    expect(mmToPx(60)).toBe(709)
    expect(mmToPx(90)).toBe(1063)
    expect(EXPORT_DPI).toBe(300)
  })

  it('scales with dpi', () => {
    expect(mmToPx(25.4, 300)).toBe(300)
    expect(mmToPx(25.4, 96)).toBe(96)
  })
})

describe('fitting artwork to the sticker', () => {
  const poster = { w: 500, h: 750 } // 2:3, as posters are

  it('fills a 2:3 sticker with no visible crop', () => {
    const r = sourceRect(poster.w, poster.h, 709, 1063, 'cover')

    // Covers the whole sticker...
    expect(r.dw).toBeGreaterThanOrEqual(709)
    expect(r.dh).toBeGreaterThanOrEqual(1063)

    // ...and by at most a pixel, because 60 x 90 mm rounds to 709 x 1063 px,
    // which is not exactly 2:3. Nothing of the poster is meaningfully lost.
    expect(r.dw - 709).toBeLessThanOrEqual(1)
    expect(r.dh - 1063).toBeLessThanOrEqual(1)
  })

  it('overflows and centres when the shapes differ, under cover', () => {
    const r = sourceRect(poster.w, poster.h, 709, 709, 'cover')
    expect(r.dh).toBeGreaterThan(709)
    // Equal overflow top and bottom.
    expect(Math.round(r.dy)).toBe(Math.round(709 - r.dh - r.dy))
  })

  it('leaves centred margin instead of cropping, under contain', () => {
    const r = sourceRect(poster.w, poster.h, 709, 709, 'contain')
    expect(r.dh).toBeLessThanOrEqual(709)
    expect(r.dw).toBeLessThanOrEqual(709)
    expect(Math.round(r.dx)).toBe(Math.round(709 - r.dw - r.dx))
  })

  it('handles a landscape source, which backgrounds and logos are', () => {
    const r = sourceRect(1920, 1080, 709, 1063, 'cover')
    expect(r.dw).toBeGreaterThanOrEqual(709)
    expect(r.dh).toBeGreaterThanOrEqual(1063)
  })
})

describe('filenames', () => {
  it('is readable in the Design Space upload list', () => {
    expect(stickerFileName(card(), 60, 90)).toBe('lady-and-the-tramp-60x90mm.png')
  })

  it('survives punctuation and non-latin titles', () => {
    expect(stickerFileName(card({ title: 'WALL·E' }), 60, 90)).toBe('wall-e-60x90mm.png')
    expect(stickerFileName(card({ title: '???' }), 60, 90)).toBe('cartridge-60x90mm.png')
  })
})
