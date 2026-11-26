import { uprightSize } from '../internal/crop.js'
import { loadSharp } from '../internal/deps.js'
import { type PhotoCut, type PhotoName, photoSizes } from '../internal/photo.js'
import type { Upload } from '../internal/types.js'
import { toJpeg } from './encode.js'

/** Raster formats a photo is cut from (the hero loader's list). */
const RASTER = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif'])

/**
 * One size of the photo set from the upload's file: decoded upright (EXIF rotation applied), the window of the ratio around the focal point (`photoSizes`, the
 * same function the page's advertised size comes from), scaled DOWN only, then a progressive mozjpeg in sRGB with no metadata. Nothing is drawn on it. The file's
 * own size decides, not the upload's record.
 */
export async function cutPhoto(
  bytes: Buffer,
  upload: Upload,
  a: { name: PhotoName; quality: number; ground: string },
  o: { maxPixels: number },
): Promise<PhotoCut> {
  // Outside the try: a sharp that cannot load is a render error that names it, not a missing photo.
  const sharp = await loadSharp()
  try {
    const input = { limitInputPixels: o.maxPixels, failOn: 'error' as const }
    const meta = await sharp(bytes, input).metadata()
    if (!meta.format || !RASTER.has(meta.format)) return { status: 'absent' }
    const upright = uprightSize(meta)
    if (!upright) return { status: 'absent' }
    const size = photoSizes(upright, upload).find((s) => s.name === a.name)
    if (!size) return { status: 'absent' }
    let image = sharp(bytes, input).rotate().extract(size.crop)
    // Down only: a crop at or under the cap is never resized (no enlarging, no resampling of an already right-sized window).
    if (size.width !== size.crop.width) image = image.resize(size.width, size.height)
    const out = await toJpeg(image.toColourspace('srgb'), a).toBuffer()
    return { status: 'ok', bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), width: size.width, height: size.height }
  } catch {
    return { status: 'unreadable' }
  }
}
