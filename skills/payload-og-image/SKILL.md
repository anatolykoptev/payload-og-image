---
name: payload-og-image
description: Install and configure the payload-og-image plugin on a Payload CMS + Next.js site so every page gets a generated, content-versioned Open Graph share card. Use when the user says "add share images to Payload", "og image", "og:image meta", "open graph card", "Open Graph", "twitter:card", "social share card", "link preview image", "Discord or Slack unfurl", "payload-og-image", or asks why a LinkedIn, Facebook, X, Discord, Slack or Telegram preview shows no image, the wrong image or a stale one on a Payload site.
---

# payload-og-image

A Payload 3/4 plugin plus a Next 16 route that draws Open Graph cards (1200x630 by default) from your documents. The card URL carries a version derived from everything the card shows, so a changed title gives a new URL and an unchanged card is cached for a year. Source of truth: the package's `docs/` folder (`reference.md`, `templates.md`, `crawlers.md`, `operations.md`) and the working app in `dev/` of the repository (https://github.com/anatolykoptev/payload-og-image/tree/main/dev; `dev/` and `scripts/` are not in the npm package). When this file and the docs disagree, the docs and the code win.

## Install and compatibility

```sh
pnpm add payload-og-image
```

Floor (README): Payload `^3.93.0` or `^4.0.0-beta.12`, Next.js `^16.4.5`, React `^19.3.1`, sharp `^0.35.4`, Node `^22.23.5 || ^24.22.3 || >=26.13.1`. ESM only; Node runtime only (no edge). Pre-1.0: the API can change in a minor release, so read the installed version's `docs/`.

## Steps

1. Install, then walk the decision checklist below with the user.
2. Add `serverExternalPackages: ['fontkit']` to `next.config`.
3. Write the templates (`references/templates.md`) and register the plugin with fonts, stacks, templates, targets and the store.
4. Add the card route file for every target path (and variant path).
5. Call `ogMetadata` in each page's `generateMetadata`.
6. If `fields` is on: `payload migrate:create`, commit the migration; run `payload generate:importmap`.
7. Verify (section below) and fix until every check passes.

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
3. **Photo card or text card?** A photo-first card (full-bleed image, scrim, title): `format: 'jpeg'`, a `.jpg` path, and `palette: { hero: false }` while issue #71 is open (otherwise a JPEG card still cuts its hero to a 256-colour palette). A flat text card: PNG (default; a palette PNG is smallest for flat art). WebP is opt-in and not read by every crawler. A path whose extension contradicts the format is refused at start-up.
4. **Fonts**: self-host an OFL-licensed face that covers the site's scripts, as files in the repo or an assets folder, read them with a path built from `process.cwd()`, and cover every script the site writes (a Russian site needs a face with Cyrillic, and `requiredSample` extended with `«»„№₽`). Every character a stack cannot draw is stripped and reported as `glyph_missing`.
5. **Store dir on a persistent volume**: an absolute path only the app writes, mounted as a volume in Docker. A missing mount gives no warning and cards vanish on recreate.
6. **`serverExternalPackages: ['fontkit']`** in `next.config`. Required.
7. **`serverURL`**: the Payload config (or the plugin's `serverURL` option) needs an absolute origin; card URLs are absolute (`http` or `https`; crawlers need https, and the kit requires it unless `allowHttpImages: true`).
8. **Payload 3 versus 4**: on Payload 4 the Local API default is `overrideAccess: false`, so state it inside `site()` and `props`/`related` reads: `overrideAccess: true` for trusted site globals. Run `payload generate:importmap` after install. Details in `references/pitfalls.md`.
9. **Per-document overrides wanted?** If editors should set the card headline or switch the card off per page, enable `fields` (section below) and plan the migration.
10. **Crawler pre-flight**: `robots.txt` must not `Disallow` the card path; pages that Next caches must be revalidated on save or be `force-dynamic`.

## Minimal wiring

Plugin (`payload.config.ts`):

```ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { defineTarget, ogImagePlugin } from 'payload-og-image'
import { postCard } from './og/postCard' // see references/templates.md for a complete template

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
3. **Head**: `curl -s <page> | grep -o '<meta[^>]*property="og:image"[^>]*>' | wc -l` prints `1` (`grep -c` counts lines, and a page is often one line). The `:width`, `:height`, `:type`, `:alt` and `:secure_url` properties are separate tags and do not match. The tag must sit inside `<head>` with an absolute URL.
4. **Crawler head**: `curl -s -A 'TelegramBot' <page>` and check that `og:image` is inside `<head>`, not after `<body>`. If it is not, set `htmlLimitedBots` in `next.config` (`/.*/`, or a regex that adds `TelegramBot`; a custom value replaces Next's default list). See `references/pitfalls.md`.
5. **Stale and unknown**: an old `?v=` returns the current bytes with a one-hour header; an unknown slug returns 404 `no-store`.

In the plugin repository, [`scripts/probe-dev-server.mjs`](https://github.com/anatolykoptev/payload-og-image/blob/main/scripts/probe-dev-server.mjs) runs these probes against the dev app.

## Pitfalls (short list; `references/pitfalls.md` has the cause and fix)

- No route file, or a route folder that does not match `path`: pages advertise a URL that 404s. `kit.routesMatchPaths` catches it.
- Payload REST answers 404 to HEAD: add `export const HEAD = withHead(GET)` in `app/(payload)/api/[...slug]/route.ts`. Not on the card route.
- Next 16 streams `generateMetadata` output into `<body>` for crawlers not on its HTML-limited list (Telegram is not); streaming applies to pages rendered at request time. Check with `curl -A 'TelegramBot'`; if `og:image` is not in `<head>`, set `htmlLimitedBots` (see `references/pitfalls.md`).
- `og:image` must remain a single image. Do not add a second image in a layout or page; a page's `openGraph` replaces the layout's whole `openGraph` (shallow merge).
- Cached pages keep an old `?v`: `force-dynamic` or revalidate with `ogTag` on save.
- JPEG for photo cards; WebP is not safe on every platform.
- Specs that boot Payload under jsdom fail at the start-up self-test: use a Node environment for them.
- Google structured data wants square and 4:3 images too: use target `variants` and `ogImages()` for JSON-LD (`references/targets.md`, 0.7.0 and later), never extra `og:image` tags.

## References (load on demand)

- `references/targets.md`: target options, hero, format, static cards, size variants and `ogImages`, store and gate options.
- `references/templates.md`: writing a template, props, `ctx.fit`, fonts and stacks, the CSS subset.
- `references/fields-and-mcp.md`: the `og` group, `mode` table, migration, admin preview, MCP tools.
- `references/testing.md`: the kit, every check, the specs that boot Payload.
- `references/pitfalls.md`: failures with cause and fix, Payload 3 vs 4, Next 16 specifics, crawler notes.
