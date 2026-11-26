/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a draft cached, a stale or request-chosen version stored, a degraded card pinned.
 * - handler.ts `background: card.heroBackground` left out of the hero loader call -> "a ground set on the target reaches the hero loader" RED
 * - handler.ts:218  delete the draft branch -> "6", "7", "7b", "16", "20" RED
 * - handler.ts:237  store keyed by the request ?v -> "3: a stale ?v is served short, stored under the CURRENT v" RED
 * - handler.ts:225  immutable without the `current` check -> "3" RED
 * - handler.ts:235  decide the downgrade inside the memo closure (store and memoise it) -> "17" RED
 * - hero.ts `known.set` removed (the probe forgets) -> "a store hit in the steady state reads no hero file" RED
 * - resolve.ts `heroCollection` returned as `i.target.heroCollection` -> "is drawn from its own collection's folder" RED
 * - handler.ts:229  call heroLoader before store.get -> "4: a store hit renders nothing and loads no hero" RED
 * - handler.ts:276  fail open when the draft check throws -> "20" RED
 * - handler.ts:154  memoise the fallback in draft mode -> "21" RED
 * - handler.ts:68  match If-None-Match only as one whole tag -> "13" RED
 * - handler.ts:165  no slug length cap -> "24: an over-long or missing slug is a 404 before any lookup" RED
 * - handler.ts:285  let a pre-card error escape GET (rethrow) -> "19", "19b" RED
 * - handler.ts:109  ctx stack lookup without the `default` rule -> "22" RED
 * - handler.ts:183  always pass the request to site() -> "18" RED
 * - handler.ts:191  ask for a draft on a normal request -> "2" (draft not called) RED
 * - handler.ts:263  drop the shed branch -> "8" (shed event) RED
 * - handler.ts:171  (equivalent mutant) `urlKind in kindIndex`: the later `Object.hasOwn(d.targets, ...)` guard still answers 404 -> "15b"
 * - handler.ts:148  fallback keeps unsupported glyphs in the site name -> "10b: the fallback drops site-name characters no font draws" RED
 * - handler.ts:250  give a downgraded card the real etag -> "26: a downgraded (hero-less) card carries no etag" RED
 * - handler.ts:163  ignore `params.id` -> "27: an :id route (params.id, no slug) is served" RED
 * - handler.ts:253  emit a hit/render event for a fresh render too -> "28: a fresh render is counted once" RED
 * - handler.ts:168  let a static card answer on a pinned route -> "29: a route pinned to a target never answers for a static card" RED
 * - handler.ts:181  run the document lookup outside the admission gate -> "31: lookups before admission are bounded" RED
 * - handler.ts:256  answer 304 before the bytes exist (early return) -> "30: a revalidation is answered 304 only when the current bytes are available" RED
 * - handler.ts:138  do not tell the hero loader which upload collection to read -> "32: the hero loader is told which upload collection the hero belongs to" RED
 * - handler.ts:183  Promise.all instead of allSettled (a fonts failure frees the admission slot while the site read runs) -> "33: the admission slot is held until BOTH the fonts and the site read have settled" RED */
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { createGate } from '../../src/internal/gate.js'
import { CACHE, createCardHandler } from '../../src/internal/handler.js'
import { createMemo } from '../../src/internal/memo.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { payloadHeroLoader } from '../../src/render/hero.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts, realPng, relatedUploads, uploadsFrom, verifiedUpload } from '../helpers.js'

const post = defineTemplate<{ title: string; label: string }>({
  id: 'post',
  revision: '1',
  required: (p) => !!p.title,
  textFields: ['title'],
  render: (p) => ({ type: 'div', props: { children: p.title } }) as never,
})
const fallback = defineTemplate<{ site: string }>({ id: 'fallback', revision: '1', render: () => ({ type: 'div', props: {} }) as never })
const tick = () => new Promise((r) => setImmediate(r))

