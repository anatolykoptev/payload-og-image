/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a route that answers for the wrong target, a HEAD that is not GET's twin, a log that forges lines.
 * - runtime.ts:130  build the crawler wrapper per request (its counter never reaches `sample`) -> "crawlerEvents: one request in `sample` becomes a crawler event" RED
 * - runtime.ts:84  accept an unconfigured pinned target -> "a pinned target that is not configured fails" RED
 * - runtime.ts:59  ignore `disabled` -> "disabled: every card route answers 404 no-store" RED
 * - withHead.ts:13  leave the body un-cancelled -> "keeps a non-200 status ... cancels the body unread" RED
 * - withHead.ts:12  run the wrapped GET with the request's own method -> "answers HEAD from GET ... the GET copy is a GET" RED
 * - runtime.ts:40  emit a crawler event for every request (ignore the sample fraction) -> "a `sample` fraction of requests becomes a crawler event" RED */
import { getPayload, type Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRuntime, getRuntime, setTestRuntime } from '../../src/internal/runtime.js'
import { createState } from '../../src/internal/state.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { createOgRoute } from '../../src/next/route.js'
import { withHead } from '../../src/next/withHead.js'
import type { OgImagePluginOptions } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts, realPng } from '../helpers.js'

vi.mock('payload', async (orig) => ({ ...(await orig<typeof import('payload')>()), getPayload: vi.fn() }))

const post = defineTemplate<{ title: string }>({
  id: 'post',
  revision: '1',
  textFields: ['title'],
  render: (p) => ({ type: 'div', props: { children: p.title } }) as never,
})
const target = defineTarget<any, any>({
  path: '/og/:kind/:slug/card.png',
  template: 'post',
  props: ({ doc }: any) => ({ title: doc.title }),
})
const docs: Record<string, any> = { a: { id: 1, slug: 'a', title: 'A' } }

function runtime(over: Partial<OgImagePluginOptions> = {}) {
  const options: OgImagePluginOptions = {
    site: () => ({ name: 'Site' }),
    fonts: [],
    stacks: { default: ['Inter'] },
    templates: [post],
    targets: { posts: target, pages: defineTarget<any, any>({ ...target, kind: 'page' }) },
    store: { memory: true },
    ...over,
  }
  const state = createState(options, 'https://x.test')
  state.fonts = loadTestFonts
  const rt = buildRuntime(state, {} as Payload, {
    source: {
      published: async (_t, slug) => docs[slug] ?? null,
      publishedById: async () => null,
      draft: async () => null,
      site: async () => ({ name: 'Site' }),
    },
    store: memoryStore(),
    renderer: { render: async (el: any) => realPng(String(el?.props?.children ?? '')) },
    isDraftRequest: async () => false,
  })
  setTestRuntime(rt)
  return { rt, state }
}
afterEach(() => setTestRuntime(null))
const get = (url: string, slug: string, kind?: string, method = 'GET') => ({
  req: new Request(url, { method }),
  ctx: { params: Promise.resolve(kind ? { kind, slug } : { slug }) },
})

