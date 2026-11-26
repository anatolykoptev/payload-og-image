/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a page that advertises a size the cropper does not produce, or a crop that moves.
 * - internal/crop.ts `cropWindow` position arithmetic changed -> "the spec's table of windows" RED
 * - internal/photo.ts `Math.min(PHOTO_SET.capWidth, crop.width)` -> `PHOTO_SET.capWidth` (enlarging) -> "never enlarges" RED
 * - internal/photo.ts the `minWidth` floor dropped -> "a size under the floor does not exist, one at the floor does" RED */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cropWindow, focalOf, uprightSize } from '../../src/internal/crop.js'
import { PHOTO_NAMES, PHOTO_SET, photoFile, photoNameOfFile, photoSizes } from '../../src/internal/photo.js'

const sizes = (w: number, h: number, focal: { focalX?: number; focalY?: number } = {}) =>
  Object.fromEntries(photoSizes({ width: w, height: h }, focal).map((s) => [s.name, s]))

describe('the photo set spec', () => {
  it("the spec's table of windows (focal point at the centre unless said)", () => {
    // 4000x3000
    let s = sizes(4000, 3000)
    expect(s['16x9']).toMatchObject({ width: 1200, height: 675, crop: { left: 0, top: 375, width: 4000, height: 2250 } })
    expect(s['4x3']).toMatchObject({ width: 1200, height: 900, crop: { left: 0, top: 0, width: 4000, height: 3000 } })
    expect(s['1x1']).toMatchObject({ width: 1200, height: 1200, crop: { left: 500, top: 0, width: 3000, height: 3000 } })
    // 1280x960
    s = sizes(1280, 960)
    expect(s['16x9']).toMatchObject({ width: 1200, height: 675, crop: { left: 0, top: 120, width: 1280, height: 720 } })
    expect(s['4x3']).toMatchObject({ width: 1200, height: 900 })
    expect(s['1x1']).toMatchObject({ width: 960, height: 960, crop: { left: 160, top: 0 } })
    // 900x600: smaller than the cap, so smaller crops and nothing scaled
    s = sizes(900, 600)
    expect(s['16x9']).toMatchObject({ width: 900, height: 506, crop: { top: 47 } })
    expect(s['4x3']).toMatchObject({ width: 800, height: 600, crop: { left: 50 } })
    expect(s['1x1']).toMatchObject({ width: 600, height: 600, crop: { left: 150 } })
    // 680x470: halves go up (382.5 -> 383), and 470 is under the floor for a square
    s = sizes(680, 470)
    expect(s['16x9']).toMatchObject({ width: 680, height: 383, crop: { top: 44 } })
    expect(s['4x3']).toMatchObject({ width: 627, height: 470, crop: { left: 27 } })
    expect(s['1x1']).toBeUndefined()
    // 500x400: nothing reaches 600
    expect(photoSizes({ width: 500, height: 400 }, {})).toEqual([])
    // a portrait phone photo, focal point 50/30: a band around the point, never a letterbox
    s = sizes(1080, 1920, { focalX: 50, focalY: 30 })
    expect(s['16x9']).toMatchObject({ width: 1080, height: 608, crop: { top: 272 } })
    expect(s['4x3']).toMatchObject({ width: 1080, height: 810, crop: { top: 171 } })
    expect(s['1x1']).toMatchObject({ width: 1080, height: 1080, crop: { top: 36 } })
  })

  it('never enlarges: no size is wider than the source or the cap, and none is scaled up', () => {
    for (const [w, h] of [
      [900, 600],
      [1199, 800],
      [1200, 800],
      [4000, 3000],
      [700, 2000],
      [2000, 700],
    ] as const)
      for (const s of photoSizes({ width: w, height: h }, {})) {
        expect(s.width).toBeLessThanOrEqual(Math.min(PHOTO_SET.capWidth, w))
        expect(s.crop.width).toBeLessThanOrEqual(w)
        expect(s.crop.height).toBeLessThanOrEqual(h)
        expect(s.width).toBeLessThanOrEqual(s.crop.width) // the output is never wider than the window it is cut from
      }
    expect(sizes(900, 600)['16x9']?.width).toBe(900)
  })

  it('a size under the floor does not exist, one at the floor does', () => {
    expect(sizes(599, 599)).toEqual({})
    expect(sizes(600, 600)['1x1']).toMatchObject({ width: 600, height: 600 })
    expect(sizes(600, 450)['4x3']).toMatchObject({ width: 600, height: 450 })
    expect(sizes(600, 338)['16x9']).toMatchObject({ width: 600, height: 338 })
  })

  it('16:9 exists whenever any size does, in page order', () => {
    for (const [w, h] of [
      [600, 600],
      [700, 470],
      [3000, 700],
      [610, 4000],
    ] as const) {
      const names = photoSizes({ width: w, height: h }, {}).map((s) => s.name)
      if (names.length > 0) expect(names[0]).toBe('16x9')
      expect(names).toEqual(PHOTO_NAMES.filter((n) => names.includes(n)))
    }
  })

  it('the file names are one list', () => {
    for (const n of PHOTO_NAMES) expect(photoNameOfFile(photoFile(n))).toBe(n)
    expect(photoNameOfFile('card.jpg')).toBeUndefined()
    expect(photoNameOfFile('photo-2x1.jpg')).toBeUndefined()
  })

  it('the focal point and the upright size', () => {
    expect(focalOf({})).toEqual([50, 50])
    expect(focalOf({ focalX: 120, focalY: -5 })).toEqual([100, 0])
    expect(focalOf({ focalX: Number.NaN, focalY: 'x' as never })).toEqual([50, 50])
    expect(uprightSize({ width: 400, height: 300, orientation: 6 })).toEqual({ width: 300, height: 400 })
    expect(uprightSize({ width: 400, height: 300 })).toEqual({ width: 400, height: 300 })
    expect(uprightSize({ width: 0, height: 300 })).toBeNull()
    expect(cropWindow({ width: 10, height: 10 }, 1e-9, {})).toBeNull()
  })

  it('the documentation states the same sizes the spec produces', () => {
    const docs = readFileSync(new URL('../../docs/reference.md', import.meta.url), 'utf8')
    for (const s of photoSizes({ width: 4000, height: 3000 }, {})) {
      expect(docs).toContain(`${s.width}×${s.height}`)
      expect(docs).toContain(photoFile(s.name))
    }
    expect(docs).toContain(`${PHOTO_SET.minWidth} px`)
    // the worked example of a small source
    expect(photoSizes({ width: 900, height: 600 }, {}).map((s) => `${s.width}×${s.height}`)).toEqual(['900×506', '800×600', '600×600'])
    expect(docs).toContain('900×506, 800×600 and 600×600')
  })
})
