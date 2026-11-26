/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a JPEG/WebP card with a black hole where the card was see-through, or one in the wrong encoding.
 * - encode.ts `.flatten({ background: ground })` removed -> "a see-through card is flattened onto its ground" RED
 * - encode.ts `quality` not passed on -> "quality changes the bytes" RED
 * - nextOg.ts `encoding.format !== 'png' ? encodeLossy` -> always `encodePng` -> "draws the format asked for" RED
 * - encode.ts `chromaSubsampling` not passed on to `.jpeg()` (or nextOg/resolve dropping it) -> "a 4:4:4 JPEG card decodes as 4:4:4" RED
 * - format.ts `variantOf` without the `:c444` tail -> resolve.spec "4:4:4 changes the card version" RED
 * - nextOg.ts `isWholeCard(out, format)` -> `isCompletePng(out)` -> "draws the format asked for" RED */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { nextOgRenderer } from '../../src/render/nextOg.js'
import { loadTestFonts } from '../helpers.js'

/** A card with a painted left half and nothing on the right: its right half is see-through in the renderer's PNG. */
const half = {
  type: 'div',
  props: {
    style: { display: 'flex', width: 600, height: 315 },
    children: { type: 'div', props: { style: { display: 'flex', width: 300, height: 315, background: '#ff0000' } } },
  },
} as never
/** Diagonal colour stripes: enough detail for the quality to show. */
const busy = {
  type: 'div',
  props: {
    style: {
      display: 'flex',
      width: 600,
      height: 315,
      background: 'repeating-linear-gradient(35deg, #e63946 0px, #1d3557 7px, #a8dadc 13px, #f1faee 19px, #457b9d 31px)',
    },
  },
} as never
type Encoding = Parameters<ReturnType<typeof nextOgRenderer>['render']>[1]['encoding']
const draw = async (encoding?: Encoding, el = half) => {
  const { fonts } = await loadTestFonts()
  return nextOgRenderer().render(el, { width: 600, height: 315, fonts, encoding })
}
const pixel = async (b: Uint8Array, x: number, y: number) => {
  const { data, info } = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return [data[i], data[i + 1], data[i + 2]] as number[]
}
const near = (got: number[], want: number[]) => got.every((c, i) => Math.abs(c - (want[i] as number)) <= 6)

describe.each(['jpeg', 'webp'] as const)('the real renderer, %s', (format) => {
  it('draws the format asked for, at the card size', async () => {
    const out = await draw({ format, quality: 80, ground: '#ffffff' })
    const m = await sharp(out).metadata()
    expect([m.format, m.width, m.height, m.hasAlpha]).toEqual([format, 600, 315, false])
  })
  it('a see-through card is flattened onto its ground, not onto black', async () => {
    const white = await draw({ format, quality: 90, ground: '#ffffff' })
    const navy = await draw({ format, quality: 90, ground: '#102030' })
    expect(near(await pixel(white, 450, 150), [255, 255, 255])).toBe(true)
    expect(near(await pixel(navy, 450, 150), [0x10, 0x20, 0x30])).toBe(true)
    expect(near(await pixel(white, 100, 150), [255, 0, 0])).toBe(true) // the painted half is untouched
  })
  it('quality changes the bytes', async () => {
    const [lo, hi] = [
      await draw({ format, quality: 20, ground: '#ffffff' }, busy),
      await draw({ format, quality: 95, ground: '#ffffff' }, busy),
    ]
    expect(lo.byteLength).toBeLessThan(hi.byteLength)
  })
})

describe('the real renderer, JPEG chroma subsampling', () => {
  const subsampling = async (b: Uint8Array) => (await sharp(b).metadata()).chromaSubsampling
  const jpeg = { format: 'jpeg', quality: 86, ground: '#ffffff' } as const
  it('a 4:4:4 JPEG card decodes as 4:4:4 (mozjpeg on), the default as 4:2:0', async () => {
    expect(await subsampling(await draw({ ...jpeg, chromaSubsampling: '4:4:4' }, busy))).toBe('4:4:4')
    expect(await subsampling(await draw(jpeg, busy))).toBe('4:2:0')
    expect(await subsampling(await draw({ ...jpeg, chromaSubsampling: '4:2:0' }, busy))).toBe('4:2:0')
  })
  it('keeps the colour resolution: a one-pixel red line on a blue ground is redder at 4:4:4', async () => {
    const line = {
      type: 'div',
      props: {
        style: { display: 'flex', width: 600, height: 315, background: '#0000ff' },
        children: { type: 'div', props: { style: { display: 'flex', width: 1, height: 315, marginLeft: 300, background: '#ff0000' } } },
      },
    } as never
    const [full, sub] = [await draw({ ...jpeg, chromaSubsampling: '4:4:4' }, line), await draw(jpeg, line)]
    expect((await pixel(full, 300, 150))[0] as number).toBeGreaterThan((await pixel(sub, 300, 150))[0] as number)
  })
})

describe('the real renderer, PNG', () => {
  it('without an encoding, and with `{ format: png }`, draws the same bytes: PNG is untouched', async () => {
    const [a, b] = [await draw(), await draw({ format: 'png' })]
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    expect((await sharp(a).metadata()).format).toBe('png')
  })
})
