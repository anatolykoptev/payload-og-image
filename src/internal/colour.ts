/**
 * The hero background colour: `#rgb` or `#rrggbb` (any case), nothing else. Those are the hex forms sharp's `flatten` takes
 * without ambiguity (no alpha: a hero is flattened onto an opaque ground, so `#rrggbbaa` and `#rgba` are refused, as are
 * names and malformed hex such as `#12345`). Returns the normalised lowercase `#rrggbb`, which is also what the card version hashes.
 */
export function normaliseHeroBackground(v: unknown): string {
  if (typeof v === 'string') {
    const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v)
    if (m) {
      const h = (m[1] as string).toLowerCase()
      return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`
    }
  }
  throw new Error(`payload-og-image: heroBackground must be #rgb or #rrggbb, got ${JSON.stringify(v)}`)
}

/** The colour a hero is flattened onto when `heroBackground` is not set. */
export const DEFAULT_HERO_BACKGROUND = '#ffffff'
