/** No card side is longer than this (pixels): the PNG validator's decode cap (64 MiB) is sized for 4000 x 4000 RGBA. */
export const MAX_SIDE = 4000

/** Raster types the hero loader reads; an SVG is never a hero. The one list the preset detection and the photo set both use. */
export const HERO_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const

/** What a card's hero is read with: the largest source file (bytes) and image (pixels) the hero loader accepts. */
export const CARD_MAX_BYTES = 15 * 1024 * 1024
export const CARD_MAX_PIXELS = 40_000_000

/**
 * What the photo set is read with. JPEG, PNG and WebP are cut by scaling the whole image down first and cropping the result, which lets the decoder shrink while it loads:
 * one 12000 x 9000 (108 MP) JPEG, one 8064 x 6048 (48 MP, 22 MB) JPEG and a 48 MP WebP peak under 130 MB and take under 130 ms, and a 108 MP PNG about 200 MB (measured with
 * sharp 0.35.5; docs/reference.md). Every other format keeps the card's limits, because nothing was measured for it (AVIF cannot shrink while it loads). A hard cap stays.
 */
export const PHOTO_MAX_BYTES = 50 * 1024 * 1024
export const PHOTO_MAX_PIXELS = 120_000_000
const PHOTO_FORMATS = new Set(['jpeg', 'png', 'webp'])

/** The size limits a photo is read with, by its sharp format name (`jpeg`) or media type (`image/jpeg`). ONE rule for the page that lists a photo and the loader that cuts it. */
export const photoLimits = (kind: unknown): { maxBytes: number; maxPixels: number } =>
  typeof kind === 'string' && PHOTO_FORMATS.has(kind.toLowerCase().replace(/^image\//, ''))
    ? { maxBytes: PHOTO_MAX_BYTES, maxPixels: PHOTO_MAX_PIXELS }
    : { maxBytes: CARD_MAX_BYTES, maxPixels: CARD_MAX_PIXELS }

/** The most named images (`Target.images`) one card carries in all, across every name; the rest are left out. */
export const MAX_CARD_IMAGES = 8

/** A named image list's name: a plain word, so it is safe in a version, a log line and a path. */
export const IMAGE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/

/** An option that must be a whole number of at least `min` (and at most `max`). NaN, fractions and strings are refused. */
export function assertInt(name: string, v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`payload-og-image: ${name} must be an integer from ${min} to ${max}, got ${String(v)}`)
  }
  return v
}

/** An option that must be a number of at least `min`; `Infinity` is allowed (it means "never") unless `finite`. NaN is refused. */
export function assertNumber(name: string, v: unknown, min: number, { finite = true }: { finite?: boolean } = {}): number {
  if (typeof v !== 'number' || Number.isNaN(v) || v < min || (finite && !Number.isFinite(v))) {
    throw new Error(`payload-og-image: ${name} must be ${finite ? 'a finite number' : 'a number'} of at least ${min}, got ${String(v)}`)
  }
  return v
}
