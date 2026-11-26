// Writes the blocks of docs/share-image-spec.md that come from src/presets/spec.ts, so a number of the design lives in one place.
// Each block sits between `<!-- spec:<name> -->` and `<!-- /spec:<name> -->`; everything else in the document is written by hand.
//   node scripts/share-image-spec.mjs          rewrite the blocks in the document (pnpm docs:spec)
//   node scripts/share-image-spec.mjs --check  exit 1 when a block is stale or a marker is missing
// Node strips the types of src/presets/spec.ts itself; the render functions take the spec as an argument, so the test passes it in.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DOC = new URL('../docs/share-image-spec.md', import.meta.url)

/**
 * The aspect ratios a share image is cropped to somewhere, taken from the platform table of the document (external facts, written by hand with
 * their sources there). Each is applied to the card as a centred crop: no platform documents where it crops.
 */
export const CROPS = [
  { ratio: [191, 100], who: 'Facebook, LinkedIn link share (1.91:1)' },
  { ratio: [2, 1], who: 'X summary_large_image (2:1)' },
  { ratio: [510, 228], who: 'VK large snippet (510 x 228)' },
  { ratio: [16, 9], who: 'Google Discover, Article image (16:9)' },
  { ratio: [4, 3], who: 'Google Article image (4:3)' },
  { ratio: [1, 1], who: 'a square thumbnail: X summary, Telegram or Slack small preview, Article image (1:1)' },
]

const round = (n) => Math.round(n * 10) / 10
const pad = (s, n) => String(s).padEnd(n)

/** What a centred crop of the card to `ratio` takes off each edge, in px, and whether it reaches into the safe zone. */
export function cropOf({ CARD, ZONE }, [rw, rh]) {
  const r = rw / rh
  const wide = CARD.width / CARD.height
  const sides = r < wide ? round((CARD.width - CARD.height * r) / 2) : 0
  const ends = r > wide ? round((CARD.height - CARD.width / r) / 2) : 0
  const room = { sides: Math.min(ZONE.x0, CARD.width - ZONE.x1), ends: Math.min(ZONE.y0, CARD.height - ZONE.y1) }
  return { sides, ends, fits: sides <= room.sides && ends <= room.ends }
}

const ladder = (rungs) => rungs.map(([size, lines]) => `${size}/${lines}`).join(' ')
const box = (b) => `${b.width} x ${b.height}`

