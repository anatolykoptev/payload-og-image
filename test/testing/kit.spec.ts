/** Mutation table (production line -> the test that goes RED). Each check must pass on a correct setup and fail on a site module the test breaks by hand.
 * - kit.ts:103  accept a page with no og:image -> "everyRouteHasOwnCard > rejects a metadata function that returns no image" RED
 * - kit.ts:134  do not require the advertised card to be immutable -> "rejects a card URL carrying ?v=wrong: it answers 1h, not immutable" RED
 * - kit.ts:116  allow two routes to share one card -> "rejects two routes sharing one card unless allowShared" RED
 * - kit.ts:109  accept an image with no alt -> same test RED
 * - kit.ts:206  never report a path/route mismatch -> "routesMatchPaths > rejects a route file ... naming both" RED
 * - kit.ts:326  ignore a HEAD status that differs -> "headParity > rejects a HEAD that answers a different status" RED
 * - kit.ts:332  ignore header differences -> "rejects a route module whose HEAD answers an empty 200" RED
 * - kit.ts:397  accept bytes that changed under an unchanged URL -> "versionCoversEverythingDrawn > rejects a template that draws module-level state" RED
 * - kit.ts:301  accept a queue that never sheds -> "queueSheds rejects a route that hides the shedding" RED
 * - kit.ts:227  accept a cacheable draft answer -> "draftNeverCached rejects a route that makes draft answers cacheable" RED
 * - kit.ts:344  accept an immutable stale version -> "staleVersionShort rejects a route that serves every version immutable" RED
 * - kit.ts:460  ignore the byte budget -> "sizeBudget rejects a card over the budget" RED
 * - kit.ts:440  ignore missing glyphs -> "glyphCoverage passes ... and rejects an emoji" RED
 * - kit.ts:449  measure sizes on the stub renderer -> "sizeBudget > passes within budget on the real renderer, and refuses to measure the stub renderer" RED
 * - kit.ts:455  count an error answer as a card -> "sizeBudget > does not count an error answer as a card" RED
 * - kit.ts:191  route files must equal configured paths literally -> "routesMatchPaths: a templated route file serves literal static-card paths" RED
 * - kit.ts:43  a static card's params from the URL only -> "the kit fetches a static card at a literal path of its own" RED
 * - kit.ts:121  wave a versioned URL at an unowned path through as an editor image -> "everyRouteHasOwnCard: a versioned URL at a path no card route owns" RED
 * - kit.ts:303  accept any positive shed count -> "queueSheds exact admission" RED
 * - runtime.ts:164  bypass the cached site() in the test runtime -> "the test runtime serves the CACHED site()" RED
 * - kit.ts:278  (requestVersionNeverStored probes run cold: covered by the dev spec's `request v never stored`, which goes RED when the handler stores under the request's ?v)
 * - kit.ts:238  an editor in draft mode gets the published card -> dev spec "draft never cached" RED (mutation: draft() returns nothing)
 * - kit.ts:240  a draft-mode visitor without an editor gets the draft -> "draftNeverCached: ... rejects a route that gives an anonymous draft-mode visitor the editor's draft" RED
 * - kit.ts:242  a draft preview served from a memo -> dev spec "draft never cached" RED (mutation: memo in the draft branch)
 * - kit.ts:244  a draft preview reads the store -> dev spec "draft never cached" RED (mutation: store.get in the draft branch)
 * - kit.ts:245  a draft preview writes the store -> dev spec "draft never cached" RED (mutation: store.put in the draft branch)
 * - kit.ts:146  accept a non-PNG body -> "everyRouteHasOwnCard: an unrecognised URL fails..." RED
 * - kit.ts:126  accept an unrecognised image URL -> same test RED
 * - kit.ts:148  ignore the advertised width/height -> same test RED
 * - kit.ts:371  a requestVersionNeverStored with no write -> "requestVersionNeverStored fails when no probe wrote anything" RED
 * - kit.ts:417  (downgradeNotStored etag check) accept an etag on a downgraded card -> "downgradeNotStored rejects a downgraded card that carries an etag" RED
 * - kit.ts:330  ignore content-length in HEAD parity -> "headParity rejects a HEAD whose content-length differs from GET" RED
 * - kit.ts:458  measure a fallback body -> "sizeBudget refuses a fallback body" RED */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { installTestRuntime, ogKit } from '../../src/exports/testing.js'
