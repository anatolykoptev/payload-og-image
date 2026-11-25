/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a declared variant that boots and serves nothing, or a page that lists a size the route does not serve.
 * - plugin/index.ts:212 `targets: expandVariants(options.targets ?? {})` -> `options.targets` -> "the route serves the variant at its template's size", "ogImages lists the wide image, then each variant ...", "the plugin expands ..." RED
 * - resolve.ts `i.variant === true` dropped from `own` -> "a variant ignores the editor's own share image ..." RED
 * - variants.ts kind `${kind}-${variant}` -> `kind` -> "a variant's kind collides ..." and the route test RED
 * - next/metadata.ts ogImages: variants skipped -> "ogImages lists ..." RED */
import { readFile } from 'node:fs/promises'
import type { Config, Payload } from 'payload'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocSource } from '../../src/internal/handler.js'
import { buildRuntime, setTestRuntime } from '../../src/internal/runtime.js'
import { CUSTOM_KEY, type OgState } from '../../src/internal/state.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { withVariants } from '../../src/internal/variants.js'
import { ogImages, ogMetadata } from '../../src/next/metadata.js'
import { createOgRoute } from '../../src/next/route.js'
import { type OgImagePluginOptions, ogImagePlugin } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts } from '../helpers.js'

const draw = (id: string, size?: { width: number; height: number }) =>
  defineTemplate<{ title: string }>({
    id,
    revision: '1',
    ...(size ? { size } : {}),
    textFields: ['title'],
    required: (p) => !!p.title.trim(),
    render: (p) => ({ type: 'div', props: { children: p.title } }) as never,
  })
const wide = draw('wide')
const square = draw('square', { width: 1080, height: 1080 })
const four3 = draw('four3', { width: 1200, height: 900 })

const jpeg = { id: 7, url: '/media/own.jpg', width: 1200, height: 630, mimeType: 'image/jpeg', alt: 'Own' }
const docs: Record<string, any> = {
  1: { id: 1, slug: 'a', title: 'A' },
  2: { id: 2, slug: 'b', title: 'B', meta: { image: jpeg } },
  3: { id: 3, slug: 'c', title: '  ' },
}
const source: DocSource = {
  published: async (_t, slug) => Object.values(docs).find((d: any) => d.slug === slug) ?? null,
  publishedById: async (_t, id) => docs[String(id)] ?? null,
  draft: async () => null,
  site: async () => ({ name: 'Site' }),
  related: async () => null,
}
const posts = defineTarget<any, any>({
  path: '/og/:kind/:slug/card.png',
  template: 'wide',
  props: ({ doc }: any) => ({ title: doc.title }),
  variants: {
    square: { path: '/og/:kind/:slug/square.png', template: 'square' },
    '4x3': { path: '/og/:kind/:slug/4x3.png', template: 'four3' },
  },
})
const options = (over: Partial<OgImagePluginOptions> = {}): OgImagePluginOptions => ({
  site: () => ({ name: 'Site' }),
  fonts: [
    { family: 'Inter', weight: 800, data: () => readFile(new URL('../fixtures/fonts/inter-latin-cyrillic-800.woff', import.meta.url)) },
  ],
  stacks: { title: ['Inter'], default: ['Inter'] },
  templates: [wide, square, four3],
  targets: { posts },
  store: { memory: true },
  seoImage: { path: 'meta.image' },
  ...over,
})
const config = (): Config =>
  ({ serverURL: 'https://x.test', collections: [{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }] }) as Config
const apply = (o: OgImagePluginOptions) => ogImagePlugin(o)(config())

/** The runtime is built from the state the PLUGIN produced, so a plugin that does not expand variants serves none. */
function boot(o: OgImagePluginOptions = options()) {
  const state = apply(o).custom?.[CUSTOM_KEY] as OgState
  state.fonts = loadTestFonts
  const rt = buildRuntime(state, {} as Payload, {
    source,
    store: memoryStore(),
    // Draws at the size the handler asks for, so a card is as big as the template that was picked.
    renderer: {
      render: async (_el, { width, height }) =>
        new Uint8Array(
          await sharp({ create: { width, height, channels: 3, background: '#123456' } })
            .png()
            .toBuffer(),
        ),
    },
    heroLoader: async () => null,
    isDraftRequest: async () => false,
  })
  setTestRuntime(rt)
  return { state, rt, config: {} as never, route: createOgRoute({ config: {} as never }) }
}
afterEach(() => setTestRuntime(null))

const dims = async (r: Response) => {
  const m = await sharp(new Uint8Array(await r.arrayBuffer())).metadata()
  return [m.width, m.height]
}
const ctx = (kind: string, slug: string) => ({ params: Promise.resolve({ kind, slug }) })

