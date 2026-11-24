/** The kit exercised against the dev app's REAL page, metadata and card-route modules (the plugin runtime is the test runtime).
 * - handler.ts:262  delete the `if (previewing)` branch -> "draft never cached" RED
 * - handler.ts:281  store key = the request `v` (`requested ?? card.v`) -> "request v never stored" RED
 * - handler.ts:279  decide the downgrade inside the memo closure (store it) -> "downgrade not stored" RED
 * - handler.ts:273  call heroLoader before store.get -> "store hit skips render" RED
 * - version.ts:83  drop props from the hashed array -> "version covers everything drawn" RED (the plan row "drop fontsDigest" cannot be RED here: the stub renderer draws no fonts; the unit test for fontsDigest is in version.spec)
 * - runtime.ts+metadata.ts:149  resolve from the doc the page passed (depth 0, hero a bare id) instead of re-reading -> "every indexable route has its own card" RED
 * - gate.ts:33  never throw ShedError -> "queue sheds" RED
 * - handler.ts:269  immutable for every version -> "stale v is short" RED */

import { installTestRuntime, ogKit } from 'payload-og-image/testing'
import { describe, it, vi } from 'vitest'
import * as cardRoute from '../app/(frontend)/og/[kind]/[slug]/card.png/route.js'
import { generateMetadata as postMeta } from '../app/(frontend)/posts/[slug]/page.js'
import { ogOptions } from '../src/og/options.js'
import { docs } from './fixtures.js'

// The page reads its own document through Payload; the plugin never does in this test.
vi.mock('payload', async (orig) => ({
  ...(await orig<typeof import('payload')>()),
  getPayload: async () => ({
    // Like Payload at depth 0: an upload relation comes back as its bare id.
    find: async ({ where, depth }: { where: { slug: { equals: string } }; depth?: number }) => ({
      docs: (docs.published.posts ?? [])
        .filter((d) => d.slug === where.slug.equals)
        .map((d) => (depth === 0 && d.heroImage ? { ...d, heroImage: d.heroImage.id } : d)),
    }),
  }),
}))

// The real renderer: a size budget measured on stub cards would say nothing.
const rt = installTestRuntime(ogOptions, docs, { renderer: 'real' })
const kit = ogKit(rt)
const p = (slug: string) => ({ kind: 'posts', slug })
const routeFor = (u: URL) => ({
  module: cardRoute,
  params: { kind: u.pathname.split('/')[2] as string, slug: decodeURIComponent(u.pathname.split('/')[3] as string) },
})
const metaOf = (slug: string) => () => postMeta({ params: Promise.resolve({ slug }) })

describe('dev app share cards', () => {
  it('every indexable route has its own card', () =>
    kit.everyRouteHasOwnCard({
      routes: ['a', 'hero', 'a%b'].map((slug) => ({ path: `/posts/${slug}`, metadata: metaOf(slug) })),
      cardRoute: (u) => ({
        module: cardRoute,
        params: { kind: u.pathname.split('/')[2] as string, slug: decodeURIComponent(u.pathname.split('/')[3] as string) },
      }),
    }))
  it('configured paths match route files', () => kit.routesMatchPaths({ appDir: new URL('../app', import.meta.url).pathname }))
  it('draft never cached', () => kit.draftNeverCached({ module: cardRoute, params: p('a'), target: 'posts', slug: 'a' }))
  it('store hit skips render', () => kit.storeHitSkipsRender({ module: cardRoute, params: p('hero') }))
  it('queue sheds', () => kit.queueSheds({ module: cardRoute, paramsFor: (i) => p(`cold-${i}`) }))
  it('HEAD parity', () => kit.headParity({ module: cardRoute, params: p('a') }))
  it('stale v is short', () => kit.staleVersionShort({ module: cardRoute, params: p('a') }))
  it('request v never stored', () => kit.requestVersionNeverStored({ module: cardRoute, params: p('a') }))
  it('version covers everything drawn', () =>
    kit.versionCoversEverythingDrawn({
      metadata: metaOf('hero'),
      // The card is fetched through the site's own route module, and the test hero's pixels depend on its id and updatedAt.
      cardRoute: routeFor,
      mutate: [
        () => rt.setDoc('posts', { ...(docs.published.posts?.[1] as object), title: 'New' }),
        () => rt.setGlobal('site-settings', { businessName: 'Renamed' }),
        () =>
          rt.setDoc('posts', {
            ...(docs.published.posts?.[1] as object),
            title: 'New',
            heroImage: { id: 9, url: '/media/h.jpg', filename: 'h.jpg', updatedAt: 'later' },
          }),
      ],
    }))
  it('downgrade not stored', () => kit.downgradeNotStored({ module: cardRoute, params: p('hero-missing-file') }))
  it('glyph coverage', () => kit.glyphCoverage({ samples: ['Привет, «мир» — №1', 'It’s “fine” – really…'] }))
  it('size budget', () => kit.sizeBudget({ module: cardRoute, params: [p('a'), p('hero')], maxBytes: 300_000 }))
})
