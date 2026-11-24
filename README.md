# payload-og-image

A Payload CMS plugin that draws Open Graph share cards from your content. Every card URL carries a version
derived from what the card shows, so a changed title or a replaced hero gives a new URL and an unchanged one
stays cached forever. Finished cards live on disk, behind a bounded render queue.

Status: 0.1, extracted from four production sites. Requires Payload `^3.93.0`, Next `^16.4.5`, React
`^19.3.1`, sharp `^0.35.4` and Node `^22.23.5 || ^24.22.3 || >=26.13.1`.

## Install

```sh
pnpm add payload-og-image@next   # 0.x releases are published to the `next` tag until promoted to `latest`
```

Add one entry to `next.config`:

```js
// fontkit reads data files relative to itself; bundled, it breaks any page that imports your Payload config.
serverExternalPackages: ['fontkit']
```

## Quick start: three files

**1. The Payload config** registers the plugin, your fonts and one template (see
[`dev/src/og/options.ts`](https://github.com/anatolykoptev/payload-og-image/blob/main/dev/src/og/options.ts) and [`dev/payload.config.ts`](https://github.com/anatolykoptev/payload-og-image/blob/main/dev/payload.config.ts)):

```ts
import { ogImagePlugin } from 'payload-og-image'

export default buildConfig({
  serverURL: 'https://example.com', // card URLs are absolute
  plugins: [ogImagePlugin(ogOptions)],
  // ...
})
```

`ogOptions` names the font files, the font stacks (a `default` stack is required), the templates, and a
target per collection:

```ts
targets: {
  posts: {
    path: '/og/:kind/:slug/card.png',
    template: 'post',
    props: ({ doc, site }) => ({ label: 'Blog', title: doc.title, site: site.name }),
    hero: ({ doc }) => doc.heroImage,
  },
},
store: process.env.OG_STORE_DIR ? { dir: process.env.OG_STORE_DIR } : { memory: true },
// OG_STORE_DIR: an absolute path on a volume only the app writes
```

**2. The card route** is the whole file ([`dev/app/(frontend)/og/[kind]/[slug]/card.png/route.ts`](https://github.com/anatolykoptev/payload-og-image/blob/main/dev/app/(frontend)/og/[kind]/[slug]/card.png/route.ts)):

```ts
import config from '@payload-config'
import { createOgRoute } from 'payload-og-image/next'

export const dynamic = 'force-dynamic'

const route = createOgRoute({ config })
export const GET = route.GET
export const HEAD = GET
```

**3. A page's metadata** ([`dev/app/(frontend)/posts/[slug]/page.tsx`](https://github.com/anatolykoptev/payload-og-image/blob/main/dev/app/(frontend)/posts/[slug]/page.tsx)):

```ts
export async function generateMetadata({ params }: Props) {
  const doc = await bySlug((await params).slug)
  return { title: doc?.title, ...(await ogMetadata({ config, target: 'posts', doc })) }
}
```

`ogMetadata` uses only `doc.id`. It reads the document again with the route's own query, so the version in
the page's `og:image` is the version the route serves as current, however shallowly the page loaded the doc.

## Which image a page gets

1. The image the editor set at `seoImage.path` (for example `meta.image`), unless it is the hero itself or
   `isDeliberate` says it is a placeholder.
2. Any other eligible image the target lists in `share`.
3. Otherwise the generated card.

An image is eligible when its width, height and MIME type are on record and it is a JPEG, PNG, WebP or GIF:
never an SVG (X's large card takes none), never an upload with no size. A card that would be blank (an empty
title) advertises nothing.

## Cache headers

| Answer                                                                     | `Cache-Control`                                     |
| -------------------------------------------------------------------------- | --------------------------------------------------- |
| `?v=` is the current version                                               | `public, max-age=31536000, immutable, no-transform` |
| any other or missing `v` (the current card is served)                      | `public, max-age=3600, no-transform`                |
| the hero could not be read, or the card fell back                          | `public, max-age=300, no-transform`                 |
| unknown document, shed (503 with `Retry-After: 5`), any draft-mode request | `no-store`                                          |

A card answer carries `etag: "<v>"` and `x-og-cache` (`render`, `memo`, `store` or `draft`). A downgraded card
(`x-og-cache: downgraded`, hero missing) and the brand fallback carry no `etag`, so a cache cannot revalidate them
into the current version; a 304 carries the `etag` and `cache-control` only. The request's `?v=` only picks the header; it is never a key, and the version is always derived
on the server.

Draft mode is never cached, never stored, and shows draft text only to an authenticated editor. An HTTP cache
that already holds a card for the same URL may serve it during a preview without asking the app; preview with a
fresh URL (`?preview=1`) if you need to be sure.

## Next 16 specifics (measured in the dev app)

- A page component's `params` arrive percent-encoded (`a%25b`). `generateMetadata` params and a route
  handler's `params` arrive already decoded (`a%b`). Decode in the page component only: decoding the others
  again throws on a literal `%`. The card route never decodes.
- The card route exports `GET` and `HEAD = GET`. `withHead` is for Payload's own REST route only (see below).
- A collection with drafts must allow public reads of published documents, because the plugin reads with
  `overrideAccess: false`:
  `read: ({ req: { user } }) => (user ? true : { _status: { equals: 'published' } })`.

## Where the cards live

`store: { dir }` must be an absolute path to a volume that only the app writes, with room for the cap
(default 2000 files, 100 MiB). In Docker, mount a named volume there and keep the folder out of the build
context (`.dockerignore`: the same path). Without a writable volume the store switches itself off with one
`store_disabled` event and cards stay in memory only. [docs/operations.md](docs/operations.md) has the runbook.

`store: { memory: true }` keeps cards in memory only (tests, serverless).

## Crawlers

Link-preview crawlers need an absolute https image URL, no redirect, a 1200x630 image, and `Allow` for the
card path in `robots.txt`. They send HEAD first, so the card route answers HEAD. See
[docs/crawlers.md](docs/crawlers.md).

## HEAD for Payload REST

Payload's REST router looks endpoints up by method, so a HEAD to `/api/media/file/...` answers 404 and
LinkedIn drops an editor-chosen image. In the generated `app/(payload)/api/[...slug]/route.ts`:

```ts
import { withHead } from 'payload-og-image/next'

export const HEAD = withHead(GET)
```

`withHead` is a stopgap: remove it when Payload REST answers HEAD for GET endpoints. Do not use it on the card
route, where `HEAD = GET` is enough.

## Templates

[docs/templates.md](docs/templates.md): the CSS subset, fonts, Cyrillic stacks, and why a template draws
nothing that is not in its props.

## Testing your site

`payload-og-image/testing` exports `installTestRuntime` and `ogKit`. The kit calls your real page, metadata and
route modules and checks the failures this plugin exists to prevent: a draft cached, a stale version served as
immutable, a client-chosen version stored, a HEAD that is not GET's twin, a card route whose path no config
declares, a template that draws something the URL does not cover. See [`dev/tests/og.spec.ts`](https://github.com/anatolykoptev/payload-og-image/blob/main/dev/tests/og.spec.ts).

`og-parity --old <dir> --new <dir>` compares two directories of rendered cards (`<card>.png` plus
`<card>.layout.json`) pixel for pixel, for a migration that must not change a card.

## Not in 0.1

Per-document mode and headline fields in the admin, live preview, a force-new-image nonce, a stats endpoint,
pre-warming, locales, JPEG/WebP output, size variants, local emoji, another renderer, object-storage stores.
Each has a start trigger in the design notes; the version and URL formats already reserve the slots, so adding
them changes no existing URL.

## Threat model

The card store directory (`store: { dir }`) must be private to the application user and live on a volume only
the application writes. Anyone who can write that directory can already change the application, so the store
defends against corrupt or foreign files appearing in it (torn writes, symlinks, odd file types), not against a
local attacker racing it with directory swaps after boot.

## Release checklist

- Before the repository goes public, deregister the self-hosted runner from it. Otherwise a fork could target
  that runner by editing the workflow. Switch nothing else by hand: `preflight.yml` already picks a hosted runner
  once the repository is public.
- Keep "Require approval for all outside collaborators" (fork pull request workflows) turned on.
- Set the `NPM_TOKEN` secret. `scripts/verify-pack.mjs` packs the tarball, installs it into a clean project and
  checks every entry point and the bin before a publish.

## Development

```sh
pnpm install
pnpm test -- test/<file>   # scoped tests
make preflight             # lint, typecheck, test, build, api-extractor (CI runs this)
pnpm api:update            # accept an intended public-surface change into etc/*.api.md
pnpm dev                   # the dev app (SQLite) in dev/
```

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
