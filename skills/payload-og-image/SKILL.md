---

name: payload-og-image
description: Install and configure the payload-og-image plugin on a Payload CMS + Next.js site so every page gets a generated, content-versioned Open Graph share card. Use when the user says "add share images to Payload", "og image", "open graph card", "social share card", "link preview image", "payload-og-image", or asks why a LinkedIn, Facebook, X or Telegram preview shows no image, the wrong image or a stale one on a Payload site.
---

# payload-og-image

A Payload 3/4 plugin plus a Next 16 route that draws Open Graph cards (1200x630 by default) from your documents. The card URL carries a version derived from everything the card shows, so a changed title gives a new URL and an unchanged card is cached for a year. Source of truth: the package's `docs/` folder (`reference.md`, `templates.md`, `crawlers.md`, `operations.md`) and the working app in `dev/` of the repository. When this file and the docs disagree, the docs and the code win.

## Mental model

- **Template** (`defineTemplate`): a pure function from props to a JSX card. It fetches nothing and reads no site data except through its props, because the props are what the URL version hashes. `id` and `revision` are part of every version: bump `revision` with the design.
- **Target** (`defineTarget`): maps one collection to one template. It holds the card `path` (must contain `:slug` or `:id`, may contain `:kind`), `props({ doc, site, related, overrides })`, optional `hero` (an upload) plus `heroCollection`, `format`, `alt`, `share`.
- **`site()`**: plugin option returning data shared by every card (the brand name). It is cached 60 s per process.
- **Fonts and stacks**: `fonts` are TTF, OTF or WOFF files (never WOFF2) you ship; `stacks` order the families per text field; `stacks.default` is required. No request leaves the host while a card is drawn.
- **Store**: finished cards live on disk (`store: { dir }`) or in memory (`store: { memory: true }`), behind a bounded render queue.
- **Versioned URL**: `/og/posts/hello/card.png?v=<hash>`. The route answers the current `v` with `immutable`, one year; any other `v` gets the current bytes with a one-hour header. A change of content is a new URL, never a purge.
- **Three things a site must wire**, all three or no card appears:
  1. the plugin in `buildConfig({ plugins })`;
  2. the card route file at the path the targets declare;
  3. `ogMetadata` in each page's `generateMetadata`.

## Decision checklist (walk it before writing config)

