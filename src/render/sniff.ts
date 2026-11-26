/** Cheap, dependency-free checks on what a file is, so the SVG machinery (`svg.ts`: an XML parser, a WebAssembly renderer) loads only when an SVG is actually seen. */

/** A logo is a few kilobytes; a megabyte is already an export with embedded art. */
export const MAX_SVG_BYTES = 1024 * 1024

/** The `ftyp` brands of AVIF and HEIF files: the box type alone is not a signature (`<!--ftyp-->` puts the same four bytes at offset 4). */
const HEIF_BRANDS = new Set(['avif', 'avis', 'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'])

/** Raster magic numbers (JPEG, PNG, GIF, WebP, AVIF/HEIF, TIFF): bytes that start with one are never read as an SVG. */
export function looksRaster(b: Uint8Array): boolean {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x)
  return (
    at(0, 0xff, 0xd8, 0xff) ||
    at(0, 0x89, 0x50, 0x4e, 0x47) ||
    at(0, 0x47, 0x49, 0x46, 0x38) ||
    (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) ||
    (at(4, 0x66, 0x74, 0x79, 0x70) && HEIF_BRANDS.has(Buffer.from(b.subarray(8, 12)).toString('latin1'))) ||
    at(0, 0x49, 0x49, 0x2a, 0x00) ||
    at(0, 0x4d, 0x4d, 0x00, 0x2a)
  )
}

/** Whether the bytes are text that opens an SVG document (after a BOM, whitespace, the XML declaration, comments and a DOCTYPE). */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SVG_BYTES) return false
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1')
  return /^(?:\xef\xbb\xbf)?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?svg[\s>/]/i.test(
    head,
  )
}
