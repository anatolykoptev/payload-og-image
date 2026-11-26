// The values of the two built-in presets, `payload-og-image:text@2` and `payload-og-image:photo@2` (`REVISION`). Nothing here is a plugin default: a site
// that opts in gets this named spec, and every number enters the card version through the template's id and revision, so changing one is a
// revision bump that moves only preset cards.
import { DEFAULT_MIN_CONTRAST } from '../internal/colour.js'
import type { ImageShape } from '../template.js'

/** The preset templates' ids and the revision both carry. A preset is named `<id>@<revision>`. */
export const TEXT_ID = 'payload-og-image:text'
export const PHOTO_ID = 'payload-og-image:photo'
/** 2: the redesign (contained logos, the faint logo on the right, the new scrim and ladders). */
export const REVISION = '2'

export const CARD = { width: 1200, height: 630 } as const

/** Dark by default (the brand format of the owner's sites). */
export const COLOURS = { ground: '#121416', ink: '#EEF0F2', muted: '#A3A9B0', accent: '#8FB4FF' } as const

/**
 * Text, a logo and a pill stay inside this box. VK documents a 510 x 228 snippet, which centre-cropped takes about 47 px off the top and bottom of a
 * 1200 x 630 card; 96 px is about twice that, and 64 px is kept from the sides (see docs/share-image-spec.md). Only a photo, a scrim, the brand art
 * and the accent strip bleed.
 */
export const ZONE = { x0: 64, x1: 1136, y0: 96, y1: 534 } as const

/** A hero smaller than this draws the text preset: a smaller photograph is blurred at 1200 x 630. */
export const HERO_MIN = { width: 800, height: 420 } as const
/** Raster types the hero loader reads; an SVG is never a hero. */
export const HERO_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const

/** The images are cut at twice the size they are drawn at. */
export const DENSITY = 2

/** The box each named image is prepared in (a contained image is only as large as its aspect makes it, at most this). */
export const IMAGE_BOXES = {
  logo: { width: 440, height: 88 }, // drawn at most 220 x 44
  partner: { width: 320, height: 88 }, // drawn at most 160 x 44
  mark: { width: 400, height: 400 }, // the logo, whole, on the right
  art: { width: 464, height: 630 }, // the uploaded brand art: the right of the card, whole height
} as const
export const PHOTO_IMAGE_BOXES = {
  logo: { width: 300, height: 72 }, // drawn at most 150 x 36
  partner: { width: 240, height: 72 }, // drawn at most 120 x 36
} as const

/**
 * The one contrast rule of the text preset: a logo, or a document's own accent, that contrasts less than this with the ground (the ground is
 * also the colour drawn on a pill of the accent) is drawn in the ink instead.
 */
export const MIN_CONTRAST = DEFAULT_MIN_CONTRAST

/** A logo is contained and trimmed (an opaque JPEG on a uniform ground is cut out of it), and drawn in the ink when most of it would vanish on the ground (under `MIN_CONTRAST`:1). */
const logoShape = (fill: string): ImageShape => ({
  trim: true,
  key: true,
  contrast: { ground: COLOURS.ground, fill, min: MIN_CONTRAST },
})
export const TEXT_SHAPES: Record<string, ImageShape> = {
  logo: logoShape(COLOURS.ink),
  partner: logoShape(COLOURS.ink),
  // The logo on the right: trimmed, contained and tinted like the head's, and not drawn at all when its trimmed aspect is no mark (outside 0.67 to 1.5).
  mark: { ...logoShape(COLOURS.ink), aspect: [0.67, 1.5] },
}
export const PHOTO_SHAPES: Record<string, ImageShape> = { logo: logoShape('#ffffff'), partner: logoShape('#ffffff') }

/** The slots both presets draw (the designer of a later release fills them). A higher priority drops first; a value over `maxChars` is dropped. */
export const SLOTS = {
  pill: { kind: 'pill', maxChars: 28, priority: 1 },
  badge: { kind: 'badge', maxChars: 6, priority: 2 },
  pill2: { kind: 'pill', maxChars: 24, priority: 3 },
  caption: { kind: 'text', maxChars: 48, priority: 4 },
  meta: { kind: 'text', maxChars: 32, priority: 5 },
} as const
export type SlotName = keyof typeof SLOTS

export const TEXT = {
  /** Left edge of the text column; the brand art starts at `artX`. */
  x: 80,
  artX: 736,
  /** Column width beside the faint logo (it sits behind the title), beside uploaded art, and with neither. */
  columnWidth: { mark: 900, art: 640, plain: 900 },
  head: {
    y: 96,
    height: 44,
    name: [34, 30, 26, 22] as const,
    label: 34,
    gap: 20,
    rule: { width: 2, height: 36 },
    logo: { maxWidth: 220, height: 44 },
    partner: { maxWidth: 160, height: 44 },
    /** A logo wider than this (width / height) stands alone: no site name beside it, no logo on the right. */
    wide: 1.5,
    after: 16,
  },
  title: {
    y: 168,
    height: 280,
    leading: 1.04,
    tracking: -0.03,
    weight: 700,
    ladder: {
      // With the art there is no ellipsis: a title that does not fit whole at the last rung drops the art and is fitted on the plain ladder.
      art: [
        [96, 2],
        [84, 2],
        [72, 2],
        [64, 3],
        [56, 3],
        [48, 4],
      ],
      plain: [
        [112, 2],
        [96, 2],
        [84, 3],
        [72, 3],
        [64, 4],
        [56, 4],
        [50, 5],
        [44, 6],
      ],
    } as const,
  },
  sub: { size: 30, leading: 1.35, gap: 24, maxLines: 2, dropTitleLines: 2, bottom: 478 },
  foot: { y: 500, height: 34, size: 26, gap: 14, pill: { size: 22, padX: 14, height: 34 } },
  /**
   * The logo on the right, contained in a 400 x 400 box at (736, 115) and never clipped, drawn at `opacity` unless the site sets `artOpacity`. It is faint and
   * stays behind the title, so the title column is as wide as without it (900 px): a 42-character title keeps its 84 px two lines. Uploaded brand art is
   * opaque, so it takes the right of the card and the column narrows to 640.
   */
  art: { x: 736, y: 115, size: 400, opacity: 0.35 },
  strip: { height: 8, opacity: 0.55 },
} as const

export const PHOTO = {
  x: 64,
  width: 1072,
  /** The fact row ends at `ZONE.y1`. */
  fact: { y: 494, height: 40, gap: 14, size: 24, pill: { padX: 16 } },
  title: {
    gapAbove: 28,
    leading: 1.08,
    tracking: -0.025,
    weight: 700,
    ladder: [
      [84, 1],
      [76, 2],
      [70, 2],
      [64, 3],
      [58, 3],
      [52, 4],
      [48, 4],
    ] as const,
  },
  /** The scrim fades in over `fade` px above the title's top and is `peak` at the bottom edge: dark only as high as the words need, never opaque. */
  scrim: {
    fade: 140,
    stops: [
      [0, 0],
      [60, 0.22],
      [140, 0.55],
    ] as const,
    peak: 0.82,
  },
  /** One brand lockup at the end of the fact row: the logo, a partner logo, then the name. */
  lockup: { logo: { maxWidth: 150, height: 36 }, partner: { maxWidth: 120, height: 36 }, nameSize: 26, nameOpacity: 0.92, wide: 1.5 },
} as const