1. **Which collections** get a card? One target per collection; the page must have a public URL and a slug (or be keyed by id). List them back to the user.
2. **Which fields reach the card?** Only what the public may read. The plugin reads with `overrideAccess: false`, at depth 0, published documents only; drafts reach editors in draft mode and are never cached. A collection with drafts needs a public read rule for published documents (see `references/pitfalls.md`). Anything else a card draws comes through `related(collection, id)`. Never read private fields in `props` or `site()`.
3. **Photo card or text card?** A photo-first card (full-bleed image, scrim, title): `format: 'jpeg'` and a `.jpg` path. A flat text card: PNG (default; a palette PNG is smallest for flat art). WebP is opt-in and not read by every crawler. A path whose extension contradicts the format is refused at start-up.
4. **Fonts**: self-host the files in the repo or an assets folder, read them with a path built from `process.cwd()`, and cover every script the site writes (a Russian site needs a face with Cyrillic, and `requiredSample` extended with `«»„№₽`). Every character a stack cannot draw is stripped and reported as `glyph_missing`.
5. **Store dir on a persistent volume**: an absolute path only the app writes, mounted as a volume in Docker. A missing mount gives no warning and cards vanish on recreate.
6. **`serverExternalPackages: ['fontkit']`** in `next.config`. Required.
7. **`serverURL`**: the Payload config (or the plugin's `serverURL` option) needs an absolute origin; card URLs are absolute https.
8. **Payload 3 versus 4**: on Payload 4 the Local API default is `overrideAccess: false`, so state it inside `site()` and `props`/`related` reads: `overrideAccess: true` for trusted site globals. Run `payload generate:importmap` after install. Details in `references/pitfalls.md`.
9. **Per-document overrides wanted?** If editors should set the card headline or switch the card off per page, enable `fields` (section below) and plan the migration.
10. **Crawler pre-flight**: `robots.txt` must not `Disallow` the card path; pages that Next caches must be revalidated on save or be `force-dynamic`.

## Minimal wiring

Plugin (`payload.config.ts`):

```ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { defineTarget, ogImagePlugin } from 'payload-og-image'
import { postCard } from './og/postCard'

const font = (f: string) => () => readFile(path.join(process.cwd(), 'assets/fonts', f))

export default buildConfig({
  serverURL: 'https://example.com',
  plugins: [
    ogImagePlugin({
      site: async ({ payload }) => ({
        name: ((await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })).siteName as string) || 'Example',
      }),
      siteGlobals: ['site-settings'], // saving it drops the cached site()
      fonts: [{ family: 'Inter', weight: 800, data: font('inter-latin-cyrillic-800.woff') }],
      stacks: { title: ['Inter'], default: ['Inter'] },
      templates: [postCard],
      targets: {
        // pass your generated document type for D (here `any`) so `doc` is typed
        posts: defineTarget<any, { label: string; title: string; site: string }>({
          path: '/og/:kind/:slug/card.png',
          template: 'post',
          props: ({ doc, site, overrides }) => ({ label: 'Blog', title: overrides?.headline ?? doc.title, site: site.name }),
          hero: ({ doc }) => doc.heroImage,
          heroCollection: 'media',
        }),
      },
      store: process.env.OG_STORE_DIR ? { dir: process.env.OG_STORE_DIR } : { memory: true },
    }),
  ],
})
```

Card route, `app/(frontend)/og/[kind]/[slug]/card.png/route.ts` (the folder name follows the target's `path`):

```ts
import config from '@payload-config'
import { createOgRoute } from 'payload-og-image/next'

export const dynamic = 'force-dynamic'
const route = createOgRoute({ config })
export const GET = route.GET
export const HEAD = GET // crawlers HEAD first
```

Page metadata:

```ts
import { ogMetadata } from 'payload-og-image/next'

export async function generateMetadata({ params }: Props) {
  const doc = await bySlug((await params).slug)
  return { title: doc?.title, ...(await ogMetadata({ config, target: 'posts', doc })) }
}
```

`ogMetadata` takes `{ config, target, doc }` or `{ config, static: '<key>' }` (a key of the plugin's `static` map) for a page that is not a document (home, an index). Register a `static` card on the plugin for those. The document passed is only a key: the plugin reads it again by id.

## Per-document `og` fields

`fields: { enabled: true }` on the plugin adds a top-level group `og` to each target collection: `mode` (`inherit` default, `generated`, `custom`, `off`), `headline`, `subtitle`, plus a hidden `nonce` and a live "Card preview" in the admin. Headline and subtitle reach a card only through `overrides` in `props`. To place the group yourself, call `ogFields()` and leave `fields` off; it must be named `og` and sit at the top level (directly, or in a row, collapsible or unnamed tab). **The new fields are columns: the site runs `payload migrate:create` and ships the migration.** Then run `payload generate:importmap` for the preview component. Full rules: `references/fields-and-mcp.md`.

## Verify (an agent proves the setup, never assumes)

1. **Kit**: write a vitest spec with `installTestRuntime` and `ogKit` against the real route and page modules; it must pass (`references/testing.md`).
2. **Card URL**: start the app, read the page's `og:image`, and `curl -sI` it. Expect `200`, `content-type: image/png` or `image/jpeg` (matching the target), `cache-control: public, max-age=31536000, immutable, no-transform` for the advertised `v`, and an `etag` of `"<v>"` (the same version). `curl -s -o /dev/null -w '%{http_code}'` a HEAD (`-I`) and a GET and compare.
3. **Head**: `curl -s <page> | grep -o '<meta[^>]*og:image[^>]*>'` shows exactly one `og:image` (plus its `:width`, `:height`, `:type`, `:alt`, `:secure_url`), inside `<head>`, with an absolute https URL. Repeat with a crawler user agent (`-A 'facebookexternalhit/1.1'`, `-A 'TelegramBot'`).
4. **Stale and unknown**: an old `?v=` returns the current bytes with a one-hour header; an unknown slug returns 404 `no-store`.

If the site can run `node scripts/probe-dev-server.mjs` (in the plugin repository only), it does the same against the dev app.

## Pitfalls (short list; `references/pitfalls.md` has the cause and fix)

- No route file, or a route folder that does not match `path`: pages advertise a URL that 404s. `kit.routesMatchPaths` catches it.
- Payload REST answers 404 to HEAD: add `export const HEAD = withHead(GET)` in `app/(payload)/api/[...slug]/route.ts`. Not on the card route.
- Next 16 streams `generateMetadata` output into `<body>` for crawlers that are not on its HTML-limited list; check `htmlLimitedBots`.
- `og:image` must remain a single image. Do not add a second image in a layout or page; a page's `openGraph` replaces the layout's whole `openGraph` (shallow merge).
- Cached pages keep an old `?v`: `force-dynamic` or revalidate with `ogTag` on save.
- JPEG for photo cards; WebP is not safe on every platform.
- Specs that boot Payload under jsdom fail at the start-up self-test: use a Node environment for them.
- Size variants (square, 4:3) are coming in 0.7.0; not in 0.6.0.

## References (load on demand)

- `references/targets.md`: target options, hero, format, static cards, `share`, `related`, store and gate options.
- `references/templates.md`: writing a template, props, `ctx.fit`, fonts and stacks, the CSS subset.
- `references/fields-and-mcp.md`: the `og` group, `mode` table, migration, admin preview, MCP tools.
- `references/testing.md`: the kit, every check, the specs that boot Payload.
- `references/pitfalls.md`: failures with cause and fix, Payload 3 vs 4, Next 16 specifics, crawler notes.
