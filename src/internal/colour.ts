/**
 * A colour as `#rgb` or `#rrggbb` (any case), nothing else: the hex forms sharp's `flatten` takes without ambiguity (no alpha, so `#rrggbbaa`
 * and `#rgba` are refused, as are names and malformed hex such as `#12345`). Returns the normalised lowercase `#rrggbb`, or undefined.
 */
export function hexColour(v: unknown): string | undefined {
  const m = typeof v === 'string' ? /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v) : null
  if (!m) return undefined
  const h = (m[1] as string).toLowerCase()
  return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`
}

/** The hero background colour (see `hexColour`). Returns the normalised lowercase `#rrggbb`, which is also what the card version hashes. */
export function normaliseHeroBackground(v: unknown): string {
  const hex = hexColour(v)
  if (hex !== undefined) return hex
  throw new Error(`payload-og-image: heroBackground must be #rgb or #rrggbb, got ${JSON.stringify(v)}`)
}

/** `#rgb` or `#rrggbb` as its channels. */
export const rgbOf = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const n = Number.parseInt(f.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const linear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
/** WCAG relative luminance of `[r, g, b]` (0 to 255). */
export const luminance = ([r, g, b]: number[]) => 0.2126 * linear(r as number) + 0.7152 * linear(g as number) + 0.0722 * linear(b as number)
/** WCAG contrast ratio of two relative luminances. */
export const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** An explicit `heroBackground` of this colour hashes with no tag, as it did in 0.4.0 (when white was also the unset default and is what such a hero was flattened onto). */
export const DEFAULT_HERO_BACKGROUND = '#ffffff'