import { CACHE } from '../../src/internal/handler.js'
import { setTestRuntime } from '../../src/internal/runtime.js'
import { ogMetadata } from '../../src/next/metadata.js'
import type { OgImagePluginOptions } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'

const font = () => readFile(new URL('../fixtures/fonts/inter-latin-cyrillic-800.woff', import.meta.url))
let theme = 'a' // module-level state a template might (wrongly) read instead of its props
const post = defineTemplate<{ title: string; label: string; site: string }>({
  id: 'post',
  revision: '1',
  required: (p) => p.title.trim() !== '',
  textFields: ['title'],
  render: (p, ctx) =>
    createElement(
      'div',
      {
        style: {
          display: 'flex',
          width: '100%',
          height: '100%',
          fontSize: 64,
          fontFamily: ctx.font('default', p.title),
          background: theme === 'a' ? '#112233' : '#eeddcc',
          color: '#fff',
        },
      },
      p.title,
    ),
})
const options = (over: Partial<OgImagePluginOptions> = {}): OgImagePluginOptions => ({
  site: async ({ payload }) => ({ name: ((await payload.findGlobal({ slug: 'site-settings' })) as { name: string }).name }),
  siteGlobals: ['site-settings'],
  fonts: [{ family: 'Inter', weight: 800, data: font }],
  stacks: { default: ['Inter'] },
  templates: [post],
  targets: {
    posts: defineTarget<any, any>({
      path: '/og/:kind/:slug/card.png',
      template: 'post',
      props: ({ doc, site }: any) => ({ title: doc.title, label: 'Blog', site: site.name }),
      hero: ({ doc }: any) => doc.heroImage,
    }),
  },
  store: { memory: true },
  ...over,
})
const docs = () => ({
  published: {
    posts: [
      { id: 1, slug: 'a', title: 'Alpha' },
      { id: 2, slug: 'b', title: 'Beta' },
      { id: 3, slug: 'hero', title: 'Hero', heroImage: { id: 9, url: '/m/h.jpg', filename: 'h.jpg', updatedAt: 'u1' } },
      {
        id: 4,
        slug: 'hero-missing-file',
        title: 'Broken hero',
        heroImage: { id: 10, url: '/m/x.jpg', filename: 'missing.jpg', updatedAt: 'u1' },
      },
      ...Array.from({ length: 70 }, (_, i) => ({ id: 100 + i, slug: `cold-${i}`, title: `Cold ${i}` })),
    ],
  },
  drafts: { posts: [{ id: 1, slug: 'a', title: 'Alpha DRAFT' }] },
  globals: { 'site-settings': { name: 'Site' } },
})
const p = (slug: string) => ({ kind: 'posts', slug })

function site(rt: ReturnType<typeof installTestRuntime>) {
  const module = { GET: (r: Request, c: any) => rt.runtime.handler().GET(r, c) }
  return { module, kit: ogKit(rt), meta: (id: number) => () => ogMetadata({ config: {} as never, target: 'posts', doc: { id } }) }
}
afterEach(() => setTestRuntime(null))

const cardRoute = (module: any) => (u: URL) => ({
  module,
  params: { kind: u.pathname.split('/')[2] as string, slug: decodeURIComponent(u.pathname.split('/')[3] as string) },
})
const reject = (promise: Promise<unknown>, message: RegExp) => expect(promise).rejects.toThrow(message)

