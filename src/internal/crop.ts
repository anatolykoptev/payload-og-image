// The one crop: which window of an image a box of a given aspect shows around the image's focal point. Pure (no sharp), so the plugin entry,
// the card's hero (`render/hero.ts`) and the photo set (`internal/photo.ts`) all take their window from here and never from a copy.

/** A rectangle of the upright image, in pixels. */
export type CropWindow = { left: number; top: number; width: number; height: number }

/** A focal point as Payload stores it: percent of the width and height, 0 to 100. Anything that is not a finite number is the centre. */
export type Focal = { focalX?: unknown; focalY?: unknown }

/** A focal coordinate as a percentage clamped to 0..100; `fallback` (the centre) for anything that is not a finite number. */
export const clampFocal = (n: unknown, fallback = 50): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback

/** The focal point of an upload as `[x, y]`, each clamped to 0..100 (the centre when unset). */
export const focalOf = (u: Focal): [number, number] => [clampFocal(u.focalX), clampFocal(u.focalY)]

/**
 * The size of an image once its EXIF rotation is applied (a quarter turn swaps the stored width and height), or null when the header gives no size.
 * `meta` is what sharp's `metadata()` answers.
 */
export function uprightSize(meta: { width?: number; height?: number; orientation?: number }): { width: number; height: number } | null {
  const turned = (meta.orientation ?? 1) >= 5
  const width = (turned ? meta.height : meta.width) ?? 0
  const height = (turned ? meta.width : meta.height) ?? 0
  return width && height ? { width, height } : null
}

/**
 * The largest window of `aspect` (width / height) inside `size`, centred on the focal point and clamped to the image: the whole width or the whole height,
 * whichever the aspect leaves. Null when the window would be empty. All rounding is `Math.round`.
 */
export function cropWindow(size: { width: number; height: number }, aspect: number, focus: Focal): CropWindow | null {
  const { width, height } = size
  const cropW = Math.min(width, Math.round(height * aspect))
  const cropH = Math.min(height, Math.round(cropW / aspect))
  if (cropW < 1 || cropH < 1) return null
  const at = (focus: number, extent: number, crop: number) =>
    Math.round(Math.min(extent - crop, Math.max(0, (focus / 100) * extent - crop / 2)))
  const [fx, fy] = focalOf(focus)
  return { left: at(fx, width, cropW), top: at(fy, height, cropH), width: cropW, height: cropH }
}
