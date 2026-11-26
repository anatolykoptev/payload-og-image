// The photo set: clean crops of a page's hero photograph for schema.org `image` and Google Discover. Pure (no sharp): resolve, the version, the route and the
// helper a page calls all read the sizes from `photoSizes`, so the width and height a page advertises are the ones the cropper produces.
import { type CropWindow, cropWindow, type Focal } from './crop.js'
import { HERO_MIME } from './limits.js'

/**
 * The spec of the set, and the only place its numbers are written. It enters every photo's version whole, so changing a value moves every photo URL.
 * `capWidth` is Google's Discover bar (at least 1200 px wide; all three full sizes pass); `minWidth` is a judgment: below it a crop is not a
 * high-resolution thumbnail on a 3x phone. Nothing is ever enlarged: a source narrower than the cap gives a smaller crop, down to `minWidth`.
 */
export const PHOTO_SET = {
  revision: '1',
  capWidth: 1200,
  minWidth: 600,
  /** In the order a page lists them. */
  ratios: { '16x9': [16, 9], '4x3': [4, 3], '1x1': [1, 1] },
} as const

export type PhotoName = keyof typeof PHOTO_SET.ratios
export const PHOTO_NAMES = Object.keys(PHOTO_SET.ratios) as PhotoName[]

/** The file name a size is served under, beside the card (`photo-16x9.jpg`). */
export const photoFile = (name: PhotoName) => `photo-${name}.jpg`
/** The size a file name stands for, or undefined. */
export const photoNameOfFile = (file: string): PhotoName | undefined => PHOTO_NAMES.find((n) => photoFile(n) === file)

/** The raster types a photo is cut from: the hero's own list. Never an SVG. */
export const PHOTO_MIME: readonly string[] = HERO_MIME

export type PhotoSize = { name: PhotoName; crop: CropWindow; width: number; height: number }

/**
 * The sizes a source of `src` (upright) gives, in page order: the window of each ratio around the focal point, scaled DOWN to the cap, and only when it stays at
 * least `minWidth` wide (a size that would be smaller does not exist). The height is never stored: it is the crop's own when nothing is scaled, else the width over the ratio.
 */
export function photoSizes(src: { width: number; height: number }, focus: Focal): PhotoSize[] {
  const out: PhotoSize[] = []
  for (const name of PHOTO_NAMES) {
    const [w, h] = PHOTO_SET.ratios[name]
    const ratio = w / h
    const crop = cropWindow(src, ratio, focus)
    if (!crop) continue
    const width = Math.min(PHOTO_SET.capWidth, crop.width)
    if (width < PHOTO_SET.minWidth) continue
    out.push({ name, crop, width, height: width === crop.width ? crop.height : Math.round(width / ratio) })
  }
  return out
}

/**
 * What cutting one size of the photo set gave. `absent`: the file is no raster image, or it is too small for that size (a record that disagreed with the file).
 * `unreadable`: the file could not be read or decoded. `width` and `height` are what was produced, so the caller can compare them with what the page advertised.
 */
export type PhotoCut = { status: 'ok'; bytes: Uint8Array; width: number; height: number } | { status: 'absent' } | { status: 'unreadable' }
