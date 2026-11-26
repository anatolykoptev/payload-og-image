/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a JPEG/WebP card advertised or served as a PNG, or sharing a PNG's URL, store key or fallback.
 * - resolve.ts `type: mimeOf(format)` -> `'image/png'` -> "the page advertises the card's type and the route serves it" (og:image:type), "the fallback card ..." RED
 * - resolve.ts `variant: variantOf(encoding)` dropped -> "a format, a quality and a ground are each a new card URL; PNG is untouched" RED
 * - resolve.ts `formatOf({ ... }, i.target)`: target ignored -> "a target's format and quality win over the plugin's" RED
 * - handler.ts `encoding: card.encoding` left out of draw() -> "the renderer is told the encoding" RED
 * - handler.ts `store.get/put(..., card.encoding.format)` format dropped -> "the store is asked for the card's format" RED
 * - handler.ts `content-type: card.type` on the fallback/downgraded answer -> "the fallback ..." / "a downgraded card ..." RED
 * - handler.ts fallback memo key without `encodingKey` -> "the fallback is not shared between formats" RED
 * - handler.ts `type: forced.type` in preview() -> "a preview carries the card's type" RED
 * - inspect.ts `type: card.type` in serve() -> "inspect.serve reports the type" RED */
import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocSource, HeroLoader, Renderer } from '../../src/internal/handler.js'
import { buildRuntime, setTestRuntime } from '../../src/internal/runtime.js'
import { createState } from '../../src/internal/state.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { descriptorOf } from '../../src/next/metadata.js'
import { createOgRoute } from '../../src/next/route.js'
import type { OgImagePluginOptions } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts, realCard, relatedUploads, uploadsFrom } from '../helpers.js'

const post = defineTemplate<{ title: string; label: string }>({
  id: 'post',
  revision: '1',
  required: (p) => !!p.title.trim(),
  textFields: ['title'],
  render: (p) => ({ type: 'div', props: { children: p.title } }) as never,
})
const docs: Record<string, any> = {
  1: { id: 1, slug: 'a', title: 'A' },
  2: { id: 2, slug: 'h', title: 'Hero', heroImage: { id: 9, url: '/media/h.jpg', updatedAt: 'u1', filename: 'h.jpg' } },
}

function setup(over: Partial<OgImagePluginOptions> = {}, o: { fail?: boolean; heroLoader?: HeroLoader } = {}) {
  const source: DocSource = {
    published: async (_t, slug) => Object.values(docs).find((d: any) => d.slug === slug) ?? null,
    publishedById: async (_t, id) => docs[String(id)] ?? null,
    draft: async () => null,
    site: async () => ({ name: 'Site' }),
    related: relatedUploads(docs),
    uploads: uploadsFrom(relatedUploads(docs)),
  }
  const options: OgImagePluginOptions = {
    site: () => ({ name: 'Site' }),
    fonts: [],
    stacks: { title: ['Inter'], default: ['Inter'] },
    templates: [post],
    targets: {
      posts: defineTarget<any, any>({
        path: '/og/:kind/:slug/card.png',
        template: 'post',
        props: ({ doc }: any) => ({ title: doc.title, label: 'Blog' }),
        hero: ({ doc }: any) => doc.heroImage,
        heroCollection: 'media',
      }),
    },
    store: { memory: true },
    ...over,
  }
  const state = createState(options, 'https://x.test')
  state.fonts = loadTestFonts
  const store = memoryStore()
  const spies = { get: vi.spyOn(store, 'get'), put: vi.spyOn(store, 'put'), stat: vi.spyOn(store, 'stat') }
  const render = vi.fn<Renderer['render']>(async (el: any, a) => {
    if (o.fail && typeof el?.props?.children === 'string') throw new Error('boom')
    return realCard(String(el?.props?.children ?? ''), a.encoding?.format ?? 'png')
  })
  const rt = buildRuntime(state, {} as Payload, {
    source,
    store,
    renderer: { render },
    heroLoader: o.heroLoader ?? (async () => 'data:image/png;base64,AAAA'),
    isDraftRequest: async () => false,
  })
  setTestRuntime(rt)
  return { rt, render, spies, store, route: createOgRoute({ config: {} as never }) }
}
afterEach(() => setTestRuntime(null))

const ctx = (slug: string) => ({ params: Promise.resolve({ kind: 'posts', slug }) })
const card = async (rt: ReturnType<typeof setup>['rt'], id = 1) => {
  const m = await rt.resolveForMetadata({ target: 'posts', id })
  if (m.kind !== 'generated') throw new Error('expected a generated card')
  return m
}
const sniff = (b: Uint8Array) =>
  b[0] === 0x89 ? 'png' : b[0] === 0xff ? 'jpeg' : String.fromCharCode(...b.subarray(8, 12)) === 'WEBP' ? 'webp' : '?'

