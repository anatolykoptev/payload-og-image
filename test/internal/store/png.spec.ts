/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a torn PNG served as immutable.
 * - png.ts:24     drop the CRC comparison                          -> "rejects a flipped byte inside a chunk (CRC)" RED
 * - png.ts:19  drop the `end > b.length` bounds check            -> "rejects a chunk length pointing past the end (a later chunk)" RED
 * - png.ts:25     drop `end === b.length` (accept trailing bytes)   -> "rejects trailing bytes after IEND" RED
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { isCompletePng } from '../../../src/internal/store/png.js'

const real = async () =>
  new Uint8Array(
    await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c33' } })
      .png()
      .toBuffer(),
  )

describe('isCompletePng', () => {
  it('accepts a real PNG', async () => expect(isCompletePng(await real())).toBe(true))
  it('rejects one truncated at 50% (signature intact)', async () => {
    const b = await real()
    expect(isCompletePng(b.subarray(0, Math.floor(b.length / 2)))).toBe(false)
  })
  it('rejects one whose last 8 bytes are wrong (IEND type + CRC)', async () => {
    const b = Uint8Array.from(await real())
    b.fill(0, b.length - 8)
    expect(isCompletePng(b)).toBe(false)
  })
  it('rejects a flipped byte inside a chunk (CRC)', async () => {
    const b = Uint8Array.from(await real())
    b[40] = (b[40] ?? 0) ^ 0xff
    expect(isCompletePng(b)).toBe(false)
  })
  it.each([
    ['the first chunk', 8],
    ['a later chunk', 33], // 8 signature + 25 IHDR
  ])('rejects a chunk length pointing past the end (%s)', async (_, at) => {
    const b = Uint8Array.from(await real())
    b.set([0x7f, 0xff, 0xff, 0xff], at)
    expect(isCompletePng(b)).toBe(false)
  })
  it('rejects trailing bytes after IEND', async () => {
    const b = await real()
    const longer = new Uint8Array(b.length + 4)
    longer.set(b)
    expect(isCompletePng(longer)).toBe(false)
  })
  it('rejects empty input and a bare signature', () => {
    expect(isCompletePng(new Uint8Array())).toBe(false)
    expect(isCompletePng(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(false)
  })
  it('works on a view into a larger buffer (a Node Buffer slice)', async () => {
    const b = await real()
    const pad = new Uint8Array(b.length + 16)
    pad.set(b, 8)
    expect(isCompletePng(pad.subarray(8, 8 + b.length))).toBe(true)
  })
})