const blocks = {
  'safe-zone': (s) => {
    const { CARD, ZONE } = s
    const margins = { left: ZONE.x0, right: CARD.width - ZONE.x1, top: ZONE.y0, bottom: CARD.height - ZONE.y1 }
    const rows = CROPS.map((c) => {
      const k = cropOf(s, c.ratio)
      const took = k.ends > 0 ? `top and bottom ${k.ends} px each` : k.sides > 0 ? `left and right ${k.sides} px each` : 'nothing'
      return `${pad(took, 36)}${pad(k.fits ? 'yes' : 'NO', 12)}${c.who}`
    })
    return [
      '```text',
      `card          ${CARD.width} x ${CARD.height}`,
      `safe zone     x ${ZONE.x0} to ${ZONE.x1}, y ${ZONE.y0} to ${ZONE.y1}`,
      `margins       left ${margins.left}, right ${margins.right}, top ${margins.top}, bottom ${margins.bottom} (px from the card edge)`,
      '',
      `${pad('a centred crop to this ratio takes', 36)}${pad('zone intact', 12)}ratio`,
      ...rows,
      '```',
    ].join('\n')
  },
  design: (s) => {
    const { CARD, COLOURS, ZONE, TEXT, TEXT_SHAPES, PHOTO, SLOTS, HERO_MIN, HERO_MIME, IMAGE_BOXES, PHOTO_IMAGE_BOXES, DENSITY } = s
    const slots = Object.entries(SLOTS).map(([n, v]) => `${n} (${v.kind}, at most ${v.maxChars} characters, priority ${v.priority})`)
    return [
      '```text',
      `presets       ${s.TEXT_ID}@${s.REVISION}, ${s.PHOTO_ID}@${s.REVISION}`,
      `card          ${CARD.width} x ${CARD.height}; images are cut at ${DENSITY}x the size they are drawn at`,
      `colours       ground ${COLOURS.ground}, ink ${COLOURS.ink}, muted ${COLOURS.muted}, accent ${COLOURS.accent}`,
      `safe zone     x ${ZONE.x0} to ${ZONE.x1}, y ${ZONE.y0} to ${ZONE.y1}`,
      '',
      'text card (px)',
      `  column      x ${TEXT.x}; width ${TEXT.columnWidth.plain} plain, ${TEXT.columnWidth.mark} beside the faint logo, ${TEXT.columnWidth.art} beside uploaded art (art at x ${TEXT.artX})`,
      `  head        y ${TEXT.head.y}, height ${TEXT.head.height}; site name ${TEXT.head.name.join('/')}, label ${TEXT.head.label}; gap ${TEXT.head.gap}; hairline ${TEXT.head.rule.width} x ${TEXT.head.rule.height}`,
      `  head logos  logo at most ${TEXT.head.logo.maxWidth} x ${TEXT.head.logo.height}, partner at most ${TEXT.head.partner.maxWidth} x ${TEXT.head.partner.height}, ${TEXT.head.after} between; wider than ${TEXT.head.wide}:1 stands alone`,
      `  title       y ${TEXT.title.y}, at most ${TEXT.title.height} high; leading ${TEXT.title.leading}, tracking ${TEXT.title.tracking}em, weight ${TEXT.title.weight}`,
      `              ladder beside art (size/lines): ${ladder(TEXT.title.ladder.art)}`,
      `              ladder otherwise:               ${ladder(TEXT.title.ladder.plain)}`,
      `  sub line    ${TEXT.sub.size} px, leading ${TEXT.sub.leading}, at most ${TEXT.sub.maxLines} lines, only when the title has at most ${TEXT.sub.dropTitleLines} lines; ${TEXT.sub.gap} below the title, ends by y ${TEXT.sub.bottom}`,
      `  foot        y ${TEXT.foot.y}, height ${TEXT.foot.height}, ${TEXT.foot.size} px, gap ${TEXT.foot.gap}; pills ${TEXT.foot.pill.size} px, ${TEXT.foot.pill.padX} px padding`,
      `  faint logo  contained in ${TEXT.art.size} x ${TEXT.art.size} at (${TEXT.art.x}, ${TEXT.art.y}); opacity ${TEXT.art.opacity}; drawn only when its trimmed aspect is within ${TEXT_SHAPES.mark.aspect.join(' to ')}`,
      `  accent strip ${TEXT.strip.height} high along the bottom edge, opacity ${TEXT.strip.opacity}`,
      '',
      'photo card (px)',
      `  column      x ${PHOTO.x}, width ${PHOTO.width}`,
      `  fact row    y ${PHOTO.fact.y}, height ${PHOTO.fact.height}, ${PHOTO.fact.size} px, gap ${PHOTO.fact.gap}; pills ${PHOTO.fact.pill.padX} px padding; ends at y ${ZONE.y1}`,
      `  title       ${PHOTO.title.gapAbove} above the fact row, bottom-anchored; leading ${PHOTO.title.leading}, tracking ${PHOTO.title.tracking}em, weight ${PHOTO.title.weight}`,
      `              ladder (size/lines): ${ladder(PHOTO.title.ladder)}`,
      `  scrim       ground colour, fades in over ${PHOTO.scrim.fade} above the title's top; stops (px, alpha) ${PHOTO.scrim.stops.map(([p, a]) => `${p}:${a}`).join(' ')}; ${PHOTO.scrim.peak} at the bottom edge`,
      `  lockup      logo at most ${PHOTO.lockup.logo.maxWidth} x ${PHOTO.lockup.logo.height}, partner at most ${PHOTO.lockup.partner.maxWidth} x ${PHOTO.lockup.partner.height}, name ${PHOTO.lockup.nameSize} px at ${PHOTO.lockup.nameOpacity}; wider than ${PHOTO.lockup.wide}:1 stands alone`,
      '',
      `slots         ${slots.join('; ')}; a higher priority drops first`,
      `hero          a raster of at least ${box(HERO_MIN)} (${HERO_MIME.join(', ')}) draws the photo card; anything smaller or an SVG draws the text card`,
      `image boxes   text card: logo ${box(IMAGE_BOXES.logo)}, partner ${box(IMAGE_BOXES.partner)}, faint logo ${box(IMAGE_BOXES.mark)}, art ${box(IMAGE_BOXES.art)}; photo card: logo ${box(PHOTO_IMAGE_BOXES.logo)}, partner ${box(PHOTO_IMAGE_BOXES.partner)}`,
      '```',
    ].join('\n')
  },
}

/** Every block of the document, rendered from the spec. */
export function renderBlocks(spec) {
  return Object.fromEntries(Object.entries(blocks).map(([name, render]) => [name, render(spec)]))
}

const markers = (name) => [`<!-- spec:${name} -->`, `<!-- /spec:${name} -->`]

/** The document with every block replaced by `rendered`. A marker that is missing or appears twice is an error: a block that cannot be found is never skipped. */
export function applyBlocks(doc, rendered) {
  let out = doc
  for (const [name, text] of Object.entries(rendered)) {
    const [open, close] = markers(name)
    const from = out.indexOf(open)
    const to = out.indexOf(close)
    if (from < 0 || to < from || out.indexOf(open, from + 1) >= 0 || out.indexOf(close, to + 1) >= 0)
      throw new Error(`docs/share-image-spec.md: the markers ${open} and ${close} must each appear exactly once, in that order`)
    out = `${out.slice(0, from + open.length)}\n${text}\n${out.slice(to)}`
  }
  return out
}

// Node resolves symlinks in `import.meta.url` but not in `argv[1]`, so the entry path is resolved too.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // The sources import each other as `./x.js` (the compiled names); Node strips types but does not map `.js` to `.ts`, so this does.
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context)
      } catch (error) {
        if (!specifier.startsWith('.') || !specifier.endsWith('.js')) throw error
        return next(`${specifier.slice(0, -3)}.ts`, context)
      }
    },
  })
  const spec = await import('../src/presets/spec.ts')
  const path = fileURLToPath(DOC)
  const doc = readFileSync(path, 'utf8')
  const next = applyBlocks(doc, renderBlocks(spec))
  if (process.argv.includes('--check')) {
    if (next !== doc) {
      console.error('docs/share-image-spec.md is stale: run `pnpm docs:spec`')
      process.exit(1)
    }
  } else if (next !== doc) {
    writeFileSync(path, next)
    console.log('docs/share-image-spec.md updated')
  }
}
