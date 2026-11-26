---
name: payload-og-image
description: Install and configure the payload-og-image plugin on a Payload CMS + Next.js site so every page gets a generated, content-versioned Open Graph share card. Use when the user says "add share images to Payload", "og image", "og:image meta", "open graph card", "Open Graph", "twitter:card", "social share card", "link preview image", "Discord or Slack unfurl", "payload-og-image", or asks why a LinkedIn, Facebook, X, Discord, Slack or Telegram preview shows no image, the wrong image or a stale one on a Payload site.
---

# payload-og-image

A Payload 3/4 plugin plus a Next 16 route that draws Open Graph cards (1200x630 by default) from your documents. The card URL carries a version derived from everything the card shows, so a changed title gives a new URL and an unchanged card is cached for a year. Source of truth: the package's `docs/` folder (`share-image-spec.md`, `reference.md`, `templates.md`, `crawlers.md`, `operations.md`) and the working app in `dev/` of the repository (https://github.com/anatolykoptev/payload-og-image/tree/main/dev; `dev/` and `scripts/` are not in the npm package). When this file and the docs disagree, the docs and the code win.

**All cards must conform to `docs/share-image-spec.md`** (in the installed package, or https://github.com/anatolykoptev/payload-og-image/blob/main/docs/share-image-spec.md): per-platform image rules, the safe zone, the standard design, which image goes where, and the checklist to run before a card design ships. Read it before changing or proposing a card design, and run its checklist before you report a card done.

## Install and compatibility

```sh
pnpm add payload-og-image
```

Version floors and the Payload 3 and 4 notes: the README's Compatibility section (the one owner of those numbers). ESM only; Node runtime only (no edge). Pre-1.0: the API can change in a minor release, so read the installed version's `docs/`.

## Steps

Start from the zero-config setup below: it is the right answer unless the user wants a card design of their own. Customise only what they ask for.

1. Install.
2. Add `serverExternalPackages: ['fontkit']` to `next.config`.
3. Register the plugin: `ogImagePlugin({ siteName })` for zero config, or fonts, stacks, templates and targets for your own design (walk the decision checklist with the user first).
4. Add the card route file (zero config: the one `[file]` route; your own targets: one file per target path and variant path).
5. Call `ogMetadata` in each page's `generateMetadata`.
6. If `fields` is on: `payload migrate:create`, commit the migration; run `payload generate:importmap`.
7. Verify (section below) and fix until every check passes.

## Zero config: the setup to start from

```ts
// payload.config.ts: set serverURL, and a store for production
ogImagePlugin({ siteName: 'Example', store: { dir: '/var/lib/app/og-cards' } })
```

plus the route file `app/(frontend)/og/[kind]/[slug]/[file]/route.ts` (`createOgRoute({ config })`, `GET`, `HEAD = GET`) and `ogMetadata({ config, target: '<collection slug>', doc })` in each page's `generateMetadata`. With neither `collections` nor `targets` the plugin serves every public collection (not upload or auth, readable anonymously, with a public title field) from two built-in presets: photo (JPEG, for a document whose hero is at least 800 x 420) and text (PNG, dark, with the site's logo). Bundled Inter fonts (latin, latin-ext, cyrillic) are used when you give none. Skipped collections are named once in a start-up line: read it before concluding a card is missing.

What is customisable, all of it optional and never overwritten by a default (a value you give is used as it is): `exclude`, `collections` (a list is exactly those; an object customises per collection: `preset`, `title`, `hero`, `label`, `subtitle`, `byline`, `path`), `siteName` or your own `site()` (it may return `logo`, `partnerLogo`, SVG or raster, and `brandArt`), `artOpacity`, `logoCollection`, your own `fonts` and `stacks`, `templates` and `targets` (an explicit target of the same name wins over discovery; `targets` without `collections` turns discovery off), `store`, `format`, `palette`, `fields`. Defaults that need a decision before production: no `store` means cards live in memory and are drawn again after a restart, and no `serverURL` means card URLs use `http://localhost:3000`. Details: `references/zero-config.md`. Write a template (`references/templates.md`) only for a brand design of their own.

## Mental model

