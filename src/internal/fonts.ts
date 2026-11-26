import { createHash } from 'node:crypto'
import * as fontkit from 'fontkit'

export type FontSpec = { family: string; weight?: number; style?: 'normal' | 'italic'; data: () => Promise<ArrayBuffer | Uint8Array> }
export type LoadedFont = {
  family: string
  weight: number
  style: 'normal' | 'italic'
  data: ArrayBuffer
  has(ch: string): boolean
  /** Advance width in thousandths of an em. */
  advance(ch: string): number
}
export type Stacks = Record<string, string[]>
/** A size on a ladder, optionally with the most lines it may take (`[112, 2]`). */
export type Step = number | readonly [size: number, maxLines: number]
export type Box = {
  width: number
  height: number
  leading: number
  maxLines?: number
  /**
   * Opt-in. Sizes to try, largest first (a number, or `[size, maxLines]`), instead of every second size from `maxSize` down;
   * the last one is the smallest, where a text that still does not fit is cut with an ellipsis.
   */
  sizes?: readonly Step[]
  /** Opt-in. Letter spacing in em, as the card sets it (`-0.02`): added to every character's advance when measuring. */
  tracking?: number
  /** Opt-in. Room in em kept under the last line (for descenders): a size fits when `lines * size * leading + size * descent <= height`. */
  descent?: number
  /** Opt-in. Take the next size down when it needs fewer lines (at most three at the larger one): one line instead of a lone word on the second. */
  fewerLines?: boolean
  /** Opt-in. Also report `width`: the narrowest width that keeps the line count, so the lines come out even. Set it as the text block's width. */
  balance?: boolean
} & ({ maxSize: number; minSize: number; sizes?: undefined } | { sizes: readonly Step[]; maxSize?: undefined; minSize?: undefined })

const WOFF2 = [0x77, 0x4f, 0x46, 0x32] // "wOF2"
/** Kerning is not applied, so a line is allowed 98% of its width, as the sites' own fitters did. */
const WIDTH_MARGIN = 0.98
const STEP = 2
/** Balancing tries widths from 60% of the box in steps of this, and adds a little slack for the kerning it does not see. */
const BALANCE_STEP = 8
const BALANCE_SLACK = 24
/** No card has a glyph taller than this; the cap also keeps `size - STEP` from rounding back to `size` (Number.MAX_VALUE). */
const MAX_FONT_SIZE = 2048

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')
const asBytes = (d: ArrayBuffer | Uint8Array) => (d instanceof Uint8Array ? d : new Uint8Array(d))

