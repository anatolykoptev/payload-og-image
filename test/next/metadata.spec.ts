/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a page advertising a card URL the route does not serve (a different v, a different image).
 * - runtime.ts:149  resolve from the document the page passed instead of re-reading by id (patched through metadata.ts and runtime.ts together) -> "4: the page passes a doc whose hero is a bare id ..." RED
 * - resolve.ts:169 leave heroBackground out of the version -> "a changed heroBackground is a new card URL" RED
 * - runtime.ts:118 `heroFlattened: true` always -> "a transparent hero nobody flattens is a new card URL" RED
 * - handler.ts:243 `heroHasAlpha` left out of the resolve input -> same test RED
 * - runtime.ts `cardPalette`/`heroPalette` left out of the handler deps -> "a palette option is part of the card URL only when it changes the output" RED
 * - version.ts `cardPalette`/`heroPalette` left out of the hash -> same test RED
 * - palette.ts `effectiveColours` removed (raw count hashed) -> same test RED
 * - metadata.ts:17  never set `secureUrl` -> "1: a generated card", "2: the editor image is advertised as it is" RED; set it for an http URL too -> "43: an http image gets no secureUrl" RED
 * - metadata.ts:38  always throw -> "a failure throws in development and test, and is an event with {} in production" RED
 * - metadata.ts:11  advertise a card that would be blank -> "3: a card that would be blank advertises nothing" RED */
import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocSource, HeroLoader } from '../../src/internal/handler.js'
import { buildRuntime, setTestRuntime } from '../../src/internal/runtime.js'
import { createState } from '../../src/internal/state.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { descriptorOf, ogMetadata } from '../../src/next/metadata.js'
import { createOgRoute } from '../../src/next/route.js'
import type { OgImagePluginOptions } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts, realPng } from '../helpers.js'

const post = defineTemplate<{ title: string; label: string }>({
  id: 'post',
  revision: '1',
  required: (p) => !!p.title.trim(),
  textFields: ['title'],
  render: (p) => ({ type: 'div', props: { children: p.title } }) as never,
})
const jpeg = { id: 7, url: '/media/own.jpg', width: 1200, height: 630, mimeType: 'image/jpeg', alt: 'Own' }
const heroUpload = { id: 9, url: '/media/h.jpg', updatedAt: 'u1', filename: 'h.jpg' }

function setup(
  docs: Record<string, any>,
  over: Partial<OgImagePluginOptions> = {},
  heroLoader: HeroLoader = async () => 'data:image/png;base64,AAAA',
) {
  const publishedById = vi.fn(async (_t: string, id: string | number) => docs[String(id)] ?? null)
  const source: DocSource = {
    published: async (_t, slug) => Object.values(docs).find((d: any) => d.slug === slug) ?? null,
    publishedById,
    draft: async () => null,
    site: async () => ({ name: 'Site' }),
    related: async () => null,
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
      }),
    },
    static: {
      'index/blog': {
        path: '/og/index/blog/card.png',
        kind: 'index',
        slug: 'blog',
        template: 'post',
        props: () => ({ title: 'Blog', label: '' }),
      },
    },
    store: { memory: true },
    seoImage: { path: 'meta.image' },
    ...over,
  }
  const state = createState(options, 'https://x.test')
  // The state loads the real fixture faces through the same memo the plugin uses.
  state.fonts = loadTestFonts
  const rt = buildRuntime(state, {} as Payload, {
    source,
    store: memoryStore(),
    renderer: { render: async (el: any) => realPng(String(el?.props?.children ?? '')) },
    heroLoader,
    isDraftRequest: async () => false,
  })
  setTestRuntime(rt)
  return { rt, publishedById, config: {} as never }
}
afterEach(() => setTestRuntime(null))

