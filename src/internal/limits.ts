/** No card side is longer than this (pixels): the PNG validator's decode cap (64 MiB) is sized for 4000 x 4000 RGBA. */
export const MAX_SIDE = 4000

/** Raster types the hero loader reads; an SVG is never a hero. The one list the preset detection and the photo set both use. */
export const HERO_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const

/** What a card's hero is read with: the largest source file (bytes) and image (pixels) the hero loader accepts. */
export const CARD_MAX_BYTES = 15 * 1024 * 1024
export const CARD_MAX_PIXELS = 40_000_000

/**
 * What the photo set is read with, by format. JPEG shrinks while it loads when the whole image is scaled before the crop, so its limit is high; WebP and PNG decode in full,
 * so they keep a lower pixel limit; every other format keeps the card's limits (nothing was measured for it; AVIF cannot shrink while it loads). The measurements behind
 * these numbers live in docs/reference.md ("Big originals"), not here.
 */
export const PHOTO_MAX_BYTES = 50 * 1024 * 1024
const PHOTO_MAX_PIXELS: Record<string, number> = { jpeg: 120_000_000, webp: 48_000_000, png: 48_000_000 }

/** The size limits a photo is read with, by its sharp format name (`jpeg`) or media type (`image/jpeg`). ONE rule for the page that lists a photo and the loader that cuts it. */
export const photoLimits = (kind: unknown): { maxBytes: number; maxPixels: number } => {
  const max = typeof kind === 'string' ? PHOTO_MAX_PIXELS[kind.toLowerCase().replace(/^image\//, '')] : undefined
  return max === undefined ? { maxBytes: CARD_MAX_BYTES, maxPixels: CARD_MAX_PIXELS } : { maxBytes: PHOTO_MAX_BYTES, maxPixels: max }
}

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
