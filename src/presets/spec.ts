// The values of the two built-in presets, `payload-og-image:text@1` and `payload-og-image:photo@1`. Nothing here is a plugin default: a site
// that opts in with `collections` gets this named spec, and every number enters the card version through the template's id and revision, so
// changing one is a revision bump that moves only preset cards.

/** The preset templates' ids and the revision both carry. A preset is named `<id>@<revision>`. */
export const TEXT_ID = 'payload-og-image:text'
export const PHOTO_ID = 'payload-og-image:photo'
export const REVISION = '1'

export const CARD = { width: 1200, height: 630 } as const

/** Dark by default (the brand format of the owner's sites). */
export const COLOURS = { ground: '#121416', ink: '#EEF0F2', muted: '#A3A9B0', accent: '#8FB4FF' } as const

/**
 * Text, a logo and a pill stay inside this box. About 15% of a wide card is cropped top and bottom by some feeds (VK), and 64 px is kept
 * from the sides. Only a photo, a scrim and the brand art bleed.
 */
export const ZONE = { x0: 64, x1: 1136, y0: 96, y1: 534 } as const

/** A hero smaller than this draws the text preset: a smaller photograph is blurred at 1200 x 630. */
export const HERO_MIN = { width: 800, height: 420 } as const
/** Raster types the hero loader reads; an SVG is never a hero. */
export const HERO_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const

export const NAMES = { logo: 'logo', mark: 'mark', art: 'art' } as const
/** The box each named image is cut to. The logo is read as a square mark (a wider one is cut at its focal point). */
export const IMAGE_BOXES = {
  logo: { width: 88, height: 88 }, // drawn at 44 x 44
  mark: { width: 470, height: 470 }, // the logo's mark, large, on the right
  art: { width: 540, height: 630 }, // the brand art: the right 45% of the card, whole height
} as const

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
  artX: 660,
  /** Column width with and without the brand art. */
  columnWidth: { art: 560, plain: 900 },
  head: { y: 96, height: 44, name: [34, 30, 26, 22] as const, label: 34, gap: 20, rule: { width: 2, height: 36 } },
  title: {
    y: 168,
    height: 250,
    leading: 1.04,
    tracking: -0.03,
    weight: 700,
    ladder: {
      art: [
        [72, 2],
        [64, 3],
        [56, 3],
        [50, 4],
        [44, 4],
      ],
      plain: [
        [112, 2],
        [96, 2],
        [84, 3],
        [72, 3],
        [64, 4],
        [56, 4],
      ],
    } as const,
  },
  sub: { size: 30, leading: 1.35, gap: 24, maxLines: 2, dropTitleLines: 3, bottom: 478 },
  foot: { y: 500, height: 34, size: 26, gap: 14, pill: { size: 22, padX: 14, height: 34 } },
  /** The mark bleeds past the right edge by this much. */
  markBleed: 110,
  strip: 8,
} as const

export const PHOTO = {
  x: 64,
  width: 1072,
  /** The fact row ends at `ZONE.y1`. */
  fact: { y: 494, height: 40, gap: 14, size: 24, pill: { padX: 16 } },
  title: {
    gapAbove: 20,
    leading: 1.08,
    tracking: -0.025,
    weight: 700,
    ladder: [
      [84, 1],
      [76, 2],
      [70, 2],
      [64, 3],
      [58, 3],
    ] as const,
  },
  logo: { x: 64, y: 96, size: 44 },
  scrim: { fade: 70, peak: 0.7 },
  corner: { size: 360, peak: 0.55 },
} as const
