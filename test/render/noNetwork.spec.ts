/** Mutation table (production line -> the test that goes RED). Silent-failure surface: text leaving the host through a CDN request, a render that depends on a CDN.
 * - nextOg.ts:23  draw outside `withoutNetwork` -> "a character no face draws is never fetched: the draw is refused, not sent" RED (the spy is called)
 * - noNetwork.ts:53  do not throw when a refusal was swallowed (a font download) -> "a refused font download fails the draw (the renderer would carry on with tofu)" RED
 * - noNetwork.ts:10  refuse `data:` URLs too -> "a clean card renders: the renderer reads its own WebAssembly from a data: URL" RED
 * - noNetwork.ts:32  refuse outside a draw -> "fetch outside a draw passes through untouched" RED */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextOgRenderer } from '../../src/render/nextOg.js'
import { loadTestFonts } from '../helpers.js'

const el = (children: string) =>
  ({ type: 'div', props: { style: { display: 'flex', fontSize: 48, fontFamily: 'Archivo' }, children } }) as never
const SIZE = { width: 400, height: 120 }

describe('the renderer makes no network request', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  /** A fetch that records every call; a `data:` URL (the renderer's own WebAssembly) is served for real, anything else would answer 200. */
  const offline = () => {
    const real = globalThis.fetch
    const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('data:') ? real(input, init) : new Response('x'),
    )
    vi.stubGlobal('fetch', spy)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    return { calls: () => spy.mock.calls.map(([u]) => String(u)).filter((u) => !u.startsWith('data:')) }
  }

  it('a clean card renders: the renderer reads its own WebAssembly from a data: URL', async () => {
    const { fonts } = await loadTestFonts()
    const net = offline()
    const png = await nextOgRenderer({ palette: false }).render(el('Hello'), { ...SIZE, fonts })
    expect(png.byteLength).toBeGreaterThan(0)
    expect(net.calls()).toEqual([])
  })

  it('a character no face draws is never fetched: the draw is refused, not sent', async () => {
    const { fonts } = await loadTestFonts()
    const net = offline()
    // "日本語" makes next/og ask fonts.googleapis.com, "🚀" asks cdn.jsdelivr.net: neither may leave.
    await expect(nextOgRenderer().render(el('🚀 launch'), { ...SIZE, fonts })).rejects.toThrow(/tried to fetch from cdn\.jsdelivr\.net/)
    await expect(nextOgRenderer().render(el('日本語'), { ...SIZE, fonts })).rejects.toThrow(/tried to fetch from fonts\.googleapis\.com/)
    expect(net.calls()).toEqual([])
  })

  it('a refused font download fails the draw (the renderer would carry on with tofu)', async () => {
    const { fonts } = await loadTestFonts()
    offline()
    // next/og swallows a failed font download and returns the card without the glyphs: the guard must not let that pass.
    await expect(nextOgRenderer().render(el('日本語'), { ...SIZE, fonts })).rejects.toThrow(/tried to fetch from fonts\.googleapis\.com/)
  })

  it('the refusal names the host and never the text', async () => {
    const { fonts } = await loadTestFonts()
    offline()
    const error = await nextOgRenderer()
      .render(el('機密'), { ...SIZE, fonts })
      .catch((e: Error) => e)
    expect((error as Error).message).toContain('fonts.googleapis.com')
    expect((error as Error).message).not.toContain('機')
    // the font request carries the text in its query: it must not reach the message
    expect((error as Error).message).not.toContain(encodeURIComponent('機'))
  })

  it('fetch outside a draw passes through untouched', async () => {
    const { fonts } = await loadTestFonts()
    const net = offline()
    await nextOgRenderer({ palette: false }).render(el('Hello'), { ...SIZE, fonts }) // installs the guard over the spy
    await fetch('https://example.test/other')
    expect(net.calls()).toEqual(['https://example.test/other'])
  })
})
