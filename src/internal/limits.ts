/** No card side is longer than this (pixels): the PNG validator's decode cap (64 MiB) is sized for 4000 x 4000 RGBA. */
export const MAX_SIDE = 4000

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
