/** Mutation table (production line -> the test that goes RED). Silent-failure surface: text from a draft leaving the host through the renderer's CDN fetches.
 * - draw.ts:35  hand the renderer the element as the template drew it (no `stripUndrawable`) -> "text no face draws, from a prop outside textFields and from the template itself, is removed, reported and never fetched" RED
 * - draw.ts:35  same -> "a preview reports what was removed from the template, not only from textFields" RED
 * - draw.ts:22  `ctx.font` returns the first family when no single one covers the run -> "(#38) a run no single family draws is drawn glyph by glyph across the stack" RED
 * - fonts.ts:177  measure a mixed run with its first family only -> "(#38) a mixed run is measured with the family that draws each character" RED */

import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { templateContext } from '../../src/internal/draw.js'
import type { LoadedFont } from '../../src/internal/fonts.js'
import { createGate } from '../../src/internal/gate.js'
import { createCardHandler } from '../../src/internal/handler.js'
import { createMemo } from '../../src/internal/memo.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { nextOgRenderer } from '../../src/render/nextOg.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts } from '../helpers.js'

const span = (children: string) => ({ type: 'span', props: { style: { display: 'flex' }, children } })
const card = defineTemplate<{ title: string; subtitle: string }>({
  id: 'card',
  revision: '1',
  textFields: ['title'],
  required: (p) => !!p.title,
  render: (p, ctx) =>
    ({
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'column', fontSize: 48, fontFamily: ctx.font('title', p.title), background: '#fff' },
        // `subtitle` is not a text field; the star is in the template itself.
        children: [span(p.title), span(p.subtitle), span('★ from the template')],
      },
    }) as never,
})
const fallback = defineTemplate<{ site: string }>({ id: 'fb', revision: '1', render: () => span('fb') as never })

function setup() {
  const events = { emit: vi.fn() }
  const published = new Map([['a', { id: 1, slug: 'a', title: 'Hello', subtitle: '日本語 🚀 launch x\u0301' }]])
  const h = createCardHandler({
    targets: {
      posts: defineTarget<any, any>({
        path: '/og/:kind/:slug/card.png',
        template: 'card',
        props: ({ doc }: any) => ({ title: doc.title, subtitle: doc.subtitle }),
      }),
    },
    statics: {},
    templates: new Map([['card', card]]),
    fonts: loadTestFonts,
    stacks: { title: ['Inter'], default: ['Inter'] },
    serverUrl: 'https://x.test',
    source: {
      published: async (_: string, s: string) => published.get(s) ?? null,
      publishedById: async () => null,
      draft: async () => null,
      site: async () => ({ name: 'Site' }),
      related: async () => null,
    },
    store: memoryStore(),
    renderer: nextOgRenderer(),
    heroLoader: async () => null,
    gate: createGate(),
    memo: createMemo(),
    events,
    isDraftRequest: async () => false,
    fallback,
  } as never)
  return { h, events }
}
const ctx = { params: Promise.resolve({ kind: 'posts', slug: 'a' }) }

describe('a card is drawn without any request to a third party', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  /** Records every call that is not the renderer reading its own WebAssembly; a CDN would answer an empty 200. */
  const watch = () => {
    const real = globalThis.fetch
    const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('data:') ? real(input, init) : new Response(''),
    )
    vi.stubGlobal('fetch', spy)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    return () => spy.mock.calls.map(([u]) => String(u)).filter((u) => !u.startsWith('data:'))
  }

  it('text no face draws, from a prop outside textFields and from the template itself, is removed, reported and never fetched', async () => {
    const calls = watch()
    const { h, events } = setup()
    const res = await h.GET(new Request('https://x.test/og/posts/a/card.png'), ctx)
    expect(calls()).toEqual([])
    // A card, not the brand fallback a failed render would have been served as.
    expect([res.status, res.headers.get('x-og-cache')]).toEqual([200, 'render'])
    expect(await sharp(new Uint8Array(await res.arrayBuffer())).metadata()).toMatchObject({ width: 1200, height: 630, format: 'png' })
    const missing = events.emit.mock.calls.map(([e]) => e).filter((e) => e.name === 'glyph_missing')
    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatchObject({ kind: 'posts', slug: 'a' })
    // U+0301 is in Inter and not in Archivo: the renderer may look a cluster `x` + U+0301 up in Archivo, so the mark goes.
    expect([...missing[0].detail.chars].sort()).toEqual(['★', '日', '本', '語', '🚀', '\u0301'].sort())
    expect(events.emit.mock.calls.some(([e]) => e.name === 'render_error')).toBe(false)
  })

  it('a preview reports what was removed from the template, not only from textFields', async () => {
    watch()
    const { h } = setup()
    const out = await h.preview({
      target: 'posts',
      doc: { slug: 'a', title: 'Hello 🎉', subtitle: '語' },
      request: new Request('https://x.test'),
    })
    if (out.kind !== 'png') throw new Error('expected a png')
    expect([...out.warnings.missing].sort()).toEqual(['★', '語', '🎉'].sort())
  })
})

/** A face that draws exactly `chars`, every one 1 em wide unless `em` says otherwise. */
const face = (family: string, chars: string, em = 1000): LoadedFont => ({
  family,
  weight: 400,
  style: 'normal',
  data: new ArrayBuffer(0),
  has: (ch) => chars.includes(ch),
  advance: () => em,
})
const LATIN = ' abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const CYRILLIC = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'

describe('(#38) a stack of single-script families', () => {
  const fonts = [face('Latin', LATIN, 500), face('Cyr', CYRILLIC, 1000)]
  const stacks = { default: ['Latin', 'Cyr'] }
  const c = templateContext({ host: 'x.test', fonts, stacks, hero: null })

  it('a run no single family draws is drawn glyph by glyph across the stack', () => {
    expect(c.font('default', 'Hello Привет')).toBe('Latin, Cyr')
    // A run one family draws keeps the whole-run swap.
    expect(c.font('default', 'Hello')).toBe('Latin')
    expect(c.font('default', 'Привет')).toBe('Cyr')
  })

  it('a mixed run is measured with the family that draws each character', () => {
    const box = { width: 600, height: 1000, maxSize: 100, minSize: 10, leading: 1 }
    // `Привет` is 6 em wide in Cyr (3 em if it were measured with Latin): it must not fit on the first line at 100.
    expect(c.fit('aaaa Привет', box, 'default')).toEqual({ size: 98, lines: 2, text: 'aaaa Привет' })
    expect(c.fit('aaaa bbbb', box, 'default')).toEqual({ size: 100, lines: 1, text: 'aaaa bbbb' })
  })
})
