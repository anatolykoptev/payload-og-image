import { MAX_SIDE } from '../limits.js'

/** Markers that carry a frame header (SOF0..SOF15 except DHT, JPG and DAC, which share the range). */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc
const SOI = 0xd8
const EOI = 0xd9
const SOS = 0xda
const DQT = 0xdb
const DHT = 0xc4
/** The Huffman DCT frames (baseline, extended sequential, progressive): all our encoder writes. Arithmetic, lossless and hierarchical frames are refused. */
const HUFFMAN_DCT = new Set([0xc0, 0xc1, 0xc2])

/**
 * True only for a whole JPEG: SOI, then every marker segment within bounds, a frame header with a sane size and 1, 3 or 4 components
 * of 8 bits, quantisation and Huffman tables before the first scan, at least one scan with a header that matches the frame, and
 * an EOI that is exactly the last two bytes. A file cut short by a crash, or one whose tail was never written (zeros), fails; the
 * two-byte SOI alone catches neither. JPEG carries no checksum, so this walk finds structure, not a flipped bit inside a scan:
 * the disk store also decodes (`decodesImage`).
 */
export function isCompleteJpeg(b: Uint8Array): boolean {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI || b[b.length - 2] !== 0xff || b[b.length - 1] !== EOI) return false
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let pos = 2
  let frame: { width: number; height: number; components: number } | undefined
  let dqt = false
  let dht = false
  let scans = 0
  while (pos + 2 <= b.length) {
    if (b[pos] !== 0xff) return false
    const marker = b[pos + 1] as number
    if (marker === 0xff) {
      pos += 1 // fill byte
      continue
    }
    if (marker === EOI) return pos + 2 === b.length && scans > 0
    // Markers with no length: TEM (01) and RSTn (D0..D7) must not appear between segments; SOI twice is a malformed file.
    if (marker === 0x00 || marker === 0x01 || marker === SOI || (marker >= 0xd0 && marker <= 0xd7)) return false
    if (pos + 4 > b.length) return false
    const len = view.getUint16(pos + 2)
    const end = pos + 2 + len
    if (len < 2 || end > b.length) return false
    if (isSof(marker)) {
      if (frame || len < 8 || !HUFFMAN_DCT.has(marker)) return false
      const components = view.getUint8(pos + 9)
      const width = view.getUint16(pos + 7)
      const height = view.getUint16(pos + 5)
      if (view.getUint8(pos + 4) !== 8 || width === 0 || height === 0 || width > MAX_SIDE || height > MAX_SIDE) return false
      if (![1, 3, 4].includes(components) || len !== 8 + 3 * components) return false
      frame = { width, height, components }
    } else if (marker === DQT) dqt = true
    else if (marker === DHT) dht = true
    else if (marker === SOS) {
      if (!frame || !dqt) return false
      if (!dht) return false
      const ns = view.getUint8(pos + 4)
      if (ns < 1 || ns > frame.components || len !== 6 + 2 * ns) return false
      scans += 1
      pos = skipScan(b, end)
      if (pos < 0) return false
      continue
    }
    pos = end
  }
  return false
}

/** The offset of the first marker after an entropy-coded segment starting at `from`, or -1 when the data runs off the end. */
function skipScan(b: Uint8Array, from: number): number {
  for (let i = from; i + 1 < b.length; i++) {
    if (b[i] !== 0xff) continue
    const next = b[i + 1] as number
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      i += 1 // a stuffed 0xFF or a restart marker is data
      continue
    }
    if (next === 0xff) continue // fill: the real marker byte follows
    return i
  }
  return -1
}