function setup(over: Record<string, unknown> = {}, opts: { renderFails?: boolean } = {}) {
  const published = new Map<string, any>([
    ['a', { id: 1, slug: 'a', title: 'Published A' }],
    ['%', { id: 3, slug: '%', title: 'Percent' }],
    ['h', { id: 2, slug: 'h', title: 'Hero', heroImage: { id: 9, url: '/media/h.jpg', updatedAt: 'u1', filename: 'h.jpg' } }],
  ])
  const drafts = new Map<string, any>([['a', { id: 1, slug: 'a', title: 'Draft A' }]])
  const store = memoryStore()
  const put = vi.spyOn(store, 'put')
  const get = vi.spyOn(store, 'get')
  const renderer = {
    render: vi.fn(async (el: any) => {
      if (opts.renderFails && typeof el?.props?.children === 'string' && el.props.children !== '') throw new Error('satori exploded')
      return realPng(String(el?.props?.children ?? ''))
    }),
  }
  const heroLoader = vi.fn(async () => 'data:image/png;base64,AAAA')
  const site = vi.fn(async (_r?: Request) => ({ name: 'Site' }))
  const draft = vi.fn(async (_: string, k: { slug?: string }, r: Request) =>
    r.headers.get('x-test-editor') ? (drafts.get(k.slug as string) ?? null) : null,
  )
  const events = { emit: vi.fn() }
  const deps = {
    targets: {
      posts: defineTarget({
        path: '/og/:kind/:slug/card.png',
        template: 'post',
        props: ({ doc }: any) => ({ title: doc.title, label: 'Blog' }),
        hero: ({ doc }: any) => doc.heroImage,
      }),
    },
    statics: {},
    templates: new Map([['post', post]]),
    fonts: loadTestFonts,
    stacks: { title: ['Inter'] },
    serverUrl: 'https://x.test',
    source: {
      published: async (_: string, s: string) => published.get(s) ?? null,
      publishedById: async () => null,
      draft,
      site,
      related: relatedUploads(published.get('h')),
      uploads: uploadsFrom(relatedUploads(published.get('h'))),
    },
    store,
    renderer,
    heroLoader,
    uploadCollection: 'media',
    gate: createGate(),
    memo: createMemo(),
    events,
    isDraftRequest: async (r: Request) => r.headers.get('x-test-draft-mode') === '1',
    fallback,
    ...over,
  }
  return { h: createCardHandler(deps as never), put, get, renderer, heroLoader, store, events, site, draft }
}
const ctx = (slug: string, kind = 'posts') => ({ params: Promise.resolve({ kind, slug }) })
const req = (p: string, headers: Record<string, string> = {}) => new Request(`https://x.test${p}`, { headers })
const vOf = (r: Response) => (r.headers.get('etag') as string).replaceAll('"', '')
const DRAFT = { 'x-test-draft-mode': '1', 'x-test-editor': '1' }
const names = (events: { emit: ReturnType<typeof vi.fn> }) => events.emit.mock.calls.map(([e]) => e.name)

describe('card handler: a populated hero on a site with several upload collections', () => {
  it("is drawn from its own collection's folder, with no heroCollection on the target", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'og-photos-'))
    await writeFile(
      path.join(dir, 'h.jpg'),
      await sharp({ create: { width: 600, height: 400, channels: 3, background: '#336699' } })
        .jpeg()
        .toBuffer(),
    )
    const populated = verifiedUpload({ id: 9, url: '/media/h.jpg', updatedAt: 'u1', filename: 'h.jpg' }, 'photos')
    const source = {
      published: async () => ({ id: 2, slug: 'h', title: 'Hero', heroImage: populated }),
      publishedById: async () => null,
      draft: async () => null,
      site: async () => ({ name: 'Site' }),
      related: async (collection: string) => (collection === 'photos' ? populated : null),
      uploads: uploadsFrom(async (collection: string) => (collection === 'photos' ? populated : null)),
    }
    // Two upload collections: only `photos` has the file, and the loader finds a folder only for a collection it is told.
    const heroLoader = payloadHeroLoader({ staticDirs: async (collection) => (collection === 'photos' ? [dir] : []) })
    const { h } = setup({ source, uploadCollection: undefined, heroLoader })
    const r = await h.GET(req('/og/posts/h/card.png'), ctx('h'))
    expect([r.status, r.headers.get('x-og-cache')]).toEqual([200, 'render']) // 'downgraded' would mean no hero was found
  })
})