describe('everyRouteHasOwnCard', () => {
  it('passes for pages whose metadata links the card the route serves immutable', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit, meta } = site(rt)
    await kit.everyRouteHasOwnCard({
      routes: [
        { path: '/posts/a', metadata: meta(1) },
        { path: '/posts/b', metadata: meta(2) },
      ],
      cardRoute: cardRoute(module),
    })
  })
  it('rejects a metadata function that returns no image', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit } = site(rt)
    await reject(
      kit.everyRouteHasOwnCard({ routes: [{ path: '/posts/a', metadata: async () => ({}) }], cardRoute: cardRoute(module) }),
      /payload-og-image kit: everyRouteHasOwnCard: \/posts\/a advertises no og:image/,
    )
  })
  it('rejects a card URL carrying ?v=wrong: it answers 1h, not immutable', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit, meta } = site(rt)
    const wrong = async () => {
      const m = await meta(1)()
      const image = (m.openGraph as any).images[0]
      const url = `${String(image.url).split('?')[0]}?v=wrong`
      return { openGraph: { images: [{ ...image, url }] }, twitter: { card: 'summary_large_image', images: [{ url }] } }
    }
    await reject(
      kit.everyRouteHasOwnCard({ routes: [{ path: '/posts/a', metadata: wrong as never }], cardRoute: cardRoute(module) }),
      /answers 1h, not immutable/,
    )
  })
  it('rejects two routes sharing one card unless allowShared, and an image with no alt', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit, meta } = site(rt)
    const routes = [
      { path: '/posts/a', metadata: meta(1) },
      { path: '/posts/a-again', metadata: meta(1) },
    ]
    await reject(kit.everyRouteHasOwnCard({ routes, cardRoute: cardRoute(module) }), /shares its card/)
    await kit.everyRouteHasOwnCard({
      routes: [routes[0] as never, { ...(routes[1] as object), allowShared: true } as never],
      cardRoute: cardRoute(module),
    })
    const noAlt = async () => {
      const m = await meta(1)()
      return { openGraph: { images: [{ ...(m.openGraph as any).images[0], alt: '' }] }, twitter: m.twitter }
    }
    await reject(
      kit.everyRouteHasOwnCard({ routes: [{ path: '/x', metadata: noAlt as never }], cardRoute: cardRoute(module) }),
      /no alt text/,
    )
  })
})

describe('routesMatchPaths', () => {
  const appWith = async (...routes: string[]) => {
    const app = await mkdtemp(path.join(os.tmpdir(), 'og-app-'))
    for (const r of routes) {
      await mkdir(path.join(app, r), { recursive: true })
      await writeFile(
        path.join(app, r, 'route.ts'),
        "import { createOgRoute } from 'payload-og-image/next'\nexport const GET = createOgRoute({ config: {} as never }).GET\n",
      )
    }
    await mkdir(path.join(app, 'api/other'), { recursive: true })
    await writeFile(path.join(app, 'api/other/route.ts'), 'export const GET = () => new Response()\n') // not a card route: ignored
    return app
  }
  it('passes when the route file matches the configured path (groups stripped, [x] -> :x)', async () => {
    const rt = installTestRuntime(options(), docs())
    await ogKit(rt).routesMatchPaths({ appDir: await appWith('(frontend)/og/[kind]/[slug]/card.png') })
  })
  it('rejects a route file for /og/[kind]/[slug]/card.png when options declare /share/:kind/:slug/og.png, naming both', async () => {
    const rt = installTestRuntime(
      options({ targets: { posts: defineTarget<any, any>({ path: '/share/:kind/:slug/og.png', template: 'post', props: () => ({}) }) } }),
      docs(),
    )
    const app = await appWith('(frontend)/og/[kind]/[slug]/card.png')
    await reject(
      ogKit(rt).routesMatchPaths({ appDir: app }),
      /target "posts" declares \/share\/:kind\/:slug\/og\.png, but no route file.*serves \/og\/:kind\/:slug\/card\.png, which no target or static card declares/,
    )
  })
})

describe('the request-level checks pass on a correct site', () => {
  it('draftNeverCached, storeHitSkipsRender, headParity, staleVersionShort, requestVersionNeverStored, downgradeNotStored, sizeBudget, queueSheds', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit } = site(rt)
    await kit.draftNeverCached({ module, params: p('a'), target: 'posts', slug: 'a' })
    await kit.storeHitSkipsRender({ module, params: p('hero') })
    await kit.headParity({ module, params: p('a') })
    await kit.staleVersionShort({ module, params: p('a') })
    await kit.requestVersionNeverStored({ module, params: p('a') })
    await kit.downgradeNotStored({ module, params: p('hero-missing-file') })
    await kit.queueSheds({ module, paramsFor: (i) => p(`cold-${i}`) })
  })
  it('glyphCoverage passes for text the stacks draw and rejects an emoji, naming the stack', async () => {
    const rt = installTestRuntime(options(), docs())
    await ogKit(rt).glyphCoverage({ samples: ['Привет, «мир» — №1', 'Plain text'] })
    await reject(ogKit(rt).glyphCoverage({ samples: ['Hi 🚀'] }), /stack "default" cannot draw "🚀"/)
  })
})

