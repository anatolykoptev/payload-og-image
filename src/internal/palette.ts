// Pure palette settings: no sharp, so the plugin entry (loaded by the Payload CLI) can validate the option.
export type Palette = { colours: number; dither: number }
export const DEFAULT_PALETTE: Palette = { colours: 128, dither: 0.5 }

/** The `palette` plugin option: `false` keeps truecolour, a number is the colour count (2 to 256), unset is the default. */
export type PaletteOption = { card?: false | number; hero?: false | number }
export const DEFAULT_HERO_COLOURS = 256

export function assertPaletteOption(o: unknown): void {
  if (o === undefined) return
  if (o === null || typeof o !== 'object' || Array.isArray(o))
    throw new Error('payload-og-image: palette must be an object { card?, hero? }')
  for (const k of Object.keys(o)) {
    if (k !== 'card' && k !== 'hero') throw new Error(`payload-og-image: palette.${k} is not an option (palette.card, palette.hero)`)
    const v = (o as Record<string, unknown>)[k]
    if (v !== undefined && v !== false && !(typeof v === 'number' && Number.isInteger(v) && v >= 2 && v <= 256))
      throw new Error(`payload-og-image: palette.${k} must be false or an integer from 2 to 256, got ${JSON.stringify(v)}`)
  }
}

/** The depth sharp actually quantises to: it rounds a colour count up to 2, 4, 16 or 256 (verified: 17 to 256 give identical bytes). */
export const effectiveColours = (n: number): 2 | 4 | 16 | 256 => (n <= 2 ? 2 : n <= 4 ? 4 : n <= 16 ? 16 : 256)

/** The card's palette for the renderer: the default when unset or equivalent to it, `false` for truecolour, else the effective depth at the default dither. */
export const cardPaletteOf = (o?: PaletteOption): Palette | false =>
  o?.card === undefined || (o.card !== false && effectiveColours(o.card) === 256)
    ? DEFAULT_PALETTE
    : o.card === false
      ? false
      : { ...DEFAULT_PALETTE, colours: effectiveColours(o.card) }

/**
 * The hero's effective colour count (`false` = truecolour). For a lossy card (`lossy`) an unset `hero` is truecolour: the card is re-encoded
 * lossy anyway, so a 256-colour cut only adds banding. An explicit value always wins.
 */
export const heroColoursOf = (o?: PaletteOption, lossy = false): false | number =>
  o?.hero === undefined
    ? lossy
      ? false
      : DEFAULT_HERO_COLOURS
    : o.hero === false
      ? false
      : effectiveColours(o.hero)

/**
 * What the card version must mention: nothing while a setting encodes like its default (so existing cards keep their URLs),
 * else the effective depth: values sharp rounds to the same depth give the same bytes and so the same URL.
 */
export function paletteTags(o?: PaletteOption, lossy = false): { card?: string; hero?: string } {
  const card = cardPaletteOf(o)
  const hero = heroColoursOf(o, lossy)
  return {
    card: card !== false && card === DEFAULT_PALETTE ? undefined : String(card === false ? false : card.colours),
    hero: hero === DEFAULT_HERO_COLOURS ? undefined : String(hero),
  }
}
