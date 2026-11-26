import { uprightSize } from '../internal/crop.js'
import { loadSharp } from '../internal/deps.js'
import { type PhotoCut, type PhotoName, photoSizes } from '../internal/photo.js'
import type { Upload } from '../internal/types.js'
import { toJpeg } from './encode.js'
import { RASTER_FORMATS } from './sniff.js'

/**
 * One size of the photo set from the upload's file: decoded upright (EXIF rotation applied), the window of the ratio around the focal point (`photoSizes`, the
 * same function the page's advertised size comes from), scaled DOWN only, then a progressive mozjpeg in sRGB with no metadata. Nothing is drawn on it. The file's
 * own size decides, not the upload's record.
 *
 * A window that must shrink is cut by scaling the WHOLE image so the window lands at the output size, then extracting it: the decoder can then shrink while it loads (a JPEG
 * is decoded at 1/2, 1/4 or 1/8 size, a WebP likewise), so a phone original costs a fraction of a full decode. The extract sits at the window's position scaled by the same
 * factor and rounded; a window that is not scaled is extracted as it is. `maxPixels` answers the pixel limit by sharp format (`photoLimits`).
 */
export async function cutPhoto(
  bytes: Buffer,
  upload: Upload,
  a: { name: PhotoName; quality: number; ground: string },
  o: { maxPixels: (format: string) => number },
): Promise<PhotoCut> {
  // Outside the try: a sharp that cannot load is a render error that names it, not a missing photo.
  const sharp = await loadSharp()
  try {
    // The header alone (no pixel is decoded, so no limit is needed yet); the limit of the file's real format is applied before the decode.
    const meta = await sharp(bytes, { limitInputPixels: false, failOn: 'error' }).metadata()
    if (!meta.format || !RASTER_FORMATS.has(meta.format)) return { status: 'absent' }
    const maxPixels = o.maxPixels(meta.format)
    if ((meta.width ?? 0) * (meta.height ?? 0) > maxPixels) return { status: 'absent' }
    const upright = uprightSize(meta)
    if (!upright) return { status: 'absent' }
    const size = photoSizes(upright, upload).find((s) => s.name === a.name)
    if (!size) return { status: 'absent' }
    const input = { limitInputPixels: maxPixels, failOn: 'error' as const }
    const { crop } = size
    let image = sharp(bytes, input).rotate()
    if (size.width === crop.width) image = image.extract(crop)
    else {
      const scale = size.width / crop.width
      const left = Math.round(crop.left * scale)
      const top = Math.round(crop.top * scale)
      // The scaled image is at least as big as the window it must hold (a pixel of rounding is never a missing row or column).
      image = image
        .resize(
          Math.max(Math.round(upright.width * scale), left + size.width),
          Math.max(Math.round(upright.height * scale), top + size.height),
          {
            fit: 'fill',
          },
        )
        .extract({ left, top, width: size.width, height: size.height })
    }
    const out = await toJpeg(image.toColourspace('srgb'), a).toBuffer()
    return { status: 'ok', bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), width: size.width, height: size.height }
  } catch {
    return { status: 'unreadable' }
  }
}
