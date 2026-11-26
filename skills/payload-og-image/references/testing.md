# Verifying a setup: the test kit

Source: `docs/reference.md` ("Testing your site", "Specs that boot Payload"), `src/testing/kit.ts`, `src/testing/runtime.ts`, and the working spec [`dev/tests/og.spec.ts`](https://github.com/anatolykoptev/payload-og-image/blob/main/dev/tests/og.spec.ts) in the repository (`dev/` is not in the npm package; the example below is self-contained).

```ts
import { installTestRuntime, ogKit } from 'payload-og-image/testing'
import { describe, it } from 'vitest'
import * as cardRoute from '../app/(frontend)/og/[kind]/[slug]/card.png/route.js'
import { generateMetadata as postMeta } from '../app/(frontend)/posts/[slug]/page.js'
import { ogOptions } from '../src/og/options.js' // the same options object payload.config.ts passes to ogImagePlugin
import { docs } from './fixtures.js' // KitDocs: { published: { posts: [...] }, drafts?, globals? }

const rt = installTestRuntime(ogOptions, docs, { renderer: 'real' }) // 'stub' is fast but its sizes mean nothing
const kit = ogKit(rt)

describe('og kit', { timeout: 60_000 }, () => {
  // kit calls render many cards; vitest's 5 s default is too short
  it('every indexable route has its own card', () =>
    kit.everyRouteHasOwnCard({
      routes: [{ path: '/posts/a', metadata: () => postMeta({ params: Promise.resolve({ slug: 'a' }) }) }],
      cardRoute: (u) => ({ module: cardRoute, params: { kind: u.pathname.split('/')[2], slug: u.pathname.split('/')[3] } }),
    }))
  it('route files match paths', () => kit.routesMatchPaths({ appDir: new URL('../app', import.meta.url).pathname }))
  it('draft never cached', () =>
    kit.draftNeverCached({ module: cardRoute, params: { kind: 'posts', slug: 'a' }, target: 'posts', slug: 'a', draftOnly: 'unpublished' }))
  it('HEAD parity', () => kit.headParity({ module: cardRoute, params: { kind: 'posts', slug: 'a' } }))
  it('size budget', () => kit.sizeBudget({ module: cardRoute, params: [{ kind: 'posts', slug: 'a' }], maxBytes: 300_000 }))
})
```

Put the plugin options in one file (`src/og/options.ts`, exporting `ogOptions: OgImagePluginOptions`) that both `payload.config.ts` (`ogImagePlugin(ogOptions)`) and the spec import, as the dev app does ([`dev/src/og/options.ts`](https://github.com/anatolykoptev/payload-og-image/blob/main/dev/src/og/options.ts)). The spec must test the options the site runs.

The fixture. `draftNeverCached` needs `draftOnly`: a slug that exists in `drafts` and not in `published`, or it fails with "no draft fixture":

```ts
// test/fixtures.ts
import type { KitDocs } from 'payload-og-image/testing'

export const docs: KitDocs = {
  published: { posts: [{ id: 1, slug: 'a', title: 'Alpha' }] },
  drafts: {
    posts: [
      { id: 1, slug: 'a', title: 'Alpha, a draft' },
      { id: 500, slug: 'unpublished', title: 'Not published yet' },
    ],
  }, // `unpublished` is draft-only
  globals: { 'site-settings': { siteName: 'Example' } }, // every global `site()` reads
}
```

## The checks (all on `ogKit(rt)`)

| Check                                                                                         | Catches                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `everyRouteHasOwnCard({ routes, cardRoute })`                                                 | a page whose metadata has no card, a non-https or wrong image URL, a card route that 404s for the advertised URL. `allowHttpImages: true` for a plain-HTTP dev server only                                                                                                           |
| `routesMatchPaths({ appDir })`                                                                | a configured card `path` (a size variant's path too) with no route file whose `GET` is the `createOgRoute()` one. Parses with the TypeScript compiler API: needs `typescript` 5, 6 or 7 (on 7, `@typescript/typescript6`); declare `GET` as `const`; `export * from` is not followed |
| `draftNeverCached({ module, params, target, slug, draftOnly })`                               | a draft cached, or leaked to the public or a non-editor. `draftOnly` is a slug that exists only as a draft: public and non-editor draft-mode requests must get 404, an editor the draft                                                                                              |
| `storeHitSkipsRender`, `requestVersionNeverStored`, `downgradeNotStored`, `staleVersionShort` | store behaviour, a client-chosen `v` stored, a degraded card stored, a stale `v` served as immutable                                                                                                                                                                                 |
| `headParity({ module, params })`                                                              | HEAD not the twin of GET                                                                                                                                                                                                                                                             |
| `restHeadParity({ module, url, apiRoute? })`                                                  | Payload REST answering 404 to HEAD for an upload (`url` absolute, under `/api`)                                                                                                                                                                                                      |
| `versionCoversEverythingDrawn({ metadata, cardRoute, mutate })`                               | a template that draws something not in props: each `mutate` step (`rt.setDoc`, `rt.setGlobal`) must change the advertised URL                                                                                                                                                        |
| `queueSheds({ module, paramsFor })`                                                           | the render queue not shedding with 503                                                                                                                                                                                                                                               |
| `glyphCoverage({ samples, stacks? })`                                                         | a stack that cannot draw sample text (use real titles in every language of the site)                                                                                                                                                                                                 |
| `templatesRender({ props })`                                                                  | a template that cannot be drawn or is not its size (a `div` with children and no `display: flex`); props per template id                                                                                                                                                             |
| `sizeBudget({ module, params, maxBytes })`                                                    | cards over budget; measure photo cards here                                                                                                                                                                                                                                          |

`installTestRuntime(options, docs, { renderer, heroDir, transparentHero, uploads })`: `heroDir` points at a folder of real hero files named by the docs' `filename`, so real icons draw as in production; `uploads` models the site's upload collections by slug and id (`docs/reference.md`, Testing your site). Test runtime helpers: `rt.setDoc(target, doc)`, `rt.setGlobal(slug, data)`, `rt.draftMode(on, editor?)`.

## Specs that boot Payload

- **Boot under jsdom, draw under Node.** The start-up check draws nothing, so a spec that only boots Payload may run under `jsdom`. `next/og` and `sharp` refuse a `Uint8Array` from another realm, so a spec that draws a card (a template, `templatesRender`, `sizeBudget`, the kit's real renderer) belongs in a Node environment: `// @vitest-environment node` at the file top, or a vitest project with `environment: 'node'`. jsdom's `URL` also breaks `new URL('...', import.meta.url)` font loaders.
- **Inline the plugin when mocking `next/headers.js`**: `test: { server: { deps: { inline: ['payload-og-image'] } } }`.
- **Fonts**: `path.join(process.cwd(), ...)`, never `new URL(..., import.meta.url)`.

## Live probes beyond the kit

The kit proves the code path; a running server proves delivery. Use the "Verify" section of `SKILL.md` (curl card, curl `<head>`). In the plugin repository only ([`scripts/probe-dev-server.mjs`](https://github.com/anatolykoptev/payload-og-image/blob/main/scripts/probe-dev-server.mjs); `scripts/` is not in the npm package): `node scripts/probe-dev-server.mjs` builds the dev app, runs `next start`, and checks GET and HEAD headers, a stale `?v`, an unknown slug, HEAD on a REST upload and a cached page's `og:image` after an edit. `og-parity --old <dir> --new <dir>` compares two directories of rendered cards pixel for pixel when a migration must not change a card.
