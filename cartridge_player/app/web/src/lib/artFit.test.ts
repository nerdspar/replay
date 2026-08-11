import { describe, expect, it } from 'vitest'
import { dominantColor, lightAccent, objectFitFor } from './artFit'

/** Builds RGBA pixel data from a list of [r, g, b, count] runs. */
function pixels(...runs: [number, number, number, number][]): Uint8ClampedArray {
  const total = runs.reduce((n, run) => n + run[3], 0)
  const data = new Uint8ClampedArray(total * 4)
  let i = 0
  for (const [r, g, b, count] of runs) {
    for (let n = 0; n < count; n += 1) {
      data[i++] = r
      data[i++] = g
      data[i++] = b
      data[i++] = 255
    }
  }
  return data
}

describe('objectFitFor', () => {
  it('fills the sticker only when cropping', () => {
    expect(objectFitFor('crop')).toBe('cover')
    expect(objectFitFor('blur')).toBe('contain')
    expect(objectFitFor('color')).toBe('contain')
  })
})

describe('dominantColor', () => {
  it('picks the colour a cover actually reads as', () => {
    expect(dominantColor(pixels([200, 30, 40, 90], [10, 10, 10, 10]))).toBe('#c81e28')
  })

  it('never returns a colour that is not in the image', () => {
    // Averaging red and black gives a muddy maroon that appears nowhere. The
    // border would then match no part of the cover it sits beside.
    const result = dominantColor(pixels([255, 0, 0, 50], [0, 0, 0, 50]))
    expect(['#ff0000', '#000000']).toContain(result)
  })

  it('prefers a saturated colour over a marginally more common dead one', () => {
    // Very common on real covers: a black border around colourful art. Black
    // is technically dominant and makes a lifeless sticker edge.
    expect(dominantColor(pixels([0, 0, 0, 55], [220, 60, 20, 45]))).toBe('#dc3c14')
  })

  it('still returns the dead colour when it genuinely dominates', () => {
    // A mostly-black cover should get a black border, not a red one sampled
    // from a small detail.
    expect(dominantColor(pixels([0, 0, 0, 95], [220, 60, 20, 5]))).toBe('#000000')
  })

  it('groups near-identical shades rather than splitting them', () => {
    // Gradients and JPEG noise mean no exact colour repeats. Without
    // quantisation every bucket holds one pixel and the result is arbitrary.
    const gradient: [number, number, number, number][] = []
    for (let n = 0; n < 12; n += 1) gradient.push([192 + n, 30, 40, 1])
    // Ungrouped, each red shade is a bucket of one and this green wins on
    // count alone. Grouped, the reds are plainly the dominant colour.
    gradient.push([10, 200, 10, 8])

    expect(dominantColor(pixels(...gradient))).toMatch(/^#c[0-9a-f]/)
  })

  it('ignores transparent padding, which is not part of the artwork', () => {
    const data = new Uint8ClampedArray(8)
    // One opaque red pixel, one fully transparent green one.
    data.set([255, 0, 0, 255], 0)
    data.set([0, 255, 0, 0], 4)

    expect(dominantColor(data)).toBe('#ff0000')
  })

  it('falls back to white rather than throwing on an empty image', () => {
    expect(dominantColor(new Uint8ClampedArray(0))).toBe('#ffffff')
  })
})

/**
 * A different question from dominantColor, which is why it is a different
 * function. The sticker wants the cover's tone; the LED wants a colour that
 * will actually be visible as light.
 */
describe('lightAccent', () => {
  it('finds the vivid element in a mostly-dark cover', () => {
    // Most film posters. dominantColor correctly returns the near-black here,
    // which as a light is indistinguishable from switched off.
    const result = lightAccent(pixels([16, 16, 18, 3072], [20, 184, 166, 1024]))
    expect(result).not.toBeNull()
    expect(result).toMatch(/^#[0-9a-f]{6}$/)
    // Teal: green and blue high, red low.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(result!.slice(i, i + 2), 16))
    expect(g).toBeGreaterThan(200)
    expect(b).toBeGreaterThan(150)
    expect(r).toBeLessThan(80)
  })

  it('scales the answer to full value, so hue is all the artwork contributes', () => {
    // The same hue sampled dark and bright must light the reader identically —
    // how bright it gets is the palette's decision.
    const dim = lightAccent(pixels([0, 128, 64, 100]))
    const bright = lightAccent(pixels([0, 255, 128, 100]))
    expect(dim).toBe(bright)
  })

  it('returns null for a cover with no colour to offer', () => {
    // Black and white artwork. Better to say so and let the caller use its
    // fixed colour than to hand back a muddy grey.
    expect(lightAccent(pixels([20, 20, 20, 500], [230, 230, 230, 500]))).toBeNull()
  })

  it('ignores a colour too dark to register, however common', () => {
    expect(lightAccent(pixels([12, 0, 30, 4000], [255, 60, 0, 96]))).toMatch(/^#ff/)
  })
})