describe('card handler', () => {
  it('1: an unknown slug is a 404 no-store and renders nothing', async () => {
    const { h, renderer } = setup()
    const r = await h.GET(req('/og/posts/nope/card.png'), ctx('nope'))
    expect([r.status, r.headers.get('cache-control')]).toEqual([404, 'no-store'])
    expect(renderer.render).not.toHaveBeenCalled()
  })
  it('2: the current v is served immutable with type, length and etag; a repeat comes from the memo', async () => {
    const { h, draft } = setup()
    const first = await h.GET(req('/og/posts/a/card.png'), ctx('a'))
    const v = vOf(first)
    const r = await h.GET(req(`/og/posts/a/card.png?v=${v}`), ctx('a'))
    const bytes = new Uint8Array(await r.arrayBuffer())
    expect([r.status, r.headers.get('content-type'), r.headers.get('cache-control'), r.headers.get('etag')]).toEqual([
      200,
      'image/png',
      CACHE.immutable,
      `"${v}"`,
    ])
    expect(r.headers.get('content-length')).toBe(String(bytes.byteLength))
    expect(r.headers.get('x-og-cache')).toBe('memo')
    expect(first.headers.get('x-og-cache')).toBe('render')
    expect(draft).not.toHaveBeenCalled() // a normal request never asks for a draft
  })
  it('3: a stale ?v is served short, stored under the CURRENT v, never immutable', async () => {
    const { h, put } = setup()
    const r = await h.GET(req('/og/posts/a/card.png?v=stale'), ctx('a'))
    expect(r.headers.get('cache-control')).toBe(CACHE.short)
    expect(put).toHaveBeenCalledWith(expect.any(String), vOf(r), expect.any(Uint8Array), 'png')
    expect(put.mock.calls.some(([, k]) => k === 'stale')).toBe(false)
  })
  it('3b: concurrent requests with different ?v values for one card render once', async () => {
    const { h, renderer } = setup()
    await Promise.all(['x', 'y', 'z'].map((v) => h.GET(req(`/og/posts/a/card.png?v=${v}`), ctx('a'))))
    expect(renderer.render).toHaveBeenCalledTimes(1)
  })
  it('4: a store hit renders nothing and loads no hero', async () => {
    const first = setup()
    const r0 = await first.h.GET(req('/og/posts/h/card.png'), ctx('h'))
    expect(first.heroLoader).toHaveBeenCalledTimes(1) // the fixture hero is real, so the guard below is not vacuous
    const { h, renderer, heroLoader, store } = setup()
    await store.put((first.put.mock.calls[0] as unknown[])[0] as string, vOf(r0), await realPng('stored'))
    const r = await h.GET(req(`/og/posts/h/card.png?v=${vOf(r0)}`), ctx('h'))
    expect(r.headers.get('x-og-cache')).toBe('store')
    expect(r.headers.get('cache-control')).toBe(CACHE.immutable)
    expect(renderer.render).not.toHaveBeenCalled()
    expect(heroLoader).not.toHaveBeenCalled()
  })
  it('a store hit in the steady state reads no hero file: the transparency probe is remembered, not repeated', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'og-steady-'))
    const clear = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } })
      .png()
      .toBuffer()
    await writeFile(path.join(dir, 'h.jpg'), clear) // the name the fixture hero has; the bytes are what sharp reads
    let reads = 0
    const loader = payloadHeroLoader({
      staticDirs: async () => {
        reads += 1
        return [dir]
      },
    })
    const first = setup({ heroLoader: loader })
    const r0 = await first.h.GET(req('/og/posts/h/card.png'), ctx('h'))
    expect(r0.status).toBe(200)
    expect(reads).toBeGreaterThan(0) // the miss probed and prepared the hero: the guard below is not vacuous
    const { h, store, renderer } = setup({ heroLoader: loader })
    await store.put((first.put.mock.calls[0] as unknown[])[0] as string, vOf(r0), await realPng('stored'))
    const before = reads
    const r = await h.GET(req(`/og/posts/h/card.png?v=${vOf(r0)}`), ctx('h'))
    expect(r.headers.get('x-og-cache')).toBe('store')
    expect(renderer.render).not.toHaveBeenCalled()
    expect(reads).toBe(before)
  })
  it("a ground set on the target reaches the hero loader; a card without one passes none, so the plugin's applies", async () => {
    const withGround = {
      targets: {
        posts: defineTarget({
          path: '/og/:kind/:slug/card.png',
          template: 'post',
          heroBackground: '#336699',
          props: ({ doc }: any) => ({ title: doc.title, label: 'Blog' }),
          hero: ({ doc }: any) => doc.heroImage,
        }),
      },
    }
    const set = setup(withGround)
    await set.h.GET(req('/og/posts/h/card.png'), ctx('h'))
    expect((set.heroLoader.mock.calls[0] as unknown[])[2]).toEqual({ collection: 'media', background: '#336699' })
    const plain = setup()
    await plain.h.GET(req('/og/posts/h/card.png'), ctx('h'))
    expect(((plain.heroLoader.mock.calls[0] as unknown[])[2] as { background?: string }).background).toBeUndefined()
  })
  it('6: draft mode + editor -> draft words, no-store, nothing stored, the published card untouched', async () => {
    const { h, put, renderer } = setup()
    const r = await h.GET(req('/og/posts/a/card.png', DRAFT), ctx('a'))
    expect([r.headers.get('cache-control'), r.headers.get('x-og-cache')]).toEqual(['no-store', 'draft'])
    expect((renderer.render.mock.calls[0] as any)[0].props.children).toBe('Draft A')
    expect(put).not.toHaveBeenCalled()
    expect((await h.GET(req('/og/posts/a/card.png'), ctx('a'))).headers.get('x-og-cache')).toBe('render')
  })
  it('7: draft mode WITHOUT an editor -> published words, still no-store, x-og-cache draft, nothing stored', async () => {
    const { h, put, renderer } = setup()
    const r = await h.GET(req('/og/posts/a/card.png', { 'x-test-draft-mode': '1' }), ctx('a'))
    expect([r.headers.get('cache-control'), r.headers.get('x-og-cache')]).toEqual(['no-store', 'draft'])
    expect((renderer.render.mock.calls[0] as any)[0].props.children).toBe('Published A')
    expect(put).not.toHaveBeenCalled()
  })
  it('7b: a draft-mode request never reads or fills the memo or the store', async () => {
    const { h, get, put } = setup()
    await h.GET(req('/og/posts/a/card.png'), ctx('a')) // warm: published card is stored and memoised
    get.mockClear()
    put.mockClear()
    const r = await h.GET(req('/og/posts/a/card.png', DRAFT), ctx('a'))
    expect(r.headers.get('x-og-cache')).toBe('draft')
    expect(get).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })
  it('8: a full queue sheds with 503, retry-after 5 and no-store', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const { h, renderer, events } = setup({ gate: createGate({ concurrency: 1, queue: 0 }) })
    renderer.render.mockImplementationOnce(async () => {
      await held
      return realPng('held')
    })
    const first = h.GET(req('/og/posts/a/card.png'), ctx('a'))
    await tick()
    await tick()
    const r = await h.GET(req('/og/posts/h/card.png'), ctx('h'))
    expect([r.status, r.headers.get('retry-after'), r.headers.get('cache-control')]).toEqual([503, '5', 'no-store'])
    expect(names(events)).toContain('shed')
    release()
    expect((await first).status).toBe(200)
  })
  it('10: a throwing renderer serves the fallback degraded, emits render_error, stores nothing, and reuses the memoised fallback', async () => {
    const { h, put, renderer, events } = setup({}, { renderFails: true })
    for (let i = 0; i < 2; i++) {
      const r = await h.GET(req('/og/posts/a/card.png'), ctx('a'))
      expect([r.status, r.headers.get('cache-control'), r.headers.get('x-og-cache')]).toEqual([200, CACHE.degraded, 'fallback'])
    }
    expect(names(events)).toContain('render_error')
    expect(put).not.toHaveBeenCalled()
    const fallbackDraws = renderer.render.mock.calls.filter(([el]: any) => el?.props?.children === undefined)
    expect(fallbackDraws).toHaveLength(1)
  })
  it('10b: the fallback drops site-name characters no font draws', async () => {
    const seen: string[] = []
    const fb = defineTemplate<{ site: string }>({
      id: 'fb',
      revision: '1',
      render: (p) => {
        seen.push(p.site)
        return { type: 'div', props: {} } as never
      },
    })
    const { h } = setup(
      {
        fallback: fb,
        stacks: { title: ['Inter'], default: ['Inter'] },
        source: {
          published: async () => ({ id: 1, slug: 'a', title: 'T' }),
          publishedById: async () => null,
          draft: async () => null,
          site: async () => ({ name: 'Acme 🚀 Co' }),
        },
      },
      { renderFails: true },
    )
    expect((await h.GET(req('/og/posts/a/card.png'), ctx('a'))).headers.get('x-og-cache')).toBe('fallback')
    expect(seen).toEqual(['Acme Co'])
  })
  it('11: a slug of "%" (Next already decoded %25) is looked up as "%" and does not throw', async () => {
    const { h } = setup()
    const r = await h.GET(req('/og/posts/%25/card.png'), ctx('%'))
    expect(r.status).toBe(200)
  })
  it('12: fixedTarget serves params with no kind', async () => {
    const { h } = setup({ fixedTarget: 'posts' })
    const r = await h.GET(req('/x/a/og.png'), { params: Promise.resolve({ slug: 'a' }) })
    expect(r.status).toBe(200)
  })
  it('13: If-None-Match with the current v is a 304 with no body (a list and a weak tag also match)', async () => {
    const { h } = setup()
    const v = vOf(await h.GET(req('/og/posts/a/card.png'), ctx('a')))
    for (const inm of [`"${v}"`, `W/"${v}"`, `"other", "${v}"`, '*']) {
      const r = await h.GET(req(`/og/posts/a/card.png?v=${v}`, { 'if-none-match': inm }), ctx('a'))
      expect([r.status, await r.text()]).toEqual([304, ''])
    }
    const stale = await h.GET(req('/og/posts/a/card.png?v=old', { 'if-none-match': `"${v}"` }), ctx('a'))
    expect(stale.status).toBe(200) // only the current version may be answered 304
  })
  const indexCard = {
    path: '/og/index/blog/card.png',
    kind: 'index',
    slug: 'blog',
    template: 'post',
    props: () => ({ title: 'Blog', label: '' }),
  }
  it('14: a static card is served', async () => {
    const { h } = setup({ statics: { blog: indexCard } })
    const r = await h.GET(req('/og/index/blog/card.png'), ctx('blog', 'index'))
    expect([r.status, r.headers.get('x-og-cache')]).toEqual([200, 'render'])
  })
  it('14b: a static card kind that collides with a target kind, or two statics with one key, fail at construction', () => {
    expect(() => setup({ statics: { a: { ...indexCard, kind: 'posts' } } })).toThrow(/collides with a target kind/)
    expect(() => setup({ statics: { a: indexCard, b: indexCard } })).toThrow(/share "index\/blog"/)
  })
  it('15: a target with kind "post" answers /post/ and 404s on its name', async () => {
    const targets = {
      posts: defineTarget({
        path: '/og/:kind/:slug/card.png',
        kind: 'post',
        template: 'post',
        props: ({ doc }: any) => ({ title: doc.title, label: '' }),
      }),
    }
    const { h } = setup({ targets })
    expect((await h.GET(req('/og/post/a/card.png'), ctx('a', 'post'))).status).toBe(200)
    expect((await h.GET(req('/og/posts/a/card.png'), ctx('a', 'posts'))).status).toBe(404)
  })
  it('15b: prototype-member kinds are not kinds', async () => {
    const { h } = setup()
    for (const kind of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect((await h.GET(req('/x'), ctx('a', kind))).status).toBe(404)
    }
  })
  it('16: draft mode on a static card is no-store and stores nothing', async () => {
    const { h, put } = setup({ statics: { blog: indexCard } })
    const r = await h.GET(req('/og/index/blog/card.png', { 'x-test-draft-mode': '1' }), ctx('blog', 'index'))
    expect([r.headers.get('cache-control'), r.headers.get('x-og-cache')]).toEqual(['no-store', 'draft'])
    expect(put).not.toHaveBeenCalled()
  })
  it('17: concurrent GETs with an unreadable hero are both degraded, none immutable, nothing stored, not memoised', async () => {
    const unreadable = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return null
    })
    const { h, put } = setup({ heroLoader: unreadable })
    const v = vOf(await setup().h.GET(req('/og/posts/h/card.png'), ctx('h')))
    const pair = await Promise.all([1, 2].map(() => h.GET(req(`/og/posts/h/card.png?v=${v}`), ctx('h'))))
    for (const r of pair) expect([r.headers.get('cache-control'), r.headers.get('x-og-cache')]).toEqual([CACHE.degraded, 'downgraded'])
    expect(put).not.toHaveBeenCalled()
    await h.GET(req('/og/posts/h/card.png'), ctx('h'))
    expect(unreadable.mock.calls.length).toBe(2)
  })
  it('18: site() gets no request for a normal GET and the request in draft mode', async () => {
    const { h, site } = setup()
    await h.GET(req('/og/posts/a/card.png'), ctx('a'))
    expect(site).toHaveBeenLastCalledWith(undefined)
    const draftReq = req('/og/posts/a/card.png', DRAFT)
    await h.GET(draftReq, ctx('a'))
    expect(site).toHaveBeenLastCalledWith(draftReq)
  })
  it('19: a resolver error (props is a Map) is a 503 no-store with an event, never an escape', async () => {
    const targets = { posts: defineTarget({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => new Map() as never }) }
    const { h, events } = setup({ targets })
    const r = await h.GET(req('/og/posts/a/card.png'), ctx('a'))
    expect([r.status, r.headers.get('cache-control')]).toEqual([503, 'no-store'])
    expect(names(events)).toContain('render_error')
  })
  it('19b: a failing source, fonts or site never escapes either', async () => {
    for (const over of [
      { fonts: async () => Promise.reject(new Error('fonts')) },
      {
        source: {
          published: async () => Promise.reject(new Error('db')),
          publishedById: async () => null,
          draft: async () => null,
          site: async () => ({ name: 'S' }),
        },
      },
      {
        source: {
          published: async () => null,
          publishedById: async () => null,
          draft: async () => null,
          site: async () => Promise.reject(new Error('site')),
        },
      },
    ]) {
      const r = await setup(over).h.GET(req('/og/posts/a/card.png'), ctx('a'))
      expect([r.status, r.headers.get('cache-control')]).toEqual([503, 'no-store'])
    }
  })
  it('20: if the draft check itself fails the request is treated as a draft: no-store, nothing stored or memoised', async () => {
    const { h, put, get } = setup({ isDraftRequest: async () => Promise.reject(new Error('cookies unavailable')) })
    const r = await h.GET(req('/og/posts/a/card.png'), ctx('a'))
    expect([r.headers.get('cache-control'), r.headers.get('x-og-cache')]).toEqual(['no-store', 'draft'])
    expect(put).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })
  it('21: a render error in draft mode serves the fallback no-store and never memoises it', async () => {
    const { h, renderer } = setup({}, { renderFails: true })
    for (let i = 0; i < 2; i++) {
      const r = await h.GET(req('/og/posts/a/card.png', DRAFT), ctx('a'))
      expect([r.status, r.headers.get('cache-control'), r.headers.get('x-og-cache')]).toEqual([200, 'no-store', 'fallback'])
    }
    expect(renderer.render.mock.calls.filter(([el]: any) => el?.props?.children === undefined)).toHaveLength(2)
  })
  it('22: ctx.fit and ctx.font resolve a stack by name, then "default", the same way the resolver strips', async () => {
    const seen: string[] = []
    const t = defineTemplate<{ title: string }>({
      id: 'ctx',
      revision: '1',
      textFields: ['title'],
      render: (p, ctx) => {
        seen.push(ctx.font('missing', p.title))
        seen.push(String(ctx.fit(p.title, { width: 400, height: 200, maxSize: 60, minSize: 40, leading: 1 }, 'missing').size))
        return { type: 'div', props: { children: p.title } } as never
      },
    })
    const targets = {
      posts: defineTarget({ path: '/og/:kind/:slug/card.png', template: 'ctx', props: ({ doc }: any) => ({ title: doc.title }) }),
    }
    const base = { targets, templates: new Map([['ctx', t]]) }
    const ok = setup({ ...base, stacks: { default: ['Inter'] } })
    expect((await ok.h.GET(req('/og/posts/a/card.png'), ctx('a'))).status).toBe(200)
    expect(seen).toEqual(['Inter', '60'])
    // No named and no default stack: a clear error answered as 503, not an undefined family.
    const bad = setup({ ...base, stacks: { other: ['Inter'] } })
    expect((await bad.h.GET(req('/og/posts/a/card.png'), ctx('a'))).status).toBe(503)
  })
  it('23: serverUrl must be an absolute http(s) URL, and the host never comes from the request', async () => {
    expect(() => setup({ serverUrl: '/relative' })).toThrow(/absolute URL/)
    expect(() => setup({ serverUrl: 'ftp://x.test' })).toThrow(/http\(s\)/)
    const a = vOf(await setup().h.GET(req('/og/posts/a/card.png'), ctx('a')))
    const b = vOf(await setup().h.GET(new Request('https://evil.test/og/posts/a/card.png', { headers: { host: 'evil.test' } }), ctx('a')))
    expect(b).toBe(a)
  })
  it('24: an over-long or missing slug is a 404 before any lookup', async () => {
    const published = vi.fn(async () => null)
    const source = { published, publishedById: async () => null, draft: async () => null, site: async () => ({ name: 'S' }) }
    const { h } = setup({ source })
    expect((await h.GET(req('/x'), ctx('a'.repeat(257)))).status).toBe(404)
    expect((await h.GET(req('/x'), { params: Promise.resolve({ kind: 'posts' }) })).status).toBe(404)
    expect(published).not.toHaveBeenCalled()
  })
  it('26: a downgraded (hero-less) card carries no etag, so a cache cannot later revalidate it into a 304 that pins it as the current card', async () => {
    const { h } = setup({ heroLoader: async () => null })
    const v = vOf(await setup().h.GET(req('/og/posts/h/card.png'), ctx('h')))
    const r = await h.GET(req(`/og/posts/h/card.png?v=${v}`), ctx('h'))
    expect([r.status, r.headers.get('x-og-cache'), r.headers.get('etag')]).toEqual([200, 'downgraded', null])
  })
  it('27: an :id route (params.id, no slug) is served', async () => {
    const targets = {
      posts: defineTarget<any, any>({
        path: '/cards/:id.png',
        slugField: 'id',
        template: 'post',
        props: ({ doc }: any) => ({ title: doc.title, label: '' }),
      }),
    }
    const { h } = setup({
      targets,
      fixedTarget: 'posts',
      source: {
        published: async (_t: string, key: string) => (key === '1' ? { id: 1, title: 'Hi' } : null),
        publishedById: async () => null,
        draft: async () => null,
        site: async () => ({ name: 'S' }),
      },
    })
    expect((await h.GET(req('/cards/1.png'), { params: Promise.resolve({ id: '1' }) })).status).toBe(200)
  })
  it('28: a fresh render is counted once; only hits add their own event', async () => {
    const { h, events } = setup()
    await h.GET(req('/og/posts/a/card.png'), ctx('a'))
    await h.GET(req('/og/posts/a/card.png'), ctx('a'))
    expect(names(events).filter((n) => n === 'render')).toHaveLength(1)
    expect(names(events).filter((n) => n === 'hit_memo')).toHaveLength(1)
  })
  it('29: a route pinned to a target never answers for a static card', async () => {
    const staticCard = {
      path: '/og/index/blog/card.png',
      kind: 'posts',
      slug: 'a',
      template: 'post',
      props: () => ({ title: 'STATIC', label: '' }),
    }
    const targets = {
      posts: defineTarget<any, any>({
        path: '/og/:kind/:slug/card.png',
        kind: 'article',
        template: 'post',
        props: ({ doc }: any) => ({ title: doc.title, label: '' }),
      }),
    }
    const { h, renderer } = setup({ targets, statics: { s: staticCard }, fixedTarget: 'posts' })
    await h.GET(req('/x/a/og.png'), { params: Promise.resolve({ slug: 'a' }) })
    expect((renderer.render.mock.calls[0] as any)[0].props.children).toBe('Published A')
  })
  it('30: a revalidation is answered 304 only when the current bytes are available; a downgrade, a fallback or a shed is answered as itself', async () => {
    const inm = (v: string) => ({ 'if-none-match': `"${v}"` })
    const v = vOf(await setup().h.GET(req('/og/posts/h/card.png'), ctx('h')))
    const down = await setup({ heroLoader: async () => null }).h.GET(req(`/og/posts/h/card.png?v=${v}`, inm(v)), ctx('h'))
    expect([down.status, down.headers.get('x-og-cache'), down.headers.get('cache-control')]).toEqual([200, 'downgraded', CACHE.degraded])
    const failing = await setup({}, { renderFails: true }).h.GET(req(`/og/posts/a/card.png?v=${v}`, inm(v)), ctx('a'))
    expect([failing.status, failing.headers.get('x-og-cache')]).toEqual([200, 'fallback'])
    const ok = setup()
    await ok.h.GET(req('/og/posts/a/card.png'), ctx('a'))
    const va = vOf(await ok.h.GET(req('/og/posts/a/card.png'), ctx('a')))
    const hit = await ok.h.GET(req(`/og/posts/a/card.png?v=${va}`, inm(va)), ctx('a'))
    expect([hit.status, hit.headers.get('cache-control'), hit.headers.get('etag'), hit.headers.get('content-type')]).toEqual([
      304,
      CACHE.immutable,
      `"${va}"`,
      'image/png',
    ])
  })
  it('31: lookups before admission are bounded: a burst of distinct slugs reaches the database at most `concurrency` at a time, and the overflow is shed', async () => {
    let inFlight = 0
    let peak = 0
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const published = vi.fn(async (_t: string, slug: string) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await held
      inFlight -= 1
      return { id: 1, slug, title: slug }
    })
    const source = { published, publishedById: async () => null, draft: async () => null, site: async () => ({ name: 'S' }) }
    const { h, events } = setup({ source, admission: createGate({ concurrency: 2, queue: 3 }) })
    const burst = Array.from({ length: 10 }, (_, i) => h.GET(req(`/og/posts/s${i}/card.png`), ctx(`s${i}`)))
    await tick()
    await tick()
    release()
    const res = await Promise.all(burst)
    expect(peak).toBe(2)
    expect(published).toHaveBeenCalledTimes(5) // 2 admitted + 3 queued; the other 5 never reached the database
    expect(res.filter((r) => r.status === 503).map((r) => [r.headers.get('retry-after'), r.headers.get('cache-control')])).toEqual(
      Array(5).fill(['5', 'no-store']),
    )
    expect(res.filter((r) => r.status === 200)).toHaveLength(5)
    expect(names(events)).toContain('shed')
  })
  it('32: the hero loader is told which upload collection the hero belongs to', async () => {
    const targets = {
      posts: defineTarget<any, any>({
        path: '/og/:kind/:slug/card.png',
        template: 'post',
        heroCollection: 'media',
        props: ({ doc }: any) => ({ title: doc.title, label: '' }),
        hero: ({ doc }: any) => doc.heroImage,
      }),
    }
    const { h, heroLoader } = setup({ targets })
    await h.GET(req('/og/posts/h/card.png'), ctx('h'))
    expect((heroLoader.mock.calls[0] as unknown[])[2]).toEqual({ collection: 'media' })
  })
  it('33: the admission slot is held until BOTH the fonts and the site read have settled (a fonts failure cannot free it while a database read goes on)', async () => {
    let release!: () => void
    const siteHeld = new Promise<void>((r) => {
      release = r
    })
    const site = vi.fn(async () => {
      await siteHeld
      return { name: 'S' }
    })
    const source = {
      published: async (_t: string, s: string) => ({ id: 1, slug: s, title: s }),
      publishedById: async () => null,
      draft: async () => null,
      site,
    }
    const { h } = setup({
      source,
      fonts: async () => Promise.reject(new Error('fonts down')),
      admission: createGate({ concurrency: 1, queue: 0 }),
    })
    const first = h.GET(req('/og/posts/a/card.png'), ctx('a'))
    await tick()
    await tick()
    // fonts already rejected, the site read is still running: the only slot must still be taken
    const second = await h.GET(req('/og/posts/b/card.png'), ctx('b'))
    expect([second.status, second.headers.get('cache-control')]).toEqual([503, 'no-store'])
    expect(site).toHaveBeenCalledTimes(1) // the second request never reached the database
    release()
    expect((await first).status).toBe(503)
  })
  it('25: a hostile slug never reaches an event field', async () => {
    const { h, events } = setup()
    await h.GET(req('/x'), ctx('nope\nevent=forged'))
    expect(JSON.stringify(events.emit.mock.calls)).not.toContain('forged')
  })
})
