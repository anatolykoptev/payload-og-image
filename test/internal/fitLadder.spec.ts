/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a layout that drifts from the design it replaces moves every card with no error.
 * - fonts.ts `tracking` left out of `wide` -> "agrees with a hand-rolled ladder fitter on a corpus of titles" RED
 * - fonts.ts `descent` left out of `fits` -> same test RED, and "descent keeps room under the last line" RED
 * - fonts.ts `fewerLines` branch removed -> same test RED
 * - fonts.ts `balance` width search removed -> same test RED, and "balance narrows a wrapped title" RED
 * - fonts.ts `step.lines` cap ignored in `fits` -> "a ladder step can cap its lines" RED
 * - fonts.ts the tracking === 0 branch of `wide` replaced by the summed form -> "a box with none of the new options answers as before" may move on a boundary (guarded by the corpus in fonts.spec) */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { fitText, loadFonts } from '../../src/internal/fonts.js'

const file = (n: string) => () => readFile(new URL(`../fixtures/fonts/${n}`, import.meta.url))
const loaded = loadFonts([
  { family: 'Archivo', weight: 600, data: file('archivo-latin-600.woff') },
  { family: 'Inter', weight: 800, data: file('inter-latin-cyrillic-800.woff') },
])

const SIZES = [104, 96, 88, 80, 72, 66, 60, 54, 50, 46, 42]
const TRACKING = -0.02
const LEADING = 0.98
const DESCENT = 0.14
const BOX = { width: 760, height: 360 }

/**
 * The oracle: a site's own title fitter written out on its own (greedy wrap by advance widths with tracking, a size ladder,
 * a descender allowance, "one step smaller if it takes a line less", and the narrowest width that keeps the line count).
 * It shares no code with `fitText`.
 */
const siteFitter = (advance: (ch: string) => number, text: string) => {
  const measure = (s: string, size: number) => [...s].reduce((em, ch) => em + advance(ch) / 1000 + TRACKING, 0) * size
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const wrap = (size: number, width: number) => {
    const limit = width * 0.98
    const space = measure(' ', size)
    let lines = 1
    let used = 0
    for (const word of words) {
      let w = measure(word, size)
      if (used > 0 && used + space + w <= limit) {
        used += space + w
        continue
      }
      if (used > 0) lines += 1
      while (w > limit) {
        lines += 1 // a word wider than the line is broken, as the site's card breaks it
        w -= limit
      }
      used = w
    }
    return lines
  }
  const longest = (size: number) => Math.max(...words.map((w) => measure(w, size)))
  const fits = (size: number, lines: number) => lines * size * LEADING + size * DESCENT <= BOX.height && longest(size) <= BOX.width * 0.98
  const at = SIZES.findIndex((s) => fits(s, wrap(s, BOX.width)))
  if (at === -1) return null // the site ellipsizes or breaks words here: outside what the ladder decides
  let size = SIZES[at] as number
  let lines = wrap(size, BOX.width)
  const smaller = SIZES[at + 1]
  if (smaller && lines <= 3 && wrap(smaller, BOX.width) < lines) {
    size = smaller
    lines = wrap(size, BOX.width)
  }
  let width = BOX.width
  if (lines > 1) {
    for (let w = Math.round(BOX.width * 0.6); w < BOX.width; w += 8) {
      if (wrap(size, w) === lines) {
        width = Math.min(BOX.width, w + 24)
        break
      }
    }
  }
  return { size, lines, width }
}

const TITLES = [
  'queue Notes fast', // a size smaller takes a line less: 96 px on one line, not 104 on two
  'cards queue production week',
  'Ship',
  'A short title',
  'Notes on production AI infrastructure',
  'How we cut the p99 of a hot path by a third without touching the database',
  'Things I build and run, and the reasons they are built this way',
  'Why a boring queue beats a clever one when the pager is yours',
  'One two three four five six seven eight nine ten eleven twelve',
  'Привет, мир: заметки об инфраструктуре',
  'Как мы сократили время ответа вдвое и ничего не сломали в продакшене',
  'Eighteen months of running a card renderer in production: what broke, what did not, and what we would change',
]

