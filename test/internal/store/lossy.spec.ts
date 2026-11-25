/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a torn or foreign JPEG/WebP served as an immutable card.
 * - jpeg.ts `b[b.length - 1] !== EOI` dropped -> "a JPEG cut short, or with a zeroed tail, is not whole" RED
 * - jpeg.ts `pos + 2 === b.length` dropped -> "bytes after EOI" RED
 * - jpeg.ts `!dht` / `!dqt` checks dropped -> "no Huffman table" / "no quantisation table" RED
 * - jpeg.ts `HUFFMAN_DCT` check dropped -> "an arithmetic-coded frame is refused" RED
 * - webp.ts `riff + 8 !== b.length` dropped -> "a WebP cut short" / "a WebP with trailing bytes" RED
 * - webp.ts start-code check dropped -> "a VP8 frame without its start code" RED
 * - validate.ts decode dropped (structure only) -> "a structurally whole JPEG whose scan is truncated does not decode", "... WebP ..." RED
 * - validate.ts format ignored (always PNG) -> "isWholeCard validates the format it is told" RED */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { isCompleteJpeg } from '../../../src/internal/store/jpeg.js'
import { decodesImage, isWholeCard } from '../../../src/internal/store/validate.js'
import { isCompleteWebp } from '../../../src/internal/store/webp.js'

/** A noisy 300x200 image: its scan data is long enough to cut or damage in the middle. */
const noise = () => {
  const raw = Buffer.alloc(300 * 200 * 3)
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24
  return sharp(raw, { raw: { width: 300, height: 200, channels: 3 } })
}
const jpeg = async () => new Uint8Array(await noise().jpeg({ mozjpeg: true, quality: 80 }).toBuffer())
const webp = async () => new Uint8Array(await noise().webp({ quality: 80 }).toBuffer())
const png = async () => new Uint8Array(await noise().png().toBuffer())
const cat = (...p: Uint8Array[]) => Uint8Array.from(p.flatMap((x) => [...x]))
/** Rewrites the RIFF size so the container stays self-consistent after a cut. */
const riffFixed = (b: Uint8Array) => {
  const out = new Uint8Array(b)
  new DataView(out.buffer).setUint32(4, out.length - 8, true)
  return out
}