describe('size variants', () => {
  it('the plugin expands each variant into a hidden sibling target right after its parent', () => {
    const targets = (apply(options()).custom![CUSTOM_KEY] as OgState).options.targets
    expect(Object.keys(targets)).toEqual(['posts', 'posts~square', 'posts~4x3'])
    expect(targets['posts~square']).toMatchObject({ kind: 'posts-square', path: '/og/:kind/:slug/square.png', template: 'square' })
    expect(targets['posts~square']?.variants).toBeUndefined()
    expect(targets.posts?.variants).toBeDefined() // the parent keeps its declaration
    const again = withVariants({ targets }).targets
    expect(Object.keys(again)).toEqual(Object.keys(targets)) // expanding twice changes nothing
    expect(again['posts~square']).toBe(targets['posts~square'])
  })

  it("the route serves the variant at its template's size, and the parent at its own", async () => {
    const { route, rt } = boot()
    const sq = await rt.resolveForMetadata({ target: 'posts~square', id: 1 })
    if (sq.kind !== 'generated') throw new Error('expected a generated card')
    expect(sq.url).toMatch(/^https:\/\/x\.test\/og\/posts-square\/a\/square\.png\?v=[0-9a-f]{12}$/)
    const r = await route.GET(new Request(sq.url), ctx('posts-square', 'a'))
    expect(r.status).toBe(200)
    expect(await dims(r)).toEqual([1080, 1080])
    const r43 = await route.GET(new Request('https://x.test/og/posts-4x3/a/4x3.png'), ctx('posts-4x3', 'a'))
    expect(await dims(r43)).toEqual([1200, 900])
    const w = await route.GET(new Request('https://x.test/og/posts/a/card.png'), ctx('posts', 'a'))
    expect(await dims(w)).toEqual([1200, 630])
  })

  it('ogImages lists the wide image, then each variant, with their own URLs, sizes and versions', async () => {
    const { config } = boot()
    const list = await ogImages({ config, target: 'posts', doc: { id: 1 } })
    expect(list.map((i) => [i.variant, i.width, i.height])).toEqual([
      [null, 1200, 630],
      ['square', 1080, 1080],
      ['4x3', 1200, 900],
    ])
    expect(list.map((i) => i.url.replace(/\?v=[0-9a-f]{12}$/, ''))).toEqual([
      'https://x.test/og/posts/a/card.png',
      'https://x.test/og/posts-square/a/square.png',
      'https://x.test/og/posts-4x3/a/4x3.png',
    ])
    const versions = list.map((i) => i.url.split('?v=')[1])
    expect(new Set(versions).size).toBe(3) // each size is its own card version
    // The wide URL is the one ogMetadata advertises.
    const m = await ogMetadata({ config, target: 'posts', doc: { id: 1 } })
    expect((m.openGraph as any).images[0].url).toBe(list[0]?.url)
  })

  it('ogImages takes a subset, in the order given; an undeclared name throws', async () => {
    const { config } = boot()
    expect((await ogImages({ config, target: 'posts', doc: { id: 1 }, variants: ['4x3'] })).map((i) => i.variant)).toEqual([null, '4x3'])
    expect((await ogImages({ config, target: 'posts', doc: { id: 1 }, variants: [] })).map((i) => i.variant)).toEqual([null])
    await expect(ogImages({ config, target: 'posts', doc: { id: 1 }, variants: ['round'] })).rejects.toThrow(/no variant "round"/)
  })

  it("a variant ignores the editor's own share image and still draws; the wide image is the own one", async () => {
    const { config, rt } = boot()
    const list = await ogImages({ config, target: 'posts', doc: { id: 2 } })
    expect(list.map((i) => [i.variant, i.url.startsWith('https://x.test/media/own.jpg') ? 'own' : 'card', i.width, i.height])).toEqual([
      [null, 'own', 1200, 630],
      ['square', 'card', 1080, 1080],
      ['4x3', 'card', 1200, 900],
    ])
    expect((await rt.resolveForMetadata({ target: 'posts', id: 2 })).kind).toBe('own')
  })

  it('a blank card leaves its size out; no document and no variants give the wide image or nothing', async () => {
    const { config } = boot()
    expect(await ogImages({ config, target: 'posts', doc: { id: 3 } })).toEqual([])
    expect(await ogImages({ config, target: 'posts', doc: null })).toEqual([])
    boot(options({ targets: { posts: defineTarget<any, any>({ ...posts, variants: undefined }) } }))
    expect((await ogImages({ config, target: 'posts', doc: { id: 1 } })).map((i) => i.variant)).toEqual([null])
  })

  it('without variants ogMetadata is unchanged, and declaring variants does not touch it', async () => {
    const expected = (url: string) => ({
      openGraph: { images: [{ url, secureUrl: url, width: 1200, height: 630, type: 'image/png', alt: 'A' }] },
      twitter: { card: 'summary_large_image', images: [{ url, width: 1200, height: 630, alt: 'A' }] },
    })
    const { config } = boot(options({ targets: { posts: defineTarget<any, any>({ ...posts, variants: undefined }) } }))
    const plain = await ogMetadata({ config, target: 'posts', doc: { id: 1 } })
    const url = (plain.openGraph as any).images[0].url
    expect(plain).toEqual(expected(url))
    boot()
    expect(await ogMetadata({ config, target: 'posts', doc: { id: 1 } })).toEqual(plain)
  })
})