describe('sizeBudget', () => {
  it('passes within budget on the real renderer, and refuses to measure the stub renderer', async () => {
    const real = installTestRuntime(options(), docs(), { renderer: 'real' })
    const a = site(real)
    await a.kit.sizeBudget({ module: a.module, params: [p('a'), p('hero')], maxBytes: 100_000 })
    const stub = installTestRuntime(options(), docs())
    const b = site(stub)
    await reject(b.kit.sizeBudget({ module: b.module, params: [p('a')], maxBytes: 100_000 }), /stub renderer, whose cards are 8x8 pixels/)
  })
  it('does not count an error answer as a card', async () => {
    const rt = installTestRuntime(options(), docs(), { renderer: 'real' })
    const { module, kit } = site(rt)
    await reject(kit.sizeBudget({ module, params: [p('no-such-post')], maxBytes: 100_000 }), /answered 404, not a card/)
  })
})

describe('headParity', () => {
  it('rejects a route module whose HEAD answers an empty 200', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit } = site(rt)
    await reject(
      // biome-ignore lint/correctness/noComponentHookFactories: HEAD is a route-module export name, not a component
      kit.headParity({ module: { ...module, HEAD: async () => new Response(null) }, params: p('a') }),
      /headParity: header "cache-control" differs|headParity: header/,
    )
  })
  it('rejects a HEAD that answers a different status', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit } = site(rt)
    await reject(
      // biome-ignore lint/correctness/noComponentHookFactories: HEAD is a route-module export name, not a component
      kit.headParity({ module: { ...module, HEAD: async () => new Response(null, { status: 404 }) }, params: p('a') }),
      /HEAD answers 404, GET 200/,
    )
  })
})

describe("checks that catch a site breaking the plugin's guarantees", () => {
  const rewrite = (module: { GET: (r: Request, c: any) => Promise<Response> }, headers: (r: Request, h: Headers) => void) => ({
    GET: async (r: Request, c: any) => {
      const res = await module.GET(r, c)
      const h = new Headers(res.headers)
      headers(r, h)
      return new Response(res.body, { status: res.status, headers: h })
    },
  })
  it('draftNeverCached rejects a route that makes draft answers cacheable', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit } = site(rt)
    const broken = rewrite(module, (_r, h) => h.set('cache-control', 'public, max-age=60'))
    await reject(
      kit.draftNeverCached({ module: broken, params: p('a'), target: 'posts', slug: 'a' }),
      /draftNeverCached: a draft-mode request/,
    )
  })
  it('staleVersionShort rejects a route that serves every version immutable', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit } = site(rt)
    const broken = rewrite(module, (_r, h) => h.set('cache-control', CACHE.immutable))
    await reject(kit.staleVersionShort({ module: broken, params: p('a') }), /a stale \?v answered/)
  })
  it('sizeBudget rejects a card over the budget', async () => {
    const rt = installTestRuntime(options(), docs(), { renderer: 'real' })
    const { module, kit } = site(rt)
    await reject(kit.sizeBudget({ module, params: [p('a')], maxBytes: 10 }), /over the budget of 10/)
  })
  it('queueSheds rejects a route that hides the shedding (turns every 503 into a 200)', async () => {
    const rt = installTestRuntime(options({ gate: { concurrency: 2, queue: 30 } }), docs())
    const { module, kit } = site(rt)
    const hiding = rewriteStatus(module)
    await reject(kit.queueSheds({ module: hiding, paramsFor: (i) => p(`cold-${i}`) }), /and none was shed/)
  })
})

const rewriteStatus = (module: { GET: (r: Request, c: any) => Promise<Response> }) => ({
  GET: async (r: Request, c: any) => {
    const res = await module.GET(r, c)
    return res.status === 503 ? new Response('ok') : res
  },
})

