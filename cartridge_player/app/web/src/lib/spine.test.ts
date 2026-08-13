import { describe, expect, it } from 'vitest'
import {
  SPINE_HEIGHT_MM,
  fitSpineText,
  parseHex,
  readableTextColor,
  spineText,
} from './spine'
import type { Card } from '../types'

/**
 * A stand-in for real text measurement: every glyph is 0.5 of the font size
 * wide. Crude, but the fitting logic only ever asks "does this fit", and a
 * predictable width makes the boundaries checkable by hand.
 */
const measure = (text: string, size: number) => text.length * size * 0.5

const card = (over: Partial<Card> = {}): Card =>
  ({ id: 1, title: 'Kind of Blue', spine_text: null, ...over }) as Card

describe('what a spine says', () => {
  it('uses the title when nothing has been written for it', () => {
    expect(spineText(card())).toBe('Kind of Blue')
  })

  it('prefers an override', () => {
    expect(spineText(card({ spine_text: 'Miles' }))).toBe('Miles')
  })

  it('treats whitespace as no override, not as a blank spine', () => {
    // Clearing the field leaves '' or ' ', and a spine printed blank looks
    // like a bug rather than a choice.
    expect(spineText(card({ spine_text: '   ' }))).toBe('Kind of Blue')
    expect(spineText(card({ spine_text: '' }))).toBe('Kind of Blue')
  })
})

describe('fitting text to 60 x 7 mm', () => {
  const fit = (text: string) => fitSpineText(text, 60, SPINE_HEIGHT_MM, measure)

  it('keeps a short title at the largest size', () => {
    const result = fit('Kind of Blue')

    expect(result.truncated).toBe(false)
    expect(result.text).toBe('Kind of Blue')
    expect(result.size).toBeCloseTo(7 * 0.62, 5)
  })

  it('shrinks rather than truncating when shrinking is enough', () => {
    const result = fit('The Dark Side of the Moon Deluxe')

    expect(result.truncated).toBe(false)
    expect(result.text).toBe('The Dark Side of the Moon Deluxe')
    expect(result.size).toBeLessThan(7 * 0.62)
  })

  it('truncates once shrinking stops helping', () => {
    const result = fit('The Lord of the Rings: The Fellowship of the Ring')

    expect(result.truncated).toBe(true)
    expect(result.text.endsWith('…')).toBe(true)
    // The point of the floor: it stops shrinking rather than going smaller.
    expect(result.size).toBeCloseTo(7 * 0.4, 5)
  })

  it('never returns something wider than the spine', () => {
    const room = 60 - SPINE_HEIGHT_MM * 0.45 * 2
    for (const title of [
      'A',
      'Kind of Blue',
      'The Lord of the Rings: The Fellowship of the Ring',
      'x'.repeat(400),
    ]) {
      const result = fit(title)
      expect(measure(result.text, result.size)).toBeLessThanOrEqual(room)
    }
  })

  it('does not leave a space stranded before the ellipsis', () => {
    const result = fitSpineText('Aaaa bbbbbbbbbbbbbbbb', 20, SPINE_HEIGHT_MM, measure)
    expect(result.text).not.toContain(' …')
  })

  it('survives a spine too narrow for any text at all', () => {
    const result = fitSpineText('Kind of Blue', 4, SPINE_HEIGHT_MM, measure)
    expect(result.text).toBe('…')
    expect(result.truncated).toBe(true)
  })
})

describe('choosing a readable text colour', () => {
  it('puts black on light backgrounds and white on dark ones', () => {
    expect(readableTextColor('#ffffff')).toBe('#000000')
    expect(readableTextColor('#f5e6c8')).toBe('#000000')
    expect(readableTextColor('#000000')).toBe('#ffffff')
    expect(readableTextColor('#1a1a2e')).toBe('#ffffff')
  })

  it('judges by luminance, not by brightness', () => {
    // Both are full-intensity, and the eye is far more sensitive to green.
    // A naive average would give these two the same answer.
    expect(readableTextColor('#00ff00')).toBe('#000000')
    expect(readableTextColor('#0000ff')).toBe('#ffffff')
  })

  it('falls back to black rather than throwing on a colour it cannot read', () => {
    expect(readableTextColor('rgb(1,2,3)')).toBe('#000000')
  })
})

describe('reading a hex colour', () => {
  it('accepts it with or without the hash, in either case', () => {
    expect(parseHex('#3366CC')).toEqual([0x33, 0x66, 0xcc])
    expect(parseHex('3366cc')).toEqual([0x33, 0x66, 0xcc])
  })

  it('rejects anything else', () => {
    expect(parseHex('#fff')).toBeNull()
    expect(parseHex('nope')).toBeNull()
  })
})