describe('size variants across module instances', () => {
  it('a state built by one copy of the module resolves in a freshly imported copy: the variant still draws, never the own image', async () => {
    const { state } = boot()
    vi.resetModules() // Next may load the package once for the page and once for the route handler; Payload's cache shares one state
    const fresh = await import('../../src/internal/runtime.js')
    const metadata = await import('../../src/next/metadata.js')
    expect(fresh.buildRuntime).not.toBe(buildRuntime)
    const rt = fresh.buildRuntime(state, {} as Payload, {
      source,
      store: memoryStore(),
      renderer: { render: async () => new Uint8Array() },
      heroLoader: async () => null,
      isDraftRequest: async () => false,
    })
    fresh.setTestRuntime(rt)
    try {
      expect(rt.variantsOf('posts')).toEqual(['square', '4x3'])
      const list = await metadata.ogImages({ config: {} as never, target: 'posts', doc: { id: 2 } }) // doc 2 has an editor image
      expect(list.map((i) => [i.variant, i.url.includes('/media/own.jpg')])).toEqual([
        [null, true],
        ['square', false],
        ['4x3', false],
      ])
    } finally {
      fresh.setTestRuntime(null)
    }
  })
})

describe('size variants: one failing size', () => {
  const broken = defineTarget<any, any>({
    ...posts,
    variants: {
      ...posts.variants,
      square: {
        path: '/og/:kind/:slug/square.png',
        template: () => {
          throw new Error('template picker broke')
        },
      },
    },
  })
  afterEach(() => vi.unstubAllEnvs())

  it('in production the other sizes still list and the failure is an event of its own', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const events: any[] = []
    const { config } = boot(options({ targets: { posts: broken }, onEvent: (e) => events.push(e) }))
    const list = await ogImages({ config, target: 'posts', doc: { id: 1 } })
    expect(list.map((i) => i.variant)).toEqual([null, '4x3'])
    const e = events.filter((x) => x.name === 'render_error')
    expect(e).toHaveLength(1)
    expect(e[0].detail.message).toMatch(/posts~square: template picker broke/)
  })
  it('in development and test it throws', async () => {
    const { config } = boot(options({ targets: { posts: broken } }))
    await expect(ogImages({ config, target: 'posts', doc: { id: 1 } })).rejects.toThrow(/template picker broke/)
  })
  it('the document is read once for every size', async () => {
    const read = vi.spyOn(source, 'publishedById')
    const { config } = boot()
    await ogImages({ config, target: 'posts', doc: { id: 1 } })
    expect(read).toHaveBeenCalledTimes(1)
    read.mockRestore()
  })
})

describe('size variants: validation', () => {
  it.each([['Square'], ['sq_uare'], ['sq~'], [''], ['a b']])('the variant name "%s" is refused', (name) => {
    expect(() => defineTarget<any, any>({ ...posts, variants: { [name]: { path: '/x/:slug/s.png', template: 'square' } } })).toThrow(
      /variant name/,
    )
  })
  it('a variant path is validated like a target path', () => {
    expect(() => defineTarget<any, any>({ ...posts, variants: { s: { path: '/x/s.png', template: 'square' } } })).toThrow(/:slug or :id/)
  })
  it("a variant's kind collides with an existing kind", () => {
    const other = defineTarget<any, any>({ ...posts, variants: undefined, kind: 'posts-square' })
    expect(() => apply(options({ targets: { posts, other } }))).toThrow(/kind "posts-square"/)
  })
  it('a variant naming an unknown template is refused at start-up', () => {
    const bad = defineTarget<any, any>({ ...posts, variants: { s: { path: '/og/:kind/:slug/s.png', template: 'ghost' } } })
    expect(() => apply(options({ targets: { posts: bad } }))).toThrow(/target "posts~s" names the unknown template "ghost"/)
  })
})