async function loadOne(spec: FontSpec): Promise<LoadedFont & { hash: string }> {
  // A family is named in a CSS `font-family` list (`ctx.font` joins a stack with commas), so it cannot hold a list separator or a quote.
  if (/[,"']/.test(spec.family))
    throw new Error(`payload-og-image: font family ${JSON.stringify(spec.family)} must not contain a comma or a quote`)
  const bytes = asBytes(await spec.data())
  if (WOFF2.every((b, i) => bytes[i] === b)) {
    throw new Error(`payload-og-image: font "${spec.family}" is WOFF2; satori cannot read WOFF2. Ship WOFF/TTF/OTF.`)
  }
  let parsed: ReturnType<typeof fontkit.create>
  try {
    parsed = fontkit.create(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  } catch (error) {
    throw new Error(`payload-og-image: font "${spec.family}" could not be parsed: ${(error as Error).message}`)
  }
  if ('fonts' in parsed) throw new Error(`payload-og-image: font "${spec.family}" is a font collection; register a single face`)
  const font = parsed
  const glyphOf = (ch: string) => font.glyphForCodePoint(ch.codePointAt(0) ?? 0)
  // A copy sized exactly to the face. (`Buffer#slice` is a view, so slicing would hand out a shared pool buffer.)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const data = copy.buffer
  return {
    family: spec.family,
    weight: spec.weight ?? 400,
    style: spec.style ?? 'normal',
    data,
    has: (ch) => font.hasGlyphForCodePoint(ch.codePointAt(0) ?? 0),
    advance: (ch) => (glyphOf(ch).advanceWidth / font.unitsPerEm) * 1000,
    hash: sha(bytes),
  }
}

/**
 * Reads every face once. The digest hashes (family, weight, style, bytes) of every face, so swapping
 * a font file changes every card URL.
 */
export async function loadFonts(specs: FontSpec[]): Promise<{ fonts: LoadedFont[]; digest: string }> {
  const loaded = await Promise.all(specs.map(loadOne))
  const seen = new Set<string>()
  for (const f of loaded) {
    const id = `${f.family}|${f.weight}|${f.style}`
    if (seen.has(id)) throw new Error(`payload-og-image: font face "${f.family}" ${f.weight} ${f.style} is registered twice`)
    seen.add(id)
  }
  const digest = sha(
    loaded
      .map((f) => `${f.family}|${f.weight}|${f.style}|${f.hash}`)
      .sort()
      .join('\n'),
  )
  return { fonts: loaded.map(({ hash: _hash, ...f }) => f), digest }
}

const facesOf = (fonts: LoadedFont[], family: string) => fonts.filter((f) => f.family === family)

/** The face a family is measured with: upright before italic, then the heaviest. Independent of registration order. */
const measuringFace = (fonts: LoadedFont[], family: string): LoadedFont | undefined =>
  facesOf(fonts, family).sort((a, b) => Number(a.style !== 'normal') - Number(b.style !== 'normal') || b.weight - a.weight)[0]
const covers = (faces: LoadedFont[], ch: string) => faces.some((f) => f.has(ch))

/**
 * The first family of the stack with ONE face that draws every character of the run: a whole-run swap, never
 * per-glyph mixing, and never a family whose faces only cover the run between them (a renderer picks one face).
 */
export function coveringFamily(fonts: LoadedFont[], stack: string[], text: string): string | null {
  const chars = [...text]
  for (const family of stack) {
    if (facesOf(fonts, family).some((face) => chars.every((ch) => face.has(ch)))) return family
  }
  return null
}

/**
 * The `font-family` value for a run of text. One family when a single face of it draws every character (a whole-run swap);
 * otherwise the stack's registered families in order, which the renderer resolves glyph by glyph (the first family that has the
 * glyph draws it). Characters no family draws are not this function's business: they are removed before drawing.
 */
export function fontFamilyFor(fonts: LoadedFont[], stack: string[], text: string): string {
  const one = coveringFamily(fonts, stack, text)
  if (one !== null) return one
  const present = stack.filter((family) => facesOf(fonts, family).length > 0)
  return present.length > 0 ? present.join(', ') : (stack[0] as string)
}

/** Characters (each once, in order) that no face of any family in the stack draws. */
export function missingGlyphs(fonts: LoadedFont[], stack: string[], text: string): string[] {
  const faces = stack.flatMap((family) => facesOf(fonts, family))
  return [...new Set([...text].filter((ch) => !covers(faces, ch)))]
}

/**
 * The width in px of `text` on one line at `size`: each character measured with the first family of the stack that draws it, in that
 * family's face nearest to `weight` (upright before italic). `tracking` (em) is added to every character, as the card sets it.
 */
export function measureText(
  fonts: LoadedFont[],
  stack: string[],
  text: string,
  size: number,
  o: { weight?: number; tracking?: number } = {},
): number {
  const weight = o.weight ?? 400
  const faces = stack.flatMap((family) => {
    const nearest = facesOf(fonts, family).sort(
      (a, b) => Number(a.style !== 'normal') - Number(b.style !== 'normal') || Math.abs(a.weight - weight) - Math.abs(b.weight - weight),
    )[0]
    return nearest ? [nearest] : []
  })
  const first = faces[0]
  if (!first) throw new Error(`payload-og-image: measureText: font family "${stack[0]}" is not registered`)
  const tracking = o.tracking ?? 0
  const em = [...text].reduce((sum, ch) => sum + (faces.find((f) => f.has(ch)) ?? first).advance(ch) / 1000 + tracking, 0)
  return em * size
}

/** The text without the characters nothing in the stack draws: never tofu, never a blank card. */
export function stripMissing(fonts: LoadedFont[], stack: string[], text: string): { text: string; missing: string[] } {
  const missing = missingGlyphs(fonts, stack, text)
  if (missing.length === 0) return { text, missing }
  const gone = new Set(missing)
  return { text: [...text].filter((ch) => !gone.has(ch)).join(''), missing }
}

type Layout = { lines: number; broke: boolean }

/** The face that measures (and, in a stack, draws) a character. */
type FaceOf = (ch: string) => LoadedFont

/** Greedy wrap by real advance widths. `broke` means a single word is wider than a line. */
function layout(faceOf: FaceOf, words: string[], size: number, width: number, tracking = 0): Layout {
  const limit = width * WIDTH_MARGIN
  // Without tracking the sum is the one it always was, so no existing layout moves by a rounding step.
  const wide = (s: string) =>
    tracking === 0
      ? ([...s].reduce((em, ch) => em + faceOf(ch).advance(ch), 0) / 1000) * size
      : [...s].reduce((em, ch) => em + faceOf(ch).advance(ch) / 1000 + tracking, 0) * size
  const space = wide(' ')
  let lines = 1
  let used = 0
  let broke = false
  for (const word of words) {
    const w = wide(word)
    if (w > limit) broke = true
    if (used > 0 && used + space + w <= limit) used += space + w
    else {
      if (used > 0) lines += 1
      used = w
    }
  }
  return { lines, broke }
}

/** The ladder of sizes to try, largest first, each with the most lines it may take (none: unlimited). */
function ladderOf(box: Box): { size: number; lines?: number }[] {
  if (box.sizes !== undefined) return box.sizes.map((st) => (typeof st === 'number' ? { size: st } : { size: st[0], lines: st[1] }))
  const out: { size: number }[] = []
  const max = box.maxSize as number
  const min = box.minSize as number
  for (let size = max; ; ) {
    out.push({ size })
    const next = Math.max(min, size - STEP)
    if (next >= size) break // the step must change the size, or the loop would never end
    size = next
  }
  return out
}

/** Every number finite and positive, minSize <= maxSize, a ladder descending: anything else would make the size loop never end. */
function assertBox(box: Box): void {
  const positive = (what: string, v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
      throw new Error(`payload-og-image: fitText: ${what} must be a finite number above 0, got ${String(v)}`)
  }
  for (const k of ['width', 'height', 'leading'] as const) positive(`box.${k}`, box[k])
  if (box.maxLines !== undefined && (!Number.isInteger(box.maxLines) || box.maxLines < 1)) {
    throw new Error(`payload-og-image: fitText: box.maxLines must be an integer of at least 1, got ${box.maxLines}`)
  }
  if (box.tracking !== undefined && !Number.isFinite(box.tracking))
    throw new Error(`payload-og-image: fitText: box.tracking must be a finite number, got ${String(box.tracking)}`)
  if (box.descent !== undefined && (!Number.isFinite(box.descent) || box.descent < 0))
    throw new Error(`payload-og-image: fitText: box.descent must be a finite number of at least 0, got ${String(box.descent)}`)
  if (box.sizes !== undefined) {
    if (box.maxSize !== undefined || box.minSize !== undefined)
      throw new Error('payload-og-image: fitText: box.sizes replaces maxSize and minSize: give the ladder or the two, not both')
    if (!Array.isArray(box.sizes) || box.sizes.length === 0)
      throw new Error('payload-og-image: fitText: box.sizes must list at least one size')
    let prev = Number.POSITIVE_INFINITY
    for (const st of box.sizes) {
      const [size, lines] = typeof st === 'number' ? [st, undefined] : st
      positive('a size in box.sizes', size)
      if (size > MAX_FONT_SIZE)
        throw new Error(`payload-og-image: fitText: a size in box.sizes must be at most ${MAX_FONT_SIZE}, got ${size}`)
      if (size >= prev) throw new Error('payload-og-image: fitText: box.sizes must descend (largest first, no repeats)')
      if (lines !== undefined && (!Number.isInteger(lines) || lines < 1))
        throw new Error(
          `payload-og-image: fitText: the lines of a size in box.sizes must be an integer of at least 1, got ${String(lines)}`,
        )
      prev = size
    }
    return
  }
  positive('box.maxSize', box.maxSize)
  positive('box.minSize', box.minSize)
  if ((box.maxSize as number) > MAX_FONT_SIZE)
    throw new Error(`payload-og-image: fitText: box.maxSize must be at most ${MAX_FONT_SIZE}, got ${box.maxSize}`)
  if ((box.minSize as number) > (box.maxSize as number)) throw new Error('payload-og-image: fitText: minSize is larger than maxSize')
}

type Fitted = { size: number; lines: number; text: string; width?: number }

const fits = (l: Layout, size: number, box: Box, cap?: number) =>
  !l.broke &&
  l.lines * size * box.leading + size * (box.descent ?? 0) <= box.height &&
  (box.maxLines === undefined || l.lines <= box.maxLines) &&
  (cap === undefined || l.lines <= cap)

/** Measures with one family, or with a stack: each character with the first family that has it (as the renderer draws it). */
function faceOfFamily(fonts: LoadedFont[], family: string | string[]): FaceOf {
  if (typeof family === 'string') {
    const face = measuringFace(fonts, family)
    if (!face) throw new Error(`payload-og-image: fitText: font family "${family}" is not registered`)
    return () => face
  }
  const faces = family.flatMap((f) => measuringFace(fonts, f) ?? [])
  const first = faces[0]
  if (!first) throw new Error(`payload-og-image: fitText: font family "${family[0]}" is not registered`)
  return (ch) => faces.find((f) => f.has(ch)) ?? first
}

/**
 * The largest size on the box's ladder (by default every second size from `maxSize` down) at which `text` wraps within the
 * box, using the face's advance widths. At the smallest size a text that still does not fit is cut with an ellipsis. A stack
 * (an array) measures each character with the first family that draws it. `tracking`, `descent`, `fewerLines` and `balance`
 * are opt-in; a box without them measures and answers exactly as before.
 */
export function fitText(fonts: LoadedFont[], family: string | string[], text: string, box: Box): Fitted {
  const faceOf = faceOfFamily(fonts, family)
  assertBox(box)
  const ladder = ladderOf(box)
  const smallest = ladder[ladder.length - 1] as { size: number; lines?: number }
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean === '') return { size: ladder[0]?.size as number, lines: 0, text: '' }
  const words = clean.split(' ')
  const tracking = box.tracking ?? 0
  const at = (size: number, width = box.width) => layout(faceOf, words, size, width, tracking)
  const done = (size: number, l: Layout): Fitted => {
    if (!box.balance) return { size, lines: l.lines, text: clean }
    let width = box.width
    if (l.lines > 1) {
      for (let w = Math.round(box.width * 0.6); w < box.width; w += BALANCE_STEP) {
        const b = at(size, w)
        if (b.lines === l.lines && !b.broke) {
          width = Math.min(box.width, w + BALANCE_SLACK)
          break
        }
      }
    }
    return { size, lines: l.lines, text: clean, width }
  }
  for (let i = 0; i < ladder.length; i++) {
    const step = ladder[i] as { size: number; lines?: number }
    const l = at(step.size)
    if (!fits(l, step.size, box, step.lines)) continue
    const next = ladder[i + 1]
    if (box.fewerLines && next && l.lines <= 3) {
      const n = at(next.size)
      if (n.lines < l.lines && fits(n, next.size, box, next.lines)) return done(next.size, n)
    }
    return done(step.size, l)
  }
  return ellipsize(faceOf, clean, box, smallest, tracking)
}

/** The longest prefix that fits at the smallest size, cut at a word when there is one, followed by an ellipsis. */
function ellipsize(faceOf: FaceOf, clean: string, box: Box, smallest: { size: number; lines?: number }, tracking: number): Fitted {
  const mark = faceOf('…').has('…') ? '…' : '...'
  const size = smallest.size
  const wrap = (lines: number, text: string): Fitted => (box.balance ? { size, lines, text, width: box.width } : { size, lines, text })
  const attempt = (candidate: string) => {
    const l = layout(faceOf, candidate.split(' '), size, box.width, tracking)
    return fits(l, size, box, smallest.lines) ? wrap(l.lines, candidate) : null
  }
  const words = clean.split(' ')
  for (let n = words.length - 1; n >= 1; n--) {
    const hit = attempt(`${words.slice(0, n).join(' ')}${mark}`)
    if (hit) return hit
  }
  const chars = [...(words[0] ?? '')]
  for (let n = chars.length - 1; n >= 1; n--) {
    const hit = attempt(`${chars.slice(0, n).join('')}${mark}`)
    if (hit) return hit
  }
  return wrap(0, '')
}