describe('checks tightened by review', () => {
  it('routesMatchPaths: a templated route file serves literal static-card paths, and a static card is routable', async () => {
    const statics = {
      blog: {
        path: '/og/index/blog/card.png',
        kind: 'index',
        slug: 'blog',
        template: 'post',
        props: () => ({ title: 'Blog', label: '', site: '' }),
      },
    }
    const rt = installTestRuntime(options({ static: statics }), docs())
    const app = await mkdtemp(path.join(os.tmpdir(), 'og-app-'))
    await mkdir(path.join(app, '(f)/og/[kind]/[slug]/card.png'), { recursive: true })
    await writeFile(
      path.join(app, '(f)/og/[kind]/[slug]/card.png/route.ts'),
      "import { createOgRoute } from 'payload-og-image/next'\nexport const GET = createOgRoute({ config: {} as never }).GET\n",
    )
    await ogKit(rt).routesMatchPaths({ appDir: app })
    const { module, kit } = site(rt)
    const meta = async () => ogMetadata({ config: {} as never, static: 'blog' })
    await kit.everyRouteHasOwnCard({
      routes: [{ path: '/blog', metadata: meta as never }],
      cardRoute: () => ({ module, params: { kind: 'index', slug: 'blog' } }),
    })
  })
  it('the kit fetches a static card at a literal path of its own: kind and slug come from the card, not the URL', async () => {
    const statics = {
      blog: {
        path: '/static-cards/blog.png',
        kind: 'index',
        slug: 'blog',
        template: 'post',
        props: () => ({ title: 'Blog', label: '', site: '' }),
      },
    }
    const rt = installTestRuntime(options({ static: statics }), docs())
    const { kit } = site(rt)
    await kit.versionCoversEverythingDrawn({
      metadata: () => ogMetadata({ config: {} as never, static: 'blog' }),
      mutate: [() => undefined],
    })
  })
  it('everyRouteHasOwnCard: a versioned URL at a path no card route owns is not waved through as an editor image', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit } = site(rt)
    const wrongPath = async () => ({
      openGraph: {
        images: [{ url: 'https://example.test/typo/a/card.png?v=0123456789ab', width: 1200, height: 630, type: 'image/png', alt: 'x' }],
      },
      twitter: { card: 'summary_large_image', images: [{ url: 'https://example.test/typo/a/card.png?v=0123456789ab' }] },
    })
    await reject(
      kit.everyRouteHasOwnCard({ routes: [{ path: '/posts/a', metadata: wrongPath as never }], cardRoute: cardRoute(module) }),
      /looks like a generated card but matches no configured card path/,
    )
  })
  it('the test runtime serves the CACHED site(): a global missing from siteGlobals stays stale, as in the app', async () => {
    const rt = installTestRuntime(options({ siteGlobals: [] }), docs(), { renderer: 'real' })
    const { meta } = site(rt)
    // The site name reaches the card through props; with no `siteGlobals` the cached site() is never dropped.
    const before = String(((await meta(1)()).openGraph as any).images[0].url)
    rt.setGlobal('site-settings', { name: 'Renamed again' })
    expect(String(((await meta(1)()).openGraph as any).images[0].url)).toBe(before)
  })
  it('requestVersionNeverStored starts every probe cold (a later probe cannot hide behind a warm memo)', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit } = site(rt)
    await kit.requestVersionNeverStored({ module, params: p('a') })
    expect(rt.stored().length).toBeLessThanOrEqual(1) // the last probe's own cold render, under the current version
  })
})

describe('queueSheds exact admission', () => {
  it('rejects a queue that admits a different number than declared (one extra request shed)', async () => {
    const rt = installTestRuntime(options({ gate: { concurrency: 2, queue: 30 } }), docs())
    const { module, kit } = site(rt)
    let turned = false
    const stingy = {
      GET: async (r: Request, c: any) => {
        const res = await module.GET(r, c)
        if (res.status === 200 && !turned) {
          turned = true
          return new Response(null, { status: 503, headers: { 'retry-after': '5', 'cache-control': 'no-store' } })
        }
        return res
      },
    }
    await reject(
      kit.queueSheds({ module: stingy, paramsFor: (i) => p(`cold-${i}`) }),
      /expected exactly 3 .*the queue admits the wrong number/,
    )
  })
})

