/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a character the renderer would fetch a CDN font for.
 * - sanitize.ts:48  a mark must be in SOME face with the base, not EVERY one (`faces.every` -> `faces.some`) -> "a mark missing from one face that has the base is dropped and reported" RED
 * - sanitize.ts:48  drop every mark of a cluster -> "a mark every face with the base has is kept" RED
 * - sanitize.ts:48  exempt ZWNJ/ZWJ/VS15/VS16 from the every-face rule -> "are dropped, and reported, when a face with the base lacks them" RED (satori fetches a font for the cluster)
 * - sanitize.ts:42  judge a cluster by its marks alone (skip the first-character check) -> "a cluster whose first character no face draws is dropped whole" RED */
import { describe, expect, it, vi } from 'vitest'
import type { LoadedFont } from '../../src/internal/fonts.js'
import { stripUndrawable } from '../../src/internal/sanitize.js'
import { nextOgRenderer } from '../../src/render/nextOg.js'
import { loadTestFonts } from '../helpers.js'

const face = (family: string, chars: string): LoadedFont => ({
  family,
  weight: 400,
  style: 'normal',
  data: new ArrayBuffer(0),
  has: (ch) => chars.includes(ch),
  advance: () => 500,
})
const MARK = '́'
const text = async (t: string, fonts: LoadedFont[]) => {
  const out = await stripUndrawable({ type: 'div', props: { children: t } }, fonts)
  return { text: (out.node as { props: { children: string } }).props.children, dropped: out.dropped }
}

// `x` + U+0301 has no composed form, so NFC leaves the cluster as it is.
describe('a combining mark in a cluster', () => {
  it('a mark every face with the base has is kept', async () => {
    expect(await text(`x${MARK}`, [face('A', `x${MARK}`), face('B', `x${MARK}`)])).toEqual({ text: `x${MARK}`, dropped: [] })
    // A face without the base does not count: the renderer never looks there for this cluster.
    expect(await text(`x${MARK}`, [face('A', `x${MARK}`), face('B', 'y')])).toEqual({ text: `x${MARK}`, dropped: [] })
  })

  it('a mark missing from one face that has the base is dropped and reported', async () => {
    // The renderer picks the face by the base letter alone, so it may look in the one without the mark and fetch a font.
    expect(await text(`x${MARK}`, [face('A', `x${MARK}`), face('B', 'x')])).toEqual({ text: 'x', dropped: [MARK] })
  })

  it('a cluster whose first character no face draws is dropped whole', async () => {
    expect(await text(`q${MARK}`, [face('A', MARK), face('B', 'x')])).toEqual({ text: '', dropped: ['q', MARK] })
  })

  it('a text with no mark problem is returned as the same node', async () => {
    const node = { type: 'div', props: { children: 'xx' } }
    expect((await stripUndrawable(node, [face('A', 'x')])).node).toBe(node)
  })
})

describe('joiners and variation selectors inside a cluster', () => {
  // ZWNJ, ZWJ, VS15, VS16: a face that has them draws nothing for them and shaping needs them.
  const JOINERS = '‌‍︎️'
  it('are kept when every face with the base has them', async () => {
    for (const j of JOINERS) expect(await text(`x${j}y`, [face('A', `xy${JOINERS}`)])).toEqual({ text: `x${j}y`, dropped: [] })
  })

  it('are dropped, and reported, when a face with the base lacks them: the renderer would fetch a font for the cluster', async () => {
    // Measured against next/og 16.4.6 with the fixture faces: `a` + U+200D, U+200C, U+FE0F or U+FE0E all make it fetch fonts.googleapis.com,
    // whichever face draws the `a`. Keeping a joiner no face has would turn a card into a render_error, not a better card.
    for (const j of JOINERS) expect(await text(`x${j}y`, [face('A', 'xy')])).toEqual({ text: 'xy', dropped: [j] })
    const { fonts } = await loadTestFonts()
    const real = globalThis.fetch
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('data:') ? real(input, init) : new Response(''),
    )
    vi.stubGlobal('fetch', fetchSpy)
    try {
      for (const j of JOINERS) {
        const out = await stripUndrawable(
          { type: 'div', props: { style: { display: 'flex', fontFamily: 'Archivo' }, children: `a${j}b` } },
          fonts,
        )
        await expect(
          nextOgRenderer({ palette: false }).render(out.node as never, { width: 200, height: 80, fonts }),
        ).resolves.toBeInstanceOf(Uint8Array)
      }
      expect(fetchSpy.mock.calls.filter(([u]) => !String(u).startsWith('data:'))).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
