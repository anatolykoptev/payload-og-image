/** Mutation table (production line -> the test that goes RED). Silent-failure surface: text from a draft leaving the host through the renderer's CDN fetches.
 * - draw.ts:46  hand the renderer the element as the template drew it (no `stripUndrawable`) -> "text no face draws, from a prop outside textFields and from the template itself, is removed, reported and never fetched" RED
 * - draw.ts:46  same -> "a preview reports what was removed from the template, not only from textFields" RED
 */

import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  const published = new Map([['a', { id: 1, slug: 'a', title: 'Hello', subtitle: '日本語 🚀 launch' }]])
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
    expect([...missing[0].detail.chars].sort()).toEqual(['★', '日', '本', '語', '🚀'].sort())
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
