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
export type Box = { width: number; height: number; maxSize: number; minSize: number; leading: number; maxLines?: number }

const WOFF2 = [0x77, 0x4f, 0x46, 0x32] // "wOF2"
/** Kerning is not applied, so a line is allowed 98% of its width, as the sites' own fitters did. */
const WIDTH_MARGIN = 0.98
const STEP = 2
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
function layout(faceOf: FaceOf, words: string[], size: number, width: number): Layout {
  const limit = width * WIDTH_MARGIN
  const wide = (s: string) => ([...s].reduce((em, ch) => em + faceOf(ch).advance(ch), 0) / 1000) * size
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

/** Every number finite and positive, minSize <= maxSize: anything else would make the size loop never end. */
function assertBox(box: Box): void {
  for (const k of ['width', 'height', 'maxSize', 'minSize', 'leading'] as const) {
    if (!Number.isFinite(box[k]) || box[k] <= 0)
      throw new Error(`payload-og-image: fitText: box.${k} must be a finite number above 0, got ${box[k]}`)
  }
  if (box.maxSize > MAX_FONT_SIZE)
    throw new Error(`payload-og-image: fitText: box.maxSize must be at most ${MAX_FONT_SIZE}, got ${box.maxSize}`)
  if (box.minSize > box.maxSize) throw new Error('payload-og-image: fitText: minSize is larger than maxSize')
  if (box.maxLines !== undefined && (!Number.isInteger(box.maxLines) || box.maxLines < 1)) {
    throw new Error(`payload-og-image: fitText: box.maxLines must be an integer of at least 1, got ${box.maxLines}`)
  }
}

const fits = (l: Layout, size: number, box: Box) =>
  !l.broke && l.lines * size * box.leading <= box.height && (box.maxLines === undefined || l.lines <= box.maxLines)

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
 * The largest size from `maxSize` down (steps of 2) at which `text` wraps within the box, using the face's
 * advance widths. At `minSize` a text that still does not fit is cut with an ellipsis. A stack (an array) measures each
 * character with the first family that draws it.
 */
export function fitText(
  fonts: LoadedFont[],
  family: string | string[],
  text: string,
  box: Box,
): { size: number; lines: number; text: string } {
  const faceOf = faceOfFamily(fonts, family)
  assertBox(box)
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean === '') return { size: box.maxSize, lines: 0, text: '' }
  const words = clean.split(' ')
  for (let size = box.maxSize; ; ) {
    const l = layout(faceOf, words, size, box.width)
    if (fits(l, size, box)) return { size, lines: l.lines, text: clean }
    const next = Math.max(box.minSize, size - STEP)
    if (next >= size) break // the step must change the size, or the loop would never end
    size = next
  }
  return ellipsize(faceOf, clean, box)
}

/** The longest prefix that fits at `minSize`, cut at a word when there is one, followed by an ellipsis. */
function ellipsize(faceOf: FaceOf, clean: string, box: Box): { size: number; lines: number; text: string } {
  const mark = faceOf('…').has('…') ? '…' : '...'
  const size = box.minSize
  const attempt = (candidate: string) => {
    const l = layout(faceOf, candidate.split(' '), size, box.width)
    return fits(l, size, box) ? { size, lines: l.lines, text: candidate } : null
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
  return { size, lines: 0, text: '' }
}
