/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a swapped font keeps the URL; a missing glyph draws tofu.
 * - fonts.ts:27   drop the wOF2 check                               -> "rejects WOFF2 naming the family" RED
 * - fonts.ts:66  leave the file hash out of the digest             -> "digest changes when a face file changes" RED
 * - fonts.ts:61     allow the same family/weight/style twice          -> "rejects a face registered twice" RED
 * - fonts.ts:81   coveringFamily uses `some` instead of `every`     -> "whole-run swap" RED
 * - fonts.ts:88   missingGlyphs looks only at the first family      -> "reports and strips chars no face draws" RED
 * - fonts.ts:47     advance() ignores unitsPerEm (raw font units)     -> "advances match the fontTools oracle" RED
 * - fonts.ts:112   fit ignores a word wider than the line            -> "shrinks for a word wider than a line instead of breaking it" RED
 * - fonts.ts:141 fitText returns the uncut text at minSize         -> "cuts with an ellipsis at minSize" RED */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { coveringFamily, fitText, loadFonts, missingGlyphs, stripMissing } from '../../src/internal/fonts.js'

const file = (n: string) => () => readFile(new URL(`../fixtures/fonts/${n}`, import.meta.url))
const specs = [
  { family: 'Archivo', weight: 600, data: file('archivo-latin-600.woff') },
  { family: 'Inter', weight: 800, data: file('inter-latin-cyrillic-800.woff') },
]
const loaded = loadFonts(specs)
const STACK = ['Archivo', 'Inter']

describe('fonts', () => {
  it('whole-run swap', async () => {
    const { fonts } = await loaded
    expect(coveringFamily(fonts, STACK, 'Hello')).toBe('Archivo')
    expect(coveringFamily(fonts, STACK, 'Привет, «мир» — №1')).toBe('Inter')
    expect(coveringFamily(fonts, STACK, 'Hi 🚀')).toBeNull()
  })
  it('reports and strips chars no face draws (emoji included)', async () => {
    const { fonts } = await loaded
    expect(missingGlyphs(fonts, STACK, 'Hi 🚀🚀')).toEqual(['🚀'])
    expect(stripMissing(fonts, STACK, 'Hi 🚀').text).toBe('Hi ')
    expect(stripMissing(fonts, STACK, 'Привет').missing).toEqual([])
    // A char only the SECOND family draws is not missing: the whole stack counts.
    expect(missingGlyphs(fonts, ['Archivo', 'Inter'], 'Привет')).toEqual([])
    expect(missingGlyphs(fonts, ['Archivo'], 'Привет')).toEqual([...new Set([...'Привет'])])
  })
  it('advances match the fontTools oracle', async () => {
    const { fonts } = await loaded
    const oracle = JSON.parse(await readFile(new URL('../fixtures/fonts/inter-advances.fonttools.json', import.meta.url), 'utf8')) as {
      chars: string
      widths: number[]
    }
    const inter = fonts.find((f) => f.family === 'Inter')
    const chars = [...oracle.chars]
    expect(chars.length).toBeGreaterThan(200)
    for (const [i, ch] of chars.entries()) {
      expect(Math.round(inter?.advance(ch) ?? -1), `advance of ${JSON.stringify(ch)}`).toBe(oracle.widths[i])
    }
  })
  it('fits within bounds', async () => {
    const { fonts } = await loaded
    const box = { width: 560, height: 300, maxSize: 96, minSize: 40, leading: 1, maxLines: 4 }
    expect(fitText(fonts, 'Inter', 'Short', box).size).toBe(96)
    const long = fitText(fonts, 'Inter', 'A considerably longer headline that must wrap onto several lines', box)
    expect(long.size).toBeLessThan(96)
    expect(long.size).toBeGreaterThanOrEqual(40)
    expect(long.lines).toBeLessThanOrEqual(4)
  })
  it('shrinks for a word wider than a line instead of breaking it', async () => {
    const { fonts } = await loaded
    const r = fitText(fonts, 'Inter', 'Supercalifragilisticexpialidocious', {
      width: 400,
      height: 400,
      maxSize: 96,
      minSize: 24,
      leading: 1,
    })
    expect(r.lines).toBe(1)
    expect(r.size).toBeLessThan(96)
  })
  it('cuts with an ellipsis at minSize when the text still does not fit', async () => {
    const { fonts } = await loaded
    const text = 'An extremely long headline that cannot possibly fit into two short lines at the smallest size allowed here'
    const box = { width: 400, height: 200, maxSize: 60, minSize: 40, leading: 1, maxLines: 2 }
    const r = fitText(fonts, 'Inter', text, box)
    expect(r.size).toBe(40)
    expect(r.lines).toBeLessThanOrEqual(2)
    expect(r.text.endsWith('…')).toBe(true)
    expect(text.startsWith(r.text.slice(0, -1))).toBe(true)
  })
  it('handles empty text and an unregistered family', async () => {
    const { fonts } = await loaded
    expect(fitText(fonts, 'Inter', '   ', { width: 100, height: 100, maxSize: 50, minSize: 20, leading: 1 })).toEqual({
      size: 50,
      lines: 0,
      text: '',
    })
    expect(() => fitText(fonts, 'Nope', 'x', { width: 100, height: 100, maxSize: 50, minSize: 20, leading: 1 })).toThrow(
      /"Nope" is not registered/,
    )
  })
  it('digest changes when a face file changes, and is stable otherwise', async () => {
    const a = await loadFonts(specs)
    const b = await loadFonts(specs)
    const c = await loadFonts([specs[0], { ...specs[1], data: file('archivo-latin-600.woff') }])
    expect(a.digest).toBe(b.digest)
    expect(c.digest).not.toBe(a.digest)
    expect((await loadFonts([...specs].reverse())).digest).toBe(a.digest)
  })
  it('keeps the face bytes exactly', async () => {
    const { fonts } = await loaded
    expect(fonts.find((f) => f.family === 'Inter')?.data.byteLength).toBe((await file('inter-latin-cyrillic-800.woff')()).byteLength)
  })
  it('rejects WOFF2 naming the family', async () =>
    expect(loadFonts([{ family: 'X', data: async () => new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]) }])).rejects.toThrow(
      /X.*WOFF2/,
    ))
  it('rejects bytes that are not a font, naming the family', async () =>
    expect(loadFonts([{ family: 'Bad', data: async () => new Uint8Array(64) }])).rejects.toThrow(/"Bad" could not be parsed/))
  it('rejects a face registered twice', async () =>
    expect(loadFonts([specs[1] as (typeof specs)[number], specs[1] as (typeof specs)[number]])).rejects.toThrow(
      /"Inter" 800 normal is registered twice/,
    ))
})
