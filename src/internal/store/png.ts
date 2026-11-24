import { crc32, inflateSync } from 'node:zlib'

/** The most a decoded card may expand to: 4096 x 4096 RGBA. A bigger claim is not a share card. */
const MAX_INFLATED = 64 * 1024 * 1024
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const chunkType = (b: Uint8Array, at: number) => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0)

/**
 * True only for a whole PNG: signature, then every chunk within bounds with a matching CRC, starting with
 * IHDR, holding image data (IDAT), and ending with an empty IEND exactly at the last byte. A file cut short by a crash (a rename
 * without fsync) or one with a flipped byte fails; the 8-byte signature alone does not catch either.
 */
export function isCompletePng(b: Uint8Array): boolean {
  if (b.length < SIGNATURE.length + 12 || !SIGNATURE.every((x, i) => b[i] === x)) return false
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let pos = SIGNATURE.length
  let first = true
  let width = 0
  let height = 0
  let bitsPerPixel = 0
  let interlaced = false
  const idat: Uint8Array[] = []
  while (pos + 12 <= b.length) {
    const len = view.getUint32(pos)
    const end = pos + 12 + len
    if (end > b.length) return false
    const type = chunkType(b, pos + 4)
    if (first && (type !== 'IHDR' || len !== 13)) return false
    // CRC covers the type and data bytes, which are contiguous.
    if (crc32(b.subarray(pos + 4, pos + 8 + len)) !== view.getUint32(pos + 8 + len)) return false
    if (first) {
      width = view.getUint32(pos + 8)
      height = view.getUint32(pos + 12)
      const channels = CHANNELS[view.getUint8(pos + 17)]
      if (channels === undefined || width === 0 || height === 0) return false
      bitsPerPixel = channels * view.getUint8(pos + 16)
      interlaced = view.getUint8(pos + 20) === 1
    }
    first = false
    if (type === 'IDAT') idat.push(b.subarray(pos + 8, pos + 8 + len))
    if (type === 'IEND') return len === 0 && end === b.length && decodes(idat, width, height, bitsPerPixel, interlaced)
    pos = end
  }
  return false
}

/** The IDAT payloads, joined, must inflate to the size the header promises (a corrupt or empty stream does not). */
function decodes(idat: Uint8Array[], width: number, height: number, bitsPerPixel: number, interlaced: boolean): boolean {
  if (idat.length === 0) return false
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8) + 1 // + the filter byte
  // Non-interlaced: exactly this. Interlaced (Adam7): each pass adds filter bytes, so only a ceiling.
  const expected = height * rowBytes
  const ceiling = interlaced ? expected * 2 + 64 : expected
  if (ceiling > MAX_INFLATED) return false
  try {
    const out = inflateSync(Buffer.concat(idat), { maxOutputLength: ceiling })
    return interlaced ? out.length > 0 : out.length === expected
  } catch {
    return false
  }
}
