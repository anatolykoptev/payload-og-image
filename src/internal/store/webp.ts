import { MAX_SIDE } from '../limits.js'

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0)

/**
 * True only for a whole WebP: a RIFF container whose declared size is exactly the rest of the file (so a truncated or over-long file
 * fails), a `WEBP` form, then chunks that are each within bounds (sizes are padded to even) and end exactly at the last byte. The
 * first chunk is the image (`VP8 ` lossy with its start code and a sane size, or `VP8L` lossless with its signature) or the `VP8X`
 * extended header (with a sane canvas) followed by a chunk that holds image data. The bitstream itself has no checksum, so the
 * disk store also decodes (`decodesImage`).
 */
export function isCompleteWebp(b: Uint8Array): boolean {
  if (b.length < 20 || fourcc(b, 0) !== 'RIFF' || fourcc(b, 8) !== 'WEBP') return false
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const riff = view.getUint32(4, true)
  if (riff % 2 !== 0 || riff + 8 !== b.length) return false
  let pos = 12
  let first = true
  let hasImage = false
  while (pos < b.length) {
    if (pos + 8 > b.length) return false
    const type = fourcc(b, pos)
    const size = view.getUint32(pos + 4, true)
    const body = pos + 8
    const end = body + size + (size % 2)
    if (end > b.length || body + size > b.length) return false
    if (type === 'VP8 ') {
      // frame tag (3 bytes, bit 0 clear = key frame), start code 9d 01 2a, then 14-bit width and height
      if (size < 10 || ((b[body] ?? 1) & 1) !== 0 || b[body + 3] !== 0x9d || b[body + 4] !== 0x01 || b[body + 5] !== 0x2a) return false
      const w = view.getUint16(body + 6, true) & 0x3fff
      const h = view.getUint16(body + 8, true) & 0x3fff
      if (w === 0 || h === 0 || w > MAX_SIDE || h > MAX_SIDE) return false
      hasImage = true
    } else if (type === 'VP8L') {
      if (size < 5 || b[body] !== 0x2f) return false
      const bits = view.getUint32(body + 1, true)
      const w = (bits & 0x3fff) + 1
      const h = ((bits >>> 14) & 0x3fff) + 1
      if (w > MAX_SIDE || h > MAX_SIDE) return false
      hasImage = true
    } else if (type === 'VP8X') {
      if (!first || size !== 10) return false
      const w = (b[body + 4] ?? 0) + ((b[body + 5] ?? 0) << 8) + ((b[body + 6] ?? 0) << 16) + 1
      const h = (b[body + 7] ?? 0) + ((b[body + 8] ?? 0) << 8) + ((b[body + 9] ?? 0) << 16) + 1
      if (w > MAX_SIDE || h > MAX_SIDE) return false
    } else if (first) return false
    first = false
    pos = end
  }
  return hasImage && pos === b.length
}
