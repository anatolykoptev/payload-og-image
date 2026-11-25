// Pure palette settings: no sharp, so the plugin entry (loaded by the Payload CLI) can validate the option.
export type Palette = { colours: number; dither: number }
export const DEFAULT_PALETTE: Palette = { colours: 128, dither: 0.5 }

/** The `palette` plugin option: `false` keeps truecolour, a number is the colour count (2 to 256), unset is the default. */
export type PaletteOption = { card?: false | number; hero?: false | number }
export const DEFAULT_HERO_COLOURS = 256

/** Throws a named error for anything but `undefined`, `false` or an integer from 2 to 256. */
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

/** The card's palette for the renderer: the default when unset, `false` for truecolour, else that many colours at the default dither. */
export const cardPaletteOf = (o?: PaletteOption): Palette | false =>
  o?.card === undefined ? DEFAULT_PALETTE : o.card === false ? false : { ...DEFAULT_PALETTE, colours: o.card }

/** The hero's colour count (`false` = truecolour). */
export const heroColoursOf = (o?: PaletteOption): false | number => o?.hero ?? DEFAULT_HERO_COLOURS

/**
 * What the card version must mention: nothing while a setting equals its default (so existing cards keep their URLs),
 * else the effective value, as the card and the hero are encoded differently then.
 */
export function paletteTags(o?: PaletteOption): { card?: string; hero?: string } {
  const card = cardPaletteOf(o)
  const hero = heroColoursOf(o)
  return {
    card: card !== false && card.colours === DEFAULT_PALETTE.colours ? undefined : String(card === false ? false : card.colours),
    hero: hero === DEFAULT_HERO_COLOURS ? undefined : String(hero),
  }
}
