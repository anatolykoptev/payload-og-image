/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a torn PNG served as immutable.
 * - png.ts:32  drop the CRC comparison -> "rejects a flipped byte inside a chunk (CRC)" RED
 * - png.ts:28  drop the bounds check -> "rejects a chunk length pointing past the end (a later chunk)" RED
 * - png.ts:43  drop `end === b.length` -> "rejects trailing bytes after IEND" RED; skip decodes() -> "rejects valid CRCs around a corrupt zlib stream" / "an empty IDAT" / "inflates to the wrong size" RED
 * - png.ts:56  drop the decode cap -> "rejects a header that claims more pixels than any card could have" RED
 * - png.ts:59  accept any inflated length -> "rejects a valid zlib stream that inflates to the wrong size" RED */
import { crc32, deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { isCompletePng } from '../../../src/internal/store/png.js'

const real = async () =>
  new Uint8Array(
    await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c33' } })
      .png()
      .toBuffer(),
  )

/** The PNG with its IDAT chunks replaced by one holding `payload`, every CRC valid. */
const withIdat = (png: Uint8Array, payload: Uint8Array, ihdr?: Uint8Array) => {
  const out: number[] = [...png.subarray(0, 8)]
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length)
    body.set([...type].map((c) => c.charCodeAt(0)))
    body.set(data, 4)
    const len = new Uint8Array(4)
    new DataView(len.buffer).setUint32(0, data.length)
    const crc = new Uint8Array(4)
    new DataView(crc.buffer).setUint32(0, crc32(body))
    out.push(...len, ...body, ...crc)
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let pos = 8
  let placed = false
  while (pos < png.length) {
    const len = view.getUint32(pos)
    const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8))
    const data = png.subarray(pos + 8, pos + 8 + len)
    if (type === 'IDAT') {
      if (!placed) chunk('IDAT', payload)
      placed = true
    } else chunk(type, type === 'IHDR' && ihdr ? ihdr : data)
    pos += 12 + len
  }
  return new Uint8Array(out)
}

describe('isCompletePng', () => {
  it('accepts the same PNG rebuilt chunk by chunk (the helper is sound)', async () => {
    const b = await real()
    const rows = 200 * (1 + 300 * 3)
    expect(isCompletePng(withIdat(b, deflateSync(Buffer.alloc(rows))))).toBe(true)
  })
  it('rejects valid CRCs around a corrupt zlib stream', async () => {
    expect(isCompletePng(withIdat(await real(), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])))).toBe(false)
  })
  it('rejects an empty IDAT', async () => expect(isCompletePng(withIdat(await real(), new Uint8Array()))).toBe(false))
  it('rejects a valid zlib stream that inflates to the wrong size', async () => {
    expect(isCompletePng(withIdat(await real(), deflateSync(Buffer.alloc(10))))).toBe(false)
  })
  it('rejects a stream that inflates past what the header promises (a bomb)', async () => {
    expect(isCompletePng(withIdat(await real(), deflateSync(Buffer.alloc(50 * 1024 * 1024))))).toBe(false)
  })
  it('rejects a header that claims more pixels than any card could have, even with a matching stream', async () => {
    // 10000 x 10000, 8-bit grey: 100 MB inflated, a perfectly consistent PNG, but past the decode cap.
    const ihdr = new Uint8Array(13)
    const dv = new DataView(ihdr.buffer)
    dv.setUint32(0, 10000)
    dv.setUint32(4, 10000)
    ihdr.set([8, 0, 0, 0, 0], 8)
    expect(isCompletePng(withIdat(await real(), deflateSync(Buffer.alloc(10000 * 10001)), ihdr))).toBe(false)
  })
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
  it('rejects a file with IHDR and IEND but no image data', async () => {
    const b = await real()
    const noData = new Uint8Array([...b.subarray(0, 33), ...b.subarray(b.length - 12)]) // signature + IHDR, then IEND
    expect(isCompletePng(noData)).toBe(false)
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