describe('createOgRoute', () => {
  it('answers through the runtime for any target', async () => {
    runtime()
    const { req, ctx } = get('https://x.test/og/posts/a/card.png', 'a', 'posts')
    expect((await createOgRoute({ config: {} as never }).GET(req, ctx)).status).toBe(200)
  })
  it('a route pinned to a target serves its slugs without a kind', async () => {
    runtime()
    const { req, ctx } = get('https://x.test/blog/a/og.png', 'a')
    expect((await createOgRoute({ config: {} as never, target: 'posts' }).GET(req, ctx)).status).toBe(200)
  })
  it('a pinned target that is not configured fails, rather than answering for something else', async () => {
    runtime()
    const { req, ctx } = get('https://x.test/x', 'a')
    await expect(createOgRoute({ config: {} as never, target: 'nope' }).GET(req, ctx)).rejects.toThrow(
      /target "nope" is not a configured target/,
    )
    await expect(createOgRoute({ config: {} as never, target: 'constructor' }).GET(req, ctx)).rejects.toThrow(/is not a configured target/)
  })
  it('HEAD = GET: a GET handler answers a HEAD request with the same status and headers (Next drops the body)', async () => {
    runtime()
    const route = createOgRoute({ config: {} as never })
    const HEAD = route.GET
    const g = await route.GET(...(Object.values(get('https://x.test/og/posts/a/card.png', 'a', 'posts')).map((x) => x) as [Request, never]))
    const hd = get('https://x.test/og/posts/a/card.png', 'a', 'posts', 'HEAD')
    const h = await HEAD(hd.req, hd.ctx)
    expect([h.status, h.headers.get('etag'), h.headers.get('cache-control'), h.headers.get('content-length')]).toEqual([
      g.status,
      g.headers.get('etag'),
      g.headers.get('cache-control'),
      g.headers.get('content-length'),
    ])
  })
  it('disabled: every card route answers 404 no-store, and metadata is empty', async () => {
    const { rt } = runtime({ disabled: true })
    const { req, ctx } = get('https://x.test/og/posts/a/card.png', 'a', 'posts')
    const r = await createOgRoute({ config: {} as never }).GET(req, ctx)
    expect([r.status, r.headers.get('cache-control')]).toEqual([404, 'no-store'])
    expect(await rt.resolveForMetadata({ target: 'posts', id: 1 })).toEqual({ kind: 'none' })
  })
  it('crawlerEvents: a `sample` fraction of requests becomes a crawler event naming the bot family, never the raw user agent', async () => {
    const events: Array<{ name: string; detail?: Record<string, unknown> }> = []
    runtime({ crawlerEvents: { sample: 0.5 }, onEvent: (e) => events.push(e) })
    const route = createOgRoute({ config: {} as never })
    for (const ua of ['LinkedInBot/1.0 (+https://secret.example/contact)', 'Mozilla/5.0 weird', 'facebookexternalhit/1.1', 'x']) {
      const { req, ctx } = get('https://x.test/og/posts/a/card.png', 'a', 'posts')
      await route.GET(new Request(req, { headers: { 'user-agent': ua } }), ctx)
    }
    const crawler = events.filter((e) => e.name === 'crawler')
    expect(crawler).toHaveLength(2)
    expect(crawler.map((e) => e.detail?.ua_family)).toEqual(['other', 'other'])
    expect(crawler[0]?.detail).toMatchObject({ method: 'GET', status: 200, cache: expect.stringMatching(/^(memo|render|store)$/) })
    expect(JSON.stringify(crawler)).not.toContain('secret.example')
  })
  it('crawlerEvents names the known bot families, lower-cased', async () => {
    const events: Array<{ name: string; detail?: Record<string, unknown> }> = []
    runtime({ crawlerEvents: { sample: 1 }, onEvent: (e) => events.push(e) })
    const route = createOgRoute({ config: {} as never })
    for (const ua of ['LinkedInBot/1.0', 'Twitterbot/1.0', 'facebookexternalhit/1.1']) {
      const { req, ctx } = get('https://x.test/og/posts/a/card.png', 'a', 'posts')
      await route.GET(new Request(req, { headers: { 'user-agent': ua } }), ctx)
    }
    expect(events.filter((e) => e.name === 'crawler').map((e) => e.detail?.ua_family)).toEqual([
      'linkedinbot',
      'twitterbot',
      'facebookexternalhit',
    ])
  })
  it('crawlerEvents off by default: no crawler events', async () => {
    const events: string[] = []
    runtime({ onEvent: (e) => events.push(e.name) })
    const { req, ctx } = get('https://x.test/og/posts/a/card.png', 'a', 'posts')
    await createOgRoute({ config: {} as never }).GET(new Request(req, { headers: { 'user-agent': 'LinkedInBot' } }), ctx)
    expect(events).not.toContain('crawler')
  })
  it('without the plugin in the config, the error says what to add', async () => {
    setTestRuntime(null)
    vi.mocked(getPayload).mockResolvedValue({ config: { custom: {} } } as never)
    await expect(getRuntime({} as never)).rejects.toThrow(/add ogImagePlugin/)
  })
})

describe('withHead', () => {
  it('answers HEAD from GET: GET status and headers, no body, the GET copy is a GET', async () => {
    const seen: string[] = []
    const get = async (r: Request) => {
      seen.push(r.method)
      return new Response('payload bytes', { status: 200, headers: { 'content-type': 'image/png', 'content-length': '13', etag: '"x"' } })
    }
    const res = await withHead(get)(new Request('https://x.test/api/media/file/a.png', { method: 'HEAD' }), {})
    expect(seen).toEqual(['GET'])
    expect([res.status, res.headers.get('content-type'), res.headers.get('content-length'), res.headers.get('etag')]).toEqual([
      200,
      'image/png',
      '13',
      '"x"',
    ])
    expect(await res.text()).toBe('')
  })
  it('keeps a non-200 status (an unknown file answers HEAD the way it answers GET) and cancels the body unread', async () => {
    let cancelled = false
    const body = new ReadableStream({
      cancel: () => {
        cancelled = true
      },
    })
    const res = await withHead(async () => new Response(body, { status: 404, statusText: 'Nope' }))(
      new Request('https://x.test/api/x', { method: 'HEAD' }),
      {},
    )
    expect([res.status, res.statusText]).toEqual([404, 'Nope'])
    expect(cancelled).toBe(true)
  })
})
