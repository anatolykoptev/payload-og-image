import { crc32 } from 'node:zlib'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const chunkType = (b: Uint8Array, at: number) => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0)

/**
 * True only for a whole PNG: signature, then every chunk within bounds with a matching CRC, starting with
 * IHDR and ending with an empty IEND exactly at the last byte. A file cut short by a crash (a rename
 * without fsync) or one with a flipped byte fails; the 8-byte signature alone does not catch either.
 */
export function isCompletePng(b: Uint8Array): boolean {
  if (b.length < SIGNATURE.length + 12 || !SIGNATURE.every((x, i) => b[i] === x)) return false
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let pos = SIGNATURE.length
  let first = true
  while (pos + 12 <= b.length) {
    const len = view.getUint32(pos)
    const end = pos + 12 + len
    if (end > b.length) return false
    const type = chunkType(b, pos + 4)
    if (first && (type !== 'IHDR' || len !== 13)) return false
    first = false
    // CRC covers the type and data bytes, which are contiguous.
    if (crc32(b.subarray(pos + 4, pos + 8 + len)) !== view.getUint32(pos + 8 + len)) return false
    if (type === 'IEND') return len === 0 && end === b.length
    pos = end
  }
  return false
}
