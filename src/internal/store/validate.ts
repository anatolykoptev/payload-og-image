import type { CardFormat } from '../format.js'
import { MAX_SIDE } from '../limits.js'
import { isCompleteJpeg } from './jpeg.js'
import { isCompletePng } from './png.js'
import { isCompleteWebp } from './webp.js'

/**
 * Whether libjpeg or libwebp decodes the whole file with no warning (a truncated scan or a desynchronised stream is one) to the
 * size the container promises. JPEG and WebP carry no checksum: structure finds a torn file, the decode finds a corrupt stream.
 * Lazy: `sharp` is loaded on the first lossy card only, never by the plugin entry.
 */
export async function decodesImage(b: Uint8Array): Promise<boolean> {
  try {
    const { default: sharp } = await import('sharp')
    const { info } = await sharp(Buffer.from(b.buffer, b.byteOffset, b.byteLength), {
      failOn: 'warning',
      limitInputPixels: MAX_SIDE * MAX_SIDE,
    })
      .raw()
      .toBuffer({ resolveWithObject: true })
    return info.width > 0 && info.height > 0
  } catch {
    return false
  }
}

/**
 * Whether `bytes` are a whole card of `format`: the one gate every stored or cached card passes. A PNG is checked by its chunks
 * and CRCs; a JPEG or WebP by its container structure and then a full decode.
 */
export async function isWholeCard(bytes: Uint8Array, format: CardFormat): Promise<boolean> {
  if (format === 'png') return isCompletePng(bytes)
  return (format === 'jpeg' ? isCompleteJpeg(bytes) : isCompleteWebp(bytes)) && (await decodesImage(bytes))
}