- **Template** (`defineTemplate`): a pure function from props to a JSX card. It fetches nothing and reads no site data except through its props, because the props are what the URL version hashes. `id` and `revision` are part of every version: bump `revision` with the design.
- **Target** (`defineTarget`): maps one collection to one template. It holds the card `path` (must contain `:slug` or `:id`, may contain `:kind`), `props({ doc, site, related, overrides })`, optional `hero` (an upload) plus `heroCollection`, `images` (named upload lists, with `imageBoxes` on the template), `uploadFields`, `format`, `alt`, `share`. Zero config builds these for you.
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
3. **Photo card or text card?** A photo-first card (full-bleed image, scrim, title): `format: 'jpeg'` and a `.jpg` path; a JPEG or WebP card draws its hero in truecolour by default. A flat text card: PNG (default; a palette PNG is smallest for flat art). WebP is opt-in and not read by every crawler. A path whose extension contradicts the format is refused at start-up. The zero-config presets already pick the right one per document.
4. **Fonts**: self-host an OFL-licensed face that covers the site's scripts, as files in the repo or an assets folder, read them with a path built from `process.cwd()`, and cover every script the site writes (a Russian site needs a face with Cyrillic, and `requiredSample` extended with `«»„№₽`). Every character a stack cannot draw is stripped and reported as `glyph_missing`.
5. **Store dir on a persistent volume**: an absolute path only the app writes, mounted as a volume in Docker. A missing mount gives no warning and cards vanish on recreate.
6. **`serverExternalPackages: ['fontkit']`** in `next.config`. Required.
7. **`serverURL`**: the Payload config (or the plugin's `serverURL` option) needs an absolute origin; card URLs are absolute (`http` or `https`; crawlers need https, and the kit requires it unless `allowHttpImages: true`). Your own targets without one are a start-up error; a zero-config install boots with `http://localhost:3000` and one start-up line, so set it before deploying.
8. **Payload 3 versus 4**: on Payload 4 the Local API default is `overrideAccess: false`, so state it inside `site()` and `props`/`related` reads: `overrideAccess: true` for trusted site globals. Run `payload generate:importmap` after install. Details in `references/pitfalls.md`.
9. **Per-document overrides wanted?** If editors should set the card headline or switch the card off per page, enable `fields` (section below) and plan the migration.
10. **Crawler pre-flight**: `robots.txt` must not `Disallow` the card path; pages that Next caches must be revalidated on save or be `force-dynamic`.

## Minimal wiring (your own templates)

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

`fields: { enabled: true }` on the plugin adds a top-level group `og` to each target collection: `mode` (`inherit` default, `generated`, `custom`, `off`), `headline`, `subtitle`, `label`, `accent`, plus a hidden `nonce` and a live "Card preview" in the admin. Headline, subtitle, label and accent reach a card through `overrides` in `props` (the presets read all four themselves). To place the group yourself, call `ogFields()` and leave `fields` off; it must be named `og` and sit at the top level (directly, or in a row, collapsible or unnamed tab). **The new fields are columns: the site runs `payload migrate:create` and ships the migration.** Then run `payload generate:importmap` for the preview component. Full rules: `references/fields-and-mcp.md`.

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
- A zero-config site needs the `[file]` route, not `card.png/route.ts`: the preset path ends `card.:ext`, and a photo card requested as `card.png` is a 404.
- Zero config with no `store` keeps cards in memory (redrawn after every restart); no `serverURL` means `http://localhost:3000` card URLs.
- A remote hero (a URL on an `allowedImageHosts` host) is drawn only when it has a readable upload record (0.10.0, breaking); a hero object a resolver built by hand is never drawn as given, only its id counts.
- An SVG logo is drawn only through the plugin's sanitising parser and resvg worker; a refused or timed-out one gives the no-logo card (`svg_rejected` event). `@resvg/resvg-wasm` must be reachable from the server bundle (README, Install).
- `og:image` must remain a single image. Do not add a second image in a layout or page; a page's `openGraph` replaces the layout's whole `openGraph` (shallow merge).
- Cached pages keep an old `?v`: `force-dynamic` or revalidate with `ogTag` on save.
- JPEG for photo cards; WebP is not safe on every platform.
- The plugin boots under jsdom (start-up draws nothing), but drawing a card does not: a spec that draws (templates, `templatesRender`, `sizeBudget`, the kit's real renderer) needs `// @vitest-environment node`.
- Google structured data wants square and 4:3 images too: use target `variants` and `ogImages()` for JSON-LD (`references/targets.md`, 0.7.0 and later), never extra `og:image` tags. The images there are clean photo crops of the hero (no text, no logo, never the branded card): `docs/share-image-spec.md`, section 4.

## References (load on demand)

- `references/zero-config.md`: `collections`, what is auto-detected and how to override it, the preset choice, the refusal messages, the `[file]` route, bundled fonts, slots.
- `references/targets.md`: target options, hero (and a hero from a `hasMany` field), named `images`, format, static cards, size variants and `ogImages`, store and gate options.
- `references/templates.md`: writing a template, props, `ctx.fit`, fonts and stacks, the CSS subset.
- `references/fields-and-mcp.md`: the `og` group, `mode` table, migration, admin preview, MCP tools.
- `references/testing.md`: the kit, every check, the specs that boot Payload.
- `references/pitfalls.md`: failures with cause and fix, Payload 3 vs 4, Next 16 specifics, crawler notes.