describe('checks tightened after the second review', () => {
  const passThrough = (
    module: { GET: (r: Request, c: any) => Promise<Response> },
    f: (res: Response, r: Request) => Response | Promise<Response>,
  ) => ({
    GET: async (r: Request, c: any) => f(await module.GET(r, c), r),
  })
  it('everyRouteHasOwnCard: a metadata call site that drops the version (the URL without ?v=) is rejected', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit, meta } = site(rt)
    const dropsV = async () => {
      const m = await meta(1)()
      const image = (m.openGraph as any).images[0]
      const url = String(image.url).split('?')[0]
      return { openGraph: { images: [{ ...image, url }] }, twitter: { card: 'summary_large_image', images: [{ url }] } }
    }
    await reject(
      kit.everyRouteHasOwnCard({ routes: [{ path: '/posts/a', metadata: dropsV as never }], cardRoute: cardRoute(module) }),
      /answers 1h, not immutable/,
    )
  })
  it('everyRouteHasOwnCard: an unrecognised URL fails, an upload path is accepted, and a card must decode at the advertised size', async () => {
    const rt = installTestRuntime(options(), docs(), { renderer: 'real' })
    const { module, kit, meta } = site(rt)
    const img = (url: string) => async () => ({
      openGraph: { images: [{ url, width: 1200, height: 630, type: 'image/jpeg', alt: 'x' }] },
      twitter: { card: 'summary_large_image', images: [{ url }] },
    })
    await reject(
      kit.everyRouteHasOwnCard({
        routes: [{ path: '/p', metadata: img('https://example.test/somewhere/else.jpg') as never }],
        cardRoute: cardRoute(module),
      }),
      /neither a configured card route nor an upload path/,
    )
    await kit.everyRouteHasOwnCard({
      routes: [{ path: '/p', metadata: img('https://example.test/media/own.jpg') as never }],
      cardRoute: cardRoute(module),
    })
    await kit.everyRouteHasOwnCard({ routes: [{ path: '/p', metadata: meta(1) }], cardRoute: cardRoute(module) }) // a real card: 1200x630, decodable
    const garbage = passThrough(module, (res) => new Response('not a png', { status: 200, headers: res.headers }))
    await reject(
      kit.everyRouteHasOwnCard({ routes: [{ path: '/p', metadata: meta(1) }], cardRoute: cardRoute(garbage) }),
      /does not serve a decodable image/,
    )
    const jpeg = passThrough(
      module,
      async (res) =>
        new Response(
          new Uint8Array(
            await (await import('sharp'))
              .default({ create: { width: 1200, height: 630, channels: 3, background: '#000' } })
              .jpeg()
              .toBuffer(),
          ),
          { status: 200, headers: res.headers },
        ),
    )
    await reject(
      kit.everyRouteHasOwnCard({ routes: [{ path: '/p', metadata: meta(1) }], cardRoute: cardRoute(jpeg) }),
      /serves a jpeg, not a PNG/,
    )
    const smaller = passThrough(
      module,
      async (res) =>
        new Response(
          new Uint8Array(
            await (await import('sharp'))
              .default({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
              .png()
              .toBuffer(),
          ),
          { status: 200, headers: res.headers },
        ),
    )
    await reject(
      kit.everyRouteHasOwnCard({ routes: [{ path: '/p', metadata: meta(1) }], cardRoute: cardRoute(smaller) }),
      /is 10x10 but og:image says 1200x630/,
    )
  })
  it("draftNeverCached: needs a draft fixture, and rejects a route that gives an anonymous draft-mode visitor the editor's draft", async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit } = site(rt)
    await reject(kit.draftNeverCached({ module, params: p('b'), target: 'posts', slug: 'b' }), /no draft fixture for posts\/b/)
    // a site that forwards the editor credential to every draft-mode request
    const leaky = { GET: (r: Request, c: any) => module.GET(new Request(r, { headers: { authorization: 'JWT kit-editor' } }), c) }
    await reject(
      kit.draftNeverCached({ module: leaky, params: p('a'), target: 'posts', slug: 'a' }),
      /without an editor did not get the published card/,
    )
  })
  it('routesMatchPaths: parameter names must match, a comment is not a route, and the file must export GET', async () => {
    const rt = installTestRuntime(options(), docs())
    const mk = async (rel: string, source: string) => {
      const app = await mkdtemp(path.join(os.tmpdir(), 'og-app-'))
      await mkdir(path.join(app, rel), { recursive: true })
      await writeFile(path.join(app, rel, 'route.ts'), source)
      return app
    }
    const good = "import { createOgRoute } from 'payload-og-image/next'\nexport const GET = createOgRoute({ config: {} as never }).GET\n"
    await reject(
      ogKit(rt).routesMatchPaths({ appDir: await mk('og/[kind]/[id]/card.png', good) }),
      /declares \/og\/:kind\/:slug\/card\.png, but no route file/,
    )
    await reject(
      ogKit(rt).routesMatchPaths({
        appDir: await mk('og/[kind]/[slug]/card.png', '// createOgRoute({ config })\nexport const GET = () => new Response()\n'),
      }),
      /no route file exporting GET through createOgRoute/,
    )
    await reject(
      ogKit(rt).routesMatchPaths({
        appDir: await mk(
          'og/[kind]/[slug]/card.png',
          "import { createOgRoute } from 'payload-og-image/next'\nconst route = createOgRoute({ config: {} as never })\nexport const POST = route.GET\n",
        ),
      }),
      /no route file exporting GET/,
    )
    await ogKit(rt).routesMatchPaths({ appDir: await mk('og/[kind]/[slug]/card.png', good) })
  })
  it('requestVersionNeverStored fails when no probe wrote anything (nothing would have been checked)', async () => {
    const rt = installTestRuntime(options(), docs())
    const { kit } = site(rt)
    // biome-ignore lint/correctness/noComponentHookFactories: GET is a route-module export name, not a component
    const never = { GET: async () => new Response('x', { status: 200, headers: { etag: '"aaaaaaaaaaaa"' } }) }
    await reject(kit.requestVersionNeverStored({ module: never, params: p('a') }), /no probe caused a store write/)
  })
  it('downgradeNotStored rejects a downgraded card that carries an etag', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit } = site(rt)
    const etagged = passThrough(module, (res) => {
      const h = new Headers(res.headers)
      h.set('etag', '"aaaaaaaaaaaa"')
      return new Response(res.body, { status: res.status, headers: h })
    })
    await reject(kit.downgradeNotStored({ module: etagged, params: p('hero-missing-file') }), /carries an etag/)
  })
  it('headParity rejects a HEAD whose content-length differs from GET', async () => {
    const rt = installTestRuntime(options(), docs())
    const { module, kit } = site(rt)
    const HEAD = async (r: Request, c: any) => {
      const res = await module.GET(r, c)
      const h = new Headers(res.headers)
      h.set('content-length', '1')
      return new Response(null, { status: res.status, headers: h })
    }
    await reject(kit.headParity({ module: { ...module, HEAD }, params: p('a') }), /header "content-length" differs/)
  })
  it('sizeBudget refuses a fallback body', async () => {
    const rt = installTestRuntime(options(), docs(), { renderer: 'real' })
    const { module, kit } = site(rt)
    const fb = passThrough(module, (res) => {
      const h = new Headers(res.headers)
      h.set('x-og-cache', 'fallback')
      return new Response(res.body, { status: res.status, headers: h })
    })
    await reject(kit.sizeBudget({ module: fb, params: [p('a')], maxBytes: 100_000 }), /answered as "fallback", not as a card/)
  })
})

