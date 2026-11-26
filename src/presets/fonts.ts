import type { FontSpec, Stacks } from '../internal/fonts.js'
import { FONT_DATA } from './fontData.js'

const face = (family: string, subset: string, weight: 400 | 700): FontSpec => {
  const file = `inter-${subset}-${weight}-normal.woff`
  return { family, weight, data: async () => new Uint8Array(Buffer.from(FONT_DATA[file] as string, 'base64')) }
}

/**
 * Inter (SIL OFL 1.1, `fonts/OFL.txt`) 400 and 700 in three subsets, each its own family: a face is one WOFF subset, and a stack lists them in
 * order, so a run is drawn glyph by glyph by the first family that has the glyph.
 */
export const BUNDLED_FONTS: FontSpec[] = [
  face('Inter', 'latin', 400),
  face('Inter', 'latin', 700),
  face('Inter Ext', 'latin-ext', 400),
  face('Inter Ext', 'latin-ext', 700),
  face('Inter Cyrillic', 'cyrillic', 400),
  face('Inter Cyrillic', 'cyrillic', 700),
]

/** The stacks a site gets from the bundled faces, only when it registers none of its own. */
export const BUNDLED_STACKS: Stacks = { default: ['Inter', 'Inter Ext', 'Inter Cyrillic'] }