describe('ctx.fit ladder options', () => {
  it('agrees with a hand-rolled ladder fitter on a corpus of titles', async () => {
    const { fonts } = await loaded
    let compared = 0
    for (const title of TITLES) {
      const family = /[Ѐ-ӿ]/.test(title) ? 'Inter' : 'Archivo'
      const face = fonts.find((f) => f.family === family)
      if (!face) throw new Error('fixture face missing')
      const want = siteFitter((ch) => face.advance(ch), title)
      if (!want) continue
      const got = fitText(fonts, family, title, {
        ...BOX,
        sizes: SIZES,
        leading: LEADING,
        tracking: TRACKING,
        descent: DESCENT,
        fewerLines: true,
        balance: true,
      })
      expect({ title, size: got.size, lines: got.lines, width: got.width }).toEqual({ title, ...want })
      compared += 1
    }
    expect(compared).toBeGreaterThanOrEqual(8) // the corpus is not vacuous: nearly every title is decided by the ladder
  })

  it('fewerLines takes the smaller size that needs a line less, and only then', async () => {
    const { fonts } = await loaded
    const box = { ...BOX, sizes: SIZES, leading: LEADING, tracking: TRACKING, descent: DESCENT }
    const calm = fitText(fonts, 'Archivo', 'queue Notes fast', { ...box, fewerLines: true })
    const plain = fitText(fonts, 'Archivo', 'queue Notes fast', box)
    expect([plain.size, plain.lines, calm.size, calm.lines]).toEqual([104, 2, 96, 1])
    expect(fitText(fonts, 'Archivo', 'Ship', { ...box, fewerLines: true })).toEqual(fitText(fonts, 'Archivo', 'Ship', box))
  })
  it('a box with none of the new options answers as before: no width, steps of 2', async () => {
    const { fonts } = await loaded
    const r = fitText(fonts, 'Archivo', 'Notes on production AI infrastructure', {
      width: 600,
      height: 300,
      maxSize: 100,
      minSize: 20,
      leading: 1.1,
    })
    expect(Object.keys(r).sort()).toEqual(['lines', 'size', 'text'])
    expect(r.size % 2).toBe(0)
  })

  it('a ladder step can cap its lines', async () => {
    const { fonts } = await loaded
    const text = 'Notes on production AI infrastructure and what we learned'
    const box = { width: 600, height: 900, leading: 1 }
    const free = fitText(fonts, 'Archivo', text, { ...box, sizes: [100, 80, 60, 40] })
    // The same ladder with a one-line cap on every step above 40: only the last step may wrap.
    const capped = fitText(fonts, 'Archivo', text, { ...box, sizes: [[100, 1], [80, 1], [60, 1], 40] })
    expect(free.lines).toBeGreaterThan(1)
    expect(free.size).toBeGreaterThan(40)
    expect(capped.size).toBe(40)
  })

  it('descent keeps room under the last line', async () => {
    const { fonts } = await loaded
    const base = { width: 2000, height: 100, leading: 1, sizes: [100, 90, 80] }
    expect(fitText(fonts, 'Archivo', 'One line', base).size).toBe(100)
    expect(fitText(fonts, 'Archivo', 'One line', { ...base, descent: 0.14 }).size).toBe(80) // 100 * 1.14 > 100, 90 * 1.14 > 100, 80 * 1.14 <= 100
  })

  it('tracking narrows what a line holds', async () => {
    const { fonts } = await loaded
    const box = { width: 700, height: 4000, leading: 1, sizes: [48] }
    const text = 'Notes on production AI infrastructure'
    expect(fitText(fonts, 'Archivo', text, { ...box, tracking: -0.1 }).lines).toBeLessThan(
      fitText(fonts, 'Archivo', text, { ...box, tracking: 0.1 }).lines,
    )
  })

  it('balance narrows a wrapped title and leaves a one-line title at the full width', async () => {
    const { fonts } = await loaded
    const box = { width: 700, height: 2000, leading: 1, sizes: [60], balance: true }
    const wrapped = fitText(fonts, 'Archivo', 'Notes on production AI infrastructure and what we learned from it', box)
    expect(wrapped.lines).toBeGreaterThan(1)
    expect(wrapped.width).toBeLessThan(700)
    expect(fitText(fonts, 'Archivo', 'Short', box).width).toBe(700)
  })

  it('refuses a ladder that does not descend, an empty one, and bad options, naming them', async () => {
    const { fonts } = await loaded
    const box = { width: 600, height: 300, leading: 1 }
    const bad = (extra: object) => () => fitText(fonts, 'Archivo', 'x', { ...box, ...extra } as never)
    expect(bad({ sizes: [] })).toThrow(/at least one size/)
    expect(bad({ sizes: [40, 60] })).toThrow(/must descend/)
    expect(bad({ sizes: [[60, 0]] })).toThrow(/lines of a size/)
    expect(bad({ sizes: [60], tracking: Number.NaN })).toThrow(/tracking/)
    expect(bad({ sizes: [60], descent: -1 })).toThrow(/descent/)
  })
})