describe('versionCoversEverythingDrawn', () => {
  it('passes when everything the template draws is in the version (title, a site global, a hero tag)', async () => {
    const rt = installTestRuntime(options(), docs(), { renderer: 'real' })
    const { kit, meta } = site(rt)
    await kit.versionCoversEverythingDrawn({
      metadata: meta(3),
      mutate: [
        () => rt.setDoc('posts', { ...docs().published.posts[2], title: 'New' }),
        () => rt.setGlobal('site-settings', { name: 'Renamed' }),
        () =>
          rt.setDoc('posts', {
            ...docs().published.posts[2],
            title: 'New',
            heroImage: { id: 9, url: '/m/h.jpg', filename: 'h.jpg', updatedAt: 'later' },
          }),
      ],
    })
  })
  it('rejects a template that draws module-level state its props do not carry: bytes changed, URL did not', async () => {
    theme = 'a'
    const rt = installTestRuntime(options(), docs(), { renderer: 'real' })
    const { kit, meta } = site(rt)
    try {
      await reject(
        kit.versionCoversEverythingDrawn({
          metadata: meta(1),
          mutate: [
            () => {
              theme = 'b'
            },
          ],
        }),
        /mutation #1 changed the rendered bytes but not the URL/,
      )
    } finally {
      theme = 'a'
    }
  })
})