describe('isCompleteJpeg', () => {
  it('accepts what mozjpeg and libjpeg write', async () => {
    expect(isCompleteJpeg(await jpeg())).toBe(true)
    expect(isCompleteJpeg(new Uint8Array(await noise().jpeg().toBuffer()))).toBe(true)
  })
  it('a JPEG cut short, or with a zeroed tail, is not whole', async () => {
    const b = await jpeg()
    expect(isCompleteJpeg(b.subarray(0, b.length - 1))).toBe(false)
    expect(isCompleteJpeg(b.subarray(0, b.length >> 1))).toBe(false)
    expect(isCompleteJpeg(cat(b.subarray(0, b.length >> 1), new Uint8Array(b.length >> 1)))).toBe(false)
  })
  it('bytes after EOI, an empty file, a lone SOI and a PNG are not a JPEG', async () => {
    expect(isCompleteJpeg(cat(await jpeg(), new Uint8Array([0])))).toBe(false)
    expect(isCompleteJpeg(new Uint8Array())).toBe(false)
    expect(isCompleteJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(false)
    expect(isCompleteJpeg(await png())).toBe(false)
  })
  it('a frame with no scan, no Huffman table or no quantisation table is refused', async () => {
    const b = await jpeg()
    // Turn each DHT / DQT marker into an APPn (same length field, so the walk stays aligned): the tables are gone.
    const rename = (from: number, to: number) => {
      const out = new Uint8Array(b)
      for (let i = 0; i + 1 < out.length; i++) if (out[i] === 0xff && out[i + 1] === from) out[i + 1] = to
      return out
    }
    expect(isCompleteJpeg(rename(0xc4, 0xe5))).toBe(false)
    expect(isCompleteJpeg(rename(0xdb, 0xe5))).toBe(false)
  })
  it('an arithmetic-coded frame is refused', async () => {
    const out = new Uint8Array(await jpeg())
    for (let i = 0; i + 1 < out.length; i++) if (out[i] === 0xff && (out[i + 1] === 0xc0 || out[i + 1] === 0xc2)) out[i + 1] = 0xc9
    expect(isCompleteJpeg(out)).toBe(false)
  })
})

describe('isCompleteWebp', () => {
  it('accepts what libwebp writes', async () => expect(isCompleteWebp(await webp())).toBe(true))
  it('a WebP cut short is not whole, even with a consistent RIFF size', async () => {
    const b = await webp()
    expect(isCompleteWebp(b.subarray(0, b.length - 4))).toBe(false)
    expect(isCompleteWebp(riffFixed(b.subarray(0, b.length >> 1)))).toBe(false) // the chunk then claims more than is there
  })
  it('a WebP with trailing bytes, a wrong RIFF size, no WEBP form or a PNG is not a WebP', async () => {
    const b = await webp()
    expect(isCompleteWebp(cat(b, new Uint8Array([0, 0])))).toBe(false)
    expect(isCompleteWebp(riffFixed(cat(b, new Uint8Array([0, 0]))))).toBe(false) // consistent size, but the last chunk's end no longer meets it
    const form = new Uint8Array(b)
    form.set([0x41, 0x56, 0x49, 0x20], 8)
    expect(isCompleteWebp(form)).toBe(false)
    expect(isCompleteWebp(await png())).toBe(false)
  })
  it('a VP8 frame without its start code is refused', async () => {
    const b = await webp()
    const at = Buffer.from(b).indexOf('VP8 ')
    expect(at).toBeGreaterThan(0)
    const out = new Uint8Array(b)
    out[at + 8 + 3] = 0 // the first byte of 9d 01 2a
    expect(isCompleteWebp(out)).toBe(false)
  })
})

describe('decodesImage / isWholeCard', () => {
  it('a structurally whole JPEG whose scan is truncated does not decode', async () => {
    const b = await jpeg()
    const torn = cat(b.subarray(0, b.length >> 1), new Uint8Array([0xff, 0xd9])) // a valid EOI after half the scan
    expect(isCompleteJpeg(torn)).toBe(true) // the structure walk cannot see it
    expect(await decodesImage(torn)).toBe(false)
    expect(await isWholeCard(torn, 'jpeg')).toBe(false)
  })
  it('a structurally whole WebP whose bitstream is cut does not decode', async () => {
    const b = await webp()
    const at = Buffer.from(b).indexOf('VP8 ')
    const cut = b.subarray(0, 8 + 4 + 8 + 40 + at - 12) // keep the headers, drop most of the partition
    const torn = new Uint8Array(cut)
    new DataView(torn.buffer).setUint32(4, torn.length - 8, true)
    new DataView(torn.buffer).setUint32(at + 4, torn.length - at - 8, true)
    expect(await isWholeCard(torn, 'webp')).toBe(false)
  })
  it('isWholeCard validates the format it is told', async () => {
    const [p, j, w] = [await png(), await jpeg(), await webp()]
    expect([await isWholeCard(p, 'png'), await isWholeCard(j, 'jpeg'), await isWholeCard(w, 'webp')]).toEqual([true, true, true])
    expect([await isWholeCard(j, 'png'), await isWholeCard(p, 'jpeg'), await isWholeCard(j, 'webp'), await isWholeCard(w, 'jpeg')]).toEqual(
      [false, false, false, false],
    )
  })
  it('bytes the renderer already validated are not decoded again (checked by identity)', async () => {
    const b = await jpeg()
    expect(await isWholeCard(b, 'jpeg')).toBe(true)
    const damaged = b.subarray(0, 10).slice() // a different buffer is checked afresh
    expect(await isWholeCard(damaged, 'jpeg')).toBe(false)
    b.fill(0) // the same buffer, now garbage: the identity record is what answers
    expect(await isWholeCard(b, 'jpeg')).toBe(true)
  })
})