describe('ogMetadata', () => {
  it('1: a generated card -> openGraph image {url,width,height,type,alt} and the summary_large_image twitter pair', async () => {
    const { config } = setup({ 1: { id: 1, slug: 'a', title: 'A' } })
    const m = await ogMetadata({ config, target: 'posts', doc: { id: 1 } })
    const image = (m.openGraph as any).images[0]
    expect(image.url).toMatch(/^https:\/\/x\.test\/og\/posts\/a\/card\.png\?v=[0-9a-f]{12}$/)
    expect([image.width, image.height, image.type, image.alt]).toEqual([1200, 630, 'image/png', 'Blog: A'])
    expect(image.secureUrl).toBe(image.url) // an https image also says so as og:image:secure_url
    expect(m.twitter).not.toHaveProperty('images.0.secureUrl')
    expect(m.twitter).toEqual({ card: 'summary_large_image', images: [{ url: image.url, width: 1200, height: 630, alt: 'Blog: A' }] })
  })
  it('2: the editor image is advertised as it is', async () => {
    const { config } = setup({ 1: { id: 1, slug: 'a', title: 'A', meta: { image: jpeg } } })
    const m = await ogMetadata({ config, target: 'posts', doc: { id: 1 } })
    expect((m.openGraph as any).images[0]).toEqual({
      url: 'https://x.test/media/own.jpg',
      secureUrl: 'https://x.test/media/own.jpg',
      width: 1200,
      height: 630,
      type: 'image/jpeg',
      alt: 'Own',
    })
    expect((m.twitter as any).images[0]).toEqual({ url: 'https://x.test/media/own.jpg', width: 1200, height: 630, alt: 'Own' })
  })
  it('43: an http image gets no secureUrl; an https one gets its own URL', async () => {
    const http = { ...jpeg, url: 'http://cdn.test/own.jpg' }
    const { config } = setup({ 1: { id: 1, slug: 'a', title: 'A', meta: { image: http } } })
    const image = ((await ogMetadata({ config, target: 'posts', doc: { id: 1 } })).openGraph as any).images[0]
    expect(image.url).toBe('http://cdn.test/own.jpg')
    expect(image).not.toHaveProperty('secureUrl')
  })
  it('3: a card that would be blank advertises nothing, and so does a missing doc', async () => {
    const { config } = setup({ 1: { id: 1, slug: 'a', title: '  ' } })
    expect(await ogMetadata({ config, target: 'posts', doc: { id: 1 } })).toEqual({})
    expect(await ogMetadata({ config, target: 'posts', doc: { id: 404 } })).toEqual({})
    expect(await ogMetadata({ config, target: 'posts', doc: null })).toEqual({})
    expect(await ogMetadata({ config, target: 'posts', doc: undefined })).toEqual({})
  })
  it("4: the page passes a doc whose hero is a bare id; the helper re-reads by id and advertises the ROUTE's version", async () => {
    const full = { id: 1, slug: 'a', title: 'A', heroImage: heroUpload }
    const { config, publishedById } = setup({ 1: full })
    const shallow = { id: 1, slug: 'a', title: 'A', heroImage: 9 } // what a depth-0 page read holds
    const m = await ogMetadata({ config, target: 'posts', doc: shallow as never })
    const advertised = (m.openGraph as any).images[0].url as string
    expect(publishedById).toHaveBeenCalledWith('posts', 1)
    const res = await createOgRoute({ config }).GET(new Request(advertised), { params: Promise.resolve({ kind: 'posts', slug: 'a' }) })
    expect(advertised.endsWith(`?v=${(res.headers.get('etag') as string).replaceAll('"', '')}`)).toBe(true)
    expect(res.headers.get('cache-control')).toContain('immutable') // the advertised URL IS the current version
  })
  it('a changed heroBackground is a new card URL for a card with a hero, never a reused stored PNG; none for a card without one', async () => {
    const vOf = async (over: Partial<OgImagePluginOptions>, doc: object) => {
      const { config } = setup({ 1: doc }, over)
      return ((await ogMetadata({ config, target: 'posts', doc: { id: 1 } })).openGraph as any).images[0].url as string
    }
    const withHero = { id: 1, slug: 'a', title: 'A', heroImage: heroUpload }
    const plain = { id: 1, slug: 'a', title: 'A' }
    const paper = await vOf({ heroBackground: '#f1f3ef' }, withHero)
    expect(await vOf({ heroBackground: '#336699' }, withHero)).not.toBe(paper)
    expect(await vOf({}, withHero)).not.toBe(paper)
    // The effective colour is what counts: spellings of one colour agree, and an explicit white is the default.
    expect(await vOf({ heroBackground: '#F1F3EF' }, withHero)).toBe(paper)
    expect(await vOf({ heroBackground: '#ffffff' }, withHero)).toBe(await vOf({}, withHero))
    expect(await vOf({ heroBackground: '#fff' }, withHero)).toBe(await vOf({}, withHero))
    expect(await vOf({ heroBackground: '#336699' }, plain)).toBe(await vOf({}, plain))
  })
  it('a transparent hero nobody flattens is a new card URL (its bytes changed in 0.5.0); an opaque one, or a flattened one, keeps its URL', async () => {
    const withAlpha = (alpha: boolean): HeroLoader =>
      Object.assign(async () => 'data:image/png;base64,AAAA', { hasAlpha: async () => alpha })
    const url = async (over: Partial<OgImagePluginOptions>, loader?: HeroLoader) => {
      const { config } = setup({ 1: { id: 1, slug: 'a', title: 'A', heroImage: heroUpload } }, over, loader)
      return ((await ogMetadata({ config, target: 'posts', doc: { id: 1 } })).openGraph as any).images[0].url as string
    }
    const opaque = await url({})
    expect(await url({}, withAlpha(false))).toBe(opaque)
    const transparent = await url({}, withAlpha(true))
    expect(transparent).not.toBe(opaque)
    // The site chose a ground (white too): the bytes are the ones 0.4.0 drew, so the URL is the one it had.
    expect(await url({ heroBackground: '#ffffff' }, withAlpha(true))).toBe(opaque)
    expect(await url({ heroBackground: '#336699' }, withAlpha(true))).toBe(await url({ heroBackground: '#336699' }, withAlpha(false)))
  })
  it('a palette option is part of the card URL only when it changes the output: defaults keep every existing URL', async () => {
    const vOf = async (over: Partial<OgImagePluginOptions>, doc: object) => {
      const { config } = setup({ 1: doc }, over)
      return ((await ogMetadata({ config, target: 'posts', doc: { id: 1 } })).openGraph as any).images[0].url as string
    }
    const withHero = { id: 1, slug: 'a', title: 'A', heroImage: heroUpload }
    const plain = { id: 1, slug: 'a', title: 'A' }
    // Pinned from 0.3.0, before the option existed: a site that never sets it must not see its cards move.
    expect(await vOf({}, plain)).toBe('https://x.test/og/posts/a/card.png?v=b258c1ed96ba')
    expect(await vOf({}, withHero)).toBe('https://x.test/og/posts/a/card.png?v=153817abd639')
    // Spelling the defaults out is the same card.
    expect(await vOf({ palette: {} }, plain)).toBe(await vOf({}, plain))
    expect(await vOf({ palette: { card: 128, hero: 256 } }, withHero)).toBe(await vOf({}, withHero))
    // The card palette changes every card; the hero palette only a card with a hero.
    const base = await vOf({}, plain)
    // Counts sharp rounds to the same depth are the same bytes, so the same URL; 200 encodes like the default.
    expect(await vOf({ palette: { card: 200 } }, plain)).toBe(base)
    expect(await vOf({ palette: { card: 5 } }, plain)).toBe(await vOf({ palette: { card: 16 } }, plain))
    expect(await vOf({ palette: { card: 3 } }, plain)).not.toBe(await vOf({ palette: { card: 2 } }, plain))
    expect(await vOf({ palette: { hero: 200 } }, withHero)).toBe(await vOf({}, withHero))
    expect(await vOf({ palette: { hero: 9 } }, withHero)).toBe(await vOf({ palette: { hero: 16 } }, withHero))
    expect(await vOf({ palette: { card: false } }, plain)).not.toBe(base)
    expect(await vOf({ palette: { card: 16 } }, plain)).not.toBe(base)
    expect(await vOf({ palette: { card: 16 } }, plain)).not.toBe(await vOf({ palette: { card: false } }, plain))
    expect(await vOf({ palette: { hero: false } }, plain)).toBe(base)
    const heroBase = await vOf({}, withHero)
    expect(await vOf({ palette: { hero: false } }, withHero)).not.toBe(heroBase)
    expect(await vOf({ palette: { hero: 16 } }, withHero)).not.toBe(await vOf({ palette: { hero: false } }, withHero))
    expect(await vOf({ palette: { card: false } }, withHero)).not.toBe(heroBase)
  })
  it('5: a static card -> its URL', async () => {
    const { config } = setup({})
    const m = await ogMetadata({ config, static: 'index/blog' })
    expect((m.openGraph as any).images[0].url).toMatch(/^https:\/\/x\.test\/og\/index\/blog\/card\.png\?v=[0-9a-f]{12}$/)
  })
  it('descriptorOf is the one place the metadata shape is built', () => {
    expect(descriptorOf({ kind: 'none' })).toEqual({})
  })
  it('a failure throws in development and test, and is an event with {} in production', async () => {
    const { config, rt } = setup({ 1: { id: 1, slug: 'a', title: 'A' } }, { static: {} })
    await expect(ogMetadata({ config, static: 'index/nope' })).rejects.toThrow(/no static card/)
    const events: string[] = []
    const emit = vi.spyOn(rt, 'emit').mockImplementation((e) => void events.push(e.name))
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect(await ogMetadata({ config, static: 'index/nope' })).toEqual({})
    } finally {
      vi.unstubAllEnvs()
      emit.mockRestore()
    }
    expect(events).toEqual(['render_error'])
  })
})