describe.each(['jpeg', 'webp'] as const)('%s cards', (format) => {
  const type = `image/${format}`
  const plugin = { format } as Partial<OgImagePluginOptions>

  it("the page advertises the card's type and the route serves it, with the etag, a 304 and a HEAD-like answer", async () => {
    const { rt, route } = setup(plugin)
    const c = await card(rt)
    expect(c.type).toBe(type)
    const image = (descriptorOf(c).openGraph as any).images[0]
    expect(image.type).toBe(type) // og:image:type
    const r = await route.GET(new Request(c.url), ctx('a'))
    expect([r.status, r.headers.get('content-type'), r.headers.get('etag')]).toEqual([200, type, `"${c.v}"`])
    expect(sniff(new Uint8Array(await r.arrayBuffer()))).toBe(format)
    const again = await route.GET(new Request(c.url, { headers: { 'if-none-match': `"${c.v}"` } }), ctx('a'))
    expect([again.status, again.headers.get('content-type'), again.headers.get('etag')]).toEqual([304, type, `"${c.v}"`])
  })

  it('the renderer is told the encoding, and PNG is told none that changes it', async () => {
    const { rt, render, route } = setup({ ...plugin, heroBackground: '#102030' })
    const c = await card(rt)
    await route.GET(new Request(c.url), ctx('a'))
    expect(render.mock.calls[0]?.[1].encoding).toEqual({ format, quality: format === 'jpeg' ? 82 : 80, ground: '#102030' })
  })

  it('the store is asked for the card in its format, and keeps it', async () => {
    const { rt, route, spies, store } = setup(plugin)
    const c = await card(rt)
    await route.GET(new Request(c.url), ctx('a'))
    expect(spies.get).toHaveBeenCalledWith(c.pageId, c.v, format)
    expect(spies.put).toHaveBeenCalledWith(c.pageId, c.v, expect.any(Uint8Array), format)
    expect(await store.stat(c.pageId, c.v, format)).not.toBeNull()
  })

  it('a downgraded card (its hero could not be read) keeps the format and carries no etag', async () => {
    const { rt, route } = setup(plugin, { heroLoader: async () => null })
    const c = await card(rt, 2)
    const r = await route.GET(new Request(c.url), ctx('h'))
    expect([r.headers.get('x-og-cache'), r.headers.get('content-type'), r.headers.get('etag')]).toEqual(['downgraded', type, null])
  })

  it('a preview carries the card’s type, and inspect.serve reports it', async () => {
    const { rt } = setup(plugin)
    const p = await rt.preview({ target: 'posts', doc: docs[1], request: new Request('https://x.test') })
    expect(p).toMatchObject({ kind: 'png', type })
    const s = await rt.inspect.serve({ target: 'posts', id: 1 })
    expect(s).toMatchObject({ status: 'png', type })
    if (s.status === 'png') expect(sniff(s.bytes)).toBe(format)
  })
})

describe('format resolution', () => {
  it("a target's format and quality win over the plugin's; PNG stays the default", async () => {
    const t = (o: object) => ({
      posts: defineTarget<any, any>({
        path: '/og/:kind/:slug/card',
        template: 'post',
        props: ({ doc }: any) => ({ title: doc.title, label: 'Blog' }),
        ...o,
      }),
    })
    const types = async (over: Partial<OgImagePluginOptions>) => {
      const { rt, render, route } = setup(over)
      const c = await card(rt)
      await route.GET(new Request(c.url), ctx('a'))
      return { type: c.type, encoding: render.mock.calls[0]?.[1].encoding }
    }
    expect((await types({})).type).toBe('image/png')
    expect((await types({ format: 'jpeg', targets: t({ format: 'png' }) })).type).toBe('image/png') // the target says PNG
    expect((await types({ format: 'png', targets: t({ format: 'webp' }) })).type).toBe('image/webp')
    expect((await types({ format: 'jpeg', jpeg: { quality: 90 }, targets: t({}) })).encoding).toMatchObject({ quality: 90 })
    expect((await types({ format: 'jpeg', jpeg: { quality: 90 }, targets: t({ jpeg: { quality: 60 } }) })).encoding).toMatchObject({
      quality: 60,
    })
    expect((await types({ webp: { quality: 55 }, targets: t({ format: 'webp' }) })).encoding).toMatchObject({ format: 'webp', quality: 55 })
  })

  it('a format, a quality and a ground are each a new card URL; PNG is untouched', async () => {
    const url = async (over: Partial<OgImagePluginOptions>) => (await card(setup(over).rt)).v
    const png = await url({})
    expect(await url({ format: 'png' })).toBe(png) // saying PNG changes no URL
    expect(await url({ format: 'png', jpeg: { quality: 50 }, webp: { quality: 50 } })).toBe(png) // settings of another format change none
    const jpeg = await url({ format: 'jpeg' })
    const all = [
      png,
      jpeg,
      await url({ format: 'webp' }),
      await url({ format: 'jpeg', jpeg: { quality: 70 } }),
      await url({ format: 'jpeg', heroBackground: '#000000' }),
    ]
    expect(new Set(all).size).toBe(all.length)
    expect(await url({ format: 'jpeg', jpeg: { quality: 82 } })).toBe(jpeg) // the default quality spelled out
  })
})

describe('the fallback card', () => {
  it("is served in the failed card's format, and is not shared between formats", async () => {
    const both = {
      format: 'jpeg' as const,
      targets: {
        posts: defineTarget<any, any>({
          path: '/og/:kind/:slug/card.jpg',
          template: 'post',
          props: ({ doc }: any) => ({ title: doc.title, label: 'B' }),
        }),
        pngs: defineTarget<any, any>({
          path: '/og/:kind/:slug/card.png',
          template: 'post',
          format: 'png',
          props: ({ doc }: any) => ({ title: doc.title, label: 'B' }),
        }),
      },
    }
    const { route } = setup(both, { fail: true })
    const jpeg = await route.GET(new Request('https://x.test/og/posts/a/card.jpg'), ctx('a'))
    const png = await route.GET(new Request('https://x.test/og/pngs/a/card.png'), { params: Promise.resolve({ kind: 'pngs', slug: 'a' }) })
    expect([jpeg.headers.get('x-og-cache'), jpeg.headers.get('content-type')]).toEqual(['fallback', 'image/jpeg'])
    expect([png.headers.get('x-og-cache'), png.headers.get('content-type')]).toEqual(['fallback', 'image/png'])
    expect(sniff(new Uint8Array(await jpeg.arrayBuffer()))).toBe('jpeg') // bytes, not only the header
    expect(sniff(new Uint8Array(await png.arrayBuffer()))).toBe('png')
  })
})
