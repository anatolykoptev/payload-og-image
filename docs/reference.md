# Reference

Detail behind the [README](../README.md): how a page picks its image, cache headers, Next 16 specifics, who counts as an editor, related documents, the card store, the crawler notes and the test kit. [Templates](templates.md), [operations](operations.md) and [crawlers](crawlers.md) have their own pages.

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

A card answer carries `etag: "<v>"` and `x-og-cache` (`render`, `memo`, `store`, `draft`, `downgraded` or `fallback`). A downgraded card
(`x-og-cache: downgraded`, hero missing) and the brand fallback carry no `etag`, so a cache cannot revalidate them
into the current version; a 304 carries the `etag`, `cache-control`, `content-type` and `x-og-cache` and is sent only once the current card is in hand. The request's `?v=` only picks the header; it is never a key, and the version is always derived
on the server.

A stale `?v` is not an error: the route answers it with the **current** bytes and the one-hour header, because the version
is derived on the server and the request's `?v` only picks the header. The old URL therefore never shows the old card
again, but a platform that fetched the card under it earlier keeps those bytes until it re-scrapes the page (it caches
by full URL, and the page now advertises the new one). A CDN in front of the route must keep the query string in its
cache key: the current-`v` answer is `immutable` for a year, any other `?v` is not, and a cache that drops the query
would hand one answer to every `?v`.

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

## Pages that Next caches

`ogMetadata` runs when Next renders the page. A page Next keeps (measured: a route with `generateStaticParams`) is
rendered once and serves the same `og:image`, `?v` included, until it is revalidated. Editing a title changes the card's
URL, not the cached page that links to it, so a crawler reading the page finds the old URL (measured in the dev app,
Next 16.4.6: a dynamic-segment page without `generateStaticParams` is rendered on every request and has no such problem).
Two ways out:

- **Render on every request**: `export const dynamic = 'force-dynamic'` on the page, as the dev app's `posts/[slug]` does.
- **Revalidate on save**: tag what the page reads and expire the tag from an `afterChange` hook. `ogTag(collection, key)` and
  `OG_SITE_TAG` from `payload-og-image/next` only name the tags, so the page and the hook agree (`key` is anything both
  know: the slug, the id; a tag over Next's 256-character limit (`unstable_cache` drops it with a console warning, `revalidateTag` silently matches
  nothing) is shortened to a hash; a raw key shaped like a shortened tag can equal one, which only refreshes one page too many).

```ts
// page: what it reads carries the tag
const bySlug = (slug: string) => unstable_cache(() => find(slug), ['post', slug], { tags: [ogTag('posts', slug), OG_SITE_TAG] })()

// collection hook
import { revalidateTag } from 'next/cache.js' // `.js`: plain-Node ESM (the Payload CLI) cannot resolve the bare `next/cache`
export const revalidatePost: CollectionAfterChangeHook = ({ doc, previousDoc, req }) => {
  if (req.context.disableRevalidate) return doc // scripts outside Next (a seed) have no cache to talk to
  if (doc._status !== 'published' && previousDoc?._status !== 'published') return doc // never published: no public page
  for (const slug of new Set([doc.slug, previousDoc?.slug])) if (slug) revalidateTag(ogTag('posts', slug), { expire: 0 })
  return doc
}
// the same for `afterDelete` (a deleted post must not leave its cached page behind): revalidateTag(ogTag('posts', doc.slug), { expire: 0 })
// a global that `site()` reads (the business name on every card): revalidateTag(OG_SITE_TAG, { expire: 0 })
```

Use `{ expire: 0 }`, not `'max'`: `'max'` serves the stale page to the next visitor, and the next visitor after a save is
often the crawler. `afterChange` (and `afterOperation`) run inside the operation's transaction, before it commits (Payload 3.94.1: `updateByID` calls
`buildAfterOperation` before `commitTransaction`; `req.transactionID` is set while one is open). A request that re-renders the
page in that window reads the old document and caches it again, with the old `og:image`. For a rarely read page the window is
milliseconds and does not matter. For a hot page, collect the tags of the request and expire them
once the commit is done, from outside Payload: wrap the REST route's handlers in `app/(payload)/api/[...slug]/route.ts` and share the
tags through an `AsyncLocalStorage` (the wrapper cannot see `req`, and a module-level set would mix the tags of overlapping saves).
Every mutating REST method needs the wrapper: `POST`, `PATCH` and `DELETE`. The hook falls back to expiring at once when it runs
outside a wrapper (GraphQL, a job, the Local API, a script), which is inside the transaction, so that window stays open there:
`const tags = new AsyncLocalStorage<Set<string>>()`; in the hook, `const s = tags.getStore(); s ? s.add(t) : revalidateTag(t, { expire: 0 })`
with `t = ogTag('posts', slug)`; and
`export const PATCH = async (r, c) => { const mine = new Set<string>(); const res = await tags.run(mine, () => REST_PATCH(config)(r, c)); for (const t of mine) revalidateTag(t, { expire: 0 }); return res }`
(that wrapper resolves after the commit), the same for `POST` and `DELETE`.

Deleting a document runs no `afterChange`: add an `afterDelete` hook that expires the same tag. Without a tagged read, `revalidatePath('/posts/<slug>')` does the same for one page. The plugin's own
`afterChange` on `siteGlobals` only drops its per-process `site()` cache; it never touches Next's page cache. A vitest suite
has no Next page cache, so the proof is over HTTP: `scripts/probe-dev-server.mjs` (run in CI after the build) edits a post
of the dev app's cached page `/cached/[slug]` and requires the page to advertise a new card URL at once.

## Who counts as an editor

Draft text and draft site data go only to users of the admin user collection (`admin.user`, normally `users`), or of
the auth collections named in the `editors` option. A user of any other auth collection (customers, say) is never
an editor, and `site()` is told which user it is serving (`site({ payload, draft: true, user })`).

## Per-document share card fields

Set `fields: { enabled: true }` on `ogImagePlugin` and each target's collection gets a group `og` with three
fields: `mode`, `headline` and `subtitle`. It is off by default, and with it off the schema is exactly what it
was without the option. The plugin only adds fields: it never adds a collection or a job. Its endpoints are listed under [Endpoints](#endpoints).

```ts
ogImagePlugin({ /* ... */, fields: { enabled: true } }) // the group sits in the sidebar
ogImagePlugin({ /* ... */, fields: { enabled: true, position: 'tab' } }) // a "Share card" tab instead
```

To place the group yourself, call `ogFields()` and leave `fields` off. The group must be named `og` and must sit at
the top level of the document: directly in the collection's `fields`, or inside a row, a collapsible or an unnamed
tab. The plugin reads `doc.og` only. An `og` nested under a named group (such as `meta`), an array or a named tab is
never read, so the plugin warns at start-up and, with `fields` on, still adds the top-level group. A collection that
already has a top-level `og` is not given a second one. If it has its own `og` group with a `mode` field, the
plugin reads that on upgrade: rename yours first if its values differ from `inherit`, `generated`, `custom`, `off`.

| `og.mode`               | What the page advertises                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inherit` (the default) | Exactly what 0.1 did: the editor's image, else `share`, else the generated card.                                                                  |
| `generated`             | The generated card, even when the editor set an eligible image.                                                                                   |
| `custom`                | The editor's image only (`share` is not asked). A generated card if it is not eligible.                                                           |
| `off`                   | No card of its own: the page adds no `og:image`, so a site-wide default image set in the layout still applies. It does not suppress that default. |

A document with no `og` data, or `inherit`, resolves to the same card and the same `?v=` as before: the mode does
not enter the version. The headline and the subtitle reach a target through `overrides`, trimmed and left out
when empty, and they change a card only when its `props` reads them:

```ts
defineTarget({
  // ...
  props: ({ doc, overrides, site }) => ({ title: overrides?.headline ?? doc.title, subtitle: overrides?.subtitle, site: site.name }),
})
```

Because they go through `props`, they are part of the version like any other prop, and a document with a
headline gets its own URL. A target that sets `select` keeps `og` selected without listing it.

**Migration.** The new fields are columns. After enabling `fields` (or placing `ogFields()`), each site runs
`payload migrate:create` and ships the migration with the plugin bump; the plugin does not migrate for you.
Postgres limits an enum name to 63 characters; the select's is `enum_<collection>_og_mode`, so for a long collection
slug set `dbName` on the `mode` field of the group you place (or shorten the slug).

## Live preview in the admin

The `og` group ends with a "Card preview": a picture of the card for the document as it is being edited, redrawn 800 ms
after the last change, with warnings in plain words (a character no font draws, mode Off, a custom image that cannot be
shared or is under 600x315, a card over 300 KB). It is a UI field: no column, no migration.

After adding the plugin (or upgrading), run `payload generate:importmap` so the admin finds the component
(`payload-og-image/client#OgPreviewField`). The component needs `@payloadcms/ui`, an optional peer at the version of your
`payload`.

The preview asks `POST /api/payload-og-image/preview` (added whenever a target collection carries the `og` group,
whether by the `fields` option or by hand). Its rules:

- a signed-in user of an editor collection (the admin user collection, or `editors`), else 401 or 403;
- the collection must be one of your targets, else 404: the endpoint cannot draw any other;
- with an `id`, the document must be readable by that user as a draft (`overrideAccess: false`), else 403; without an
  `id`, the collection's `access.create` must pass;
- only then is the editor's unsaved form merged over the saved draft. Anything in the form that looks like an upload
  (it has a `filename`, or a `url` with a `mimeType`, or a `url` and an `id` with a size or date field) is reduced to its plain id or dropped; the known upload fields are
  read again with the user's own access, never taken from the request. The body is capped at 256 KB even without a length;
- the card is drawn through the render gate and returned as a PNG (a JPEG or WebP for such a card) with `Cache-Control: no-store`. It never touches the
  memo or the store. A full gate answers 503 with `Retry-After`.

The picture is always the card `generated` would draw, whatever the mode, so an editor sees what Off or Custom would fall
back to. The warnings travel in the `x-og-warnings` header (ASCII JSON).

### Force new image

The group holds a hidden number `og.nonce` (default 0), changed by the preview's "Force new image" button, which adds 1.
It is part of the card's version, so a new value is a new card URL: LinkedIn, Facebook and Telegram fetch the card again.
A nonce of 0 (or none) is exactly the 0.1 version, so no existing URL changes. The field is a column: run
`payload migrate:create` after upgrading, as for the rest of the group.

The button is disabled where a new nonce cannot change the page's card URL, with a one-line reason: mode Off (no card at
all), and a page that shares an image (the editor's, or one the target offers) instead of a generated card. The nonce is
saved with the document, so the new address reaches the public page only when the document is published.

A new card URL is seen only when a platform reads the page again. Anything already shared keeps the old card until the
platform re-fetches it: paste the page URL into the LinkedIn Post Inspector or the Facebook Sharing Debugger to make it
scrape again (see [crawlers](crawlers.md)).

## Endpoints

The plugin adds up to two endpoints to your Payload config, after your own, and none when `disabled` is true:

- `GET /api/payload-og-image/stats`: always.
- `POST /api/payload-og-image/preview`: only when a target collection carries the top-level `og` group, whether by the
  `fields` option or by hand.

It adds no collection, job or hook other than the `afterChange` hook on `siteGlobals`.

## Stats

`GET /api/payload-og-image/stats` (always registered, unless `disabled`) tells an admin how the plugin is running:
`{ counters, gate: { active, waiting }, memo: { size, bytes }, store: { kind, enabled, dir? } }`. `counters` has one number
per event name (`render`, `hit_memo`, `shed`, ...), counted in this process since it started; `dir` is the disk store's
folder and is given only for a disk store. Only a user of the admin user collection whose collection's `access.admin`
passes gets an answer; anyone else, an anonymous request included, gets 403. `access.admin` must return exactly `true`: a
truthy value or an error is a refusal. A collection with no `access.admin` at all (the stock `users` on Payload 3) lets in every user of the admin collection, as Payload's own admin check does. For a disk store, `dir` (an absolute path on your server) is shown
to every admin who may read the answer. The answer is `no-store` and holds nothing else
(no config value, key or file name).

## Related documents

The plugin reads your document at depth 0, whatever `defaultPopulate` or `select` say: a relation arrives as its bare
id, so a draft-only related document can never leak into a published card. Two things are loaded for you, each by id and
with the visitor's access: the hero upload and the upload fields the document carries. Anything else a card draws comes
through `related(collection, id)` in `props`:

```ts
props: async ({ doc, site, related }) => {
  const author = await related('authors', doc.author)
  return { title: doc.title, byline: author?.name ?? '', site: site.name }
},
```

`related` is published-only and access-respecting (it is `null` for a missing, unpublished or forbidden document); an
editor previewing a draft also gets the draft of a related document. `Target.depth` is gone: there is nothing to tune.
Say which upload collection a hero lives in with `heroCollection` on the target; a hero file is read only inside that
collection's folder. A transparent hero keeps its transparency, so the card shows through it exactly as it would through a direct `<img>`; set
`heroBackground` (`#rgb` or `#rrggbb`; names and alpha forms are refused at start-up) to flatten it onto that colour. It is part of the version of a card with a hero, so changing it gives new URLs. Before 0.5.0 a transparent hero was always flattened, onto white by default; a card whose hero has a see-through pixel and whose site sets no `heroBackground` gets a new URL once. The card's URL needs to know whether the hero has a see-through pixel, so the first request in a process reads the hero file once (by its bytes, whatever its stored mimeType says) and remembers the answer per upload. With `palette.hero: false` the pixels of a hero match a direct `<img>` when the template's `heroBox` is the image's own size (the default palette re-encodes the hero and moves pixels by a level); at any other size the image is scaled twice (once to the box, once when drawn), and the edge pixels differ by a few levels. Remote heroes (`allowedImageHosts`) are fetched over https on the default port with a dedicated
agent (never an environment proxy), from a vetted public address only (IANA special-purpose ranges are refused), with no
redirect.

## Card and hero encoding

By default the renderer keeps the smaller of the truecolour PNG and a palette re-encoding of it (`palette.card`), and a hero is
cut to a palette PNG before it is drawn (`palette.hero`). A palette PNG is a fraction of the size for flat cards, but it
moves pixels: a flat field can shift by a level, and photographs and gradients in a hero band. A site that must keep its pixels, or
migrates cards that were drawn without a palette, turns either off:

```ts
ogImagePlugin({
  // ...
  palette: { card: false, hero: false }, // truecolour for both; each is `false` or a colour count from 2 to 256
})
```

Unset keeps today's behaviour exactly: no existing card URL or bytes change. A value other than the default is part of
the card version (`card` for every card, `hero` for a card with a hero), so flipping it gives new URLs and never serves
a stored card of the other encoding. A number is a ceiling: the encoder rounds it up to 2, 4, 16 or 256 colours, so
17 to 256 all give the 256-colour palette (the default `card` of 128 and a `hero` of 256 are the same bytes at the sizes below).
The test kit draws with the same setting, so `sizeBudget` measures what you serve.

Size, measured with sharp 0.35.5 on 1200x630 cards (Inter 72px text on a dark ground; the hero is a 460x630 noisy photographic
gradient). Your numbers depend on the artwork; measure a real card with `ogKit(rt).sizeBudget`.

| Card              | `card` / `hero`      |   Bytes |
| ----------------- | -------------------- | ------: |
| Flat, no hero     | `false`              |  34,741 |
| Flat, no hero     | default              |  11,768 |
| Flat, no hero     | `card: 16`           |   8,630 |
| Photographic hero | `false` / `false`    | 657,266 |
| Photographic hero | `false` / default    | 196,629 |
| Photographic hero | default / `false`    | 157,810 |
| Photographic hero | default / default    | 141,182 |
| Photographic hero | `card: 16` / default |  62,960 |

A flat card is about three times larger without the palette, and a card with a photographic hero about 4.7 times larger with both off.

## JPEG and WebP cards

A photo-first card (a full-bleed photograph with a title on a scrim) is the wrong job for PNG: with the default palette the photo and
the scrim posterise and band, and with `palette: { card: false, hero: false }` the truecolour PNG is over a megabyte. Switch the
encoding instead, for every card or for one target (the target wins):

```ts
ogImagePlugin({
  // ...
  format: 'jpeg', // 'png' (default) | 'jpeg' | 'webp'
  jpeg: { quality: 82 }, // 1 to 100, mozjpeg; the default
  webp: { quality: 80 }, // 1 to 100, libwebp; the default
  targets: {
    places: defineTarget({ path: '/og/:kind/:slug/card.jpg', format: 'jpeg', template: 'place', props, hero }),
    posts: defineTarget({ path: '/og/:kind/:slug/card.png', format: 'png', template: 'post', props }), // stays PNG
  },
})
```

Unset keeps today's behaviour exactly: PNG, and no existing card URL or byte changes (the version tests pin it). The format, its quality
and the flatten ground are part of the card version (the version's `variant` slot), so switching gives new URLs and never serves a
stored card of the other encoding; settings of a format a card does not use change nothing about it. The same value drives the
`content-type`, `og:image:type`, the store's file name (`<page>-<v>.png`, `.jpg` or `.webp`) and its validation, the memo, the 304 and
HEAD answers, the fallback and downgraded cards, the admin preview, the MCP `og_card` and `og_preview` tools (`mimeType`), the kit and
`og-parity`.

- **Choose JPEG for photo cards; WebP is opt-in.** Every crawler we could check reads JPEG. WebP is documented for X and Discord only; Facebook and
  LinkedIn publish no list of formats and Telegram is reported to drop a WebP preview ([crawlers](crawlers.md#image-formats)). WebP is
  16 to 20 percent smaller at the defaults, on the sample photograph below, which is not worth a missing preview on one platform.
- **No alpha.** JPEG cannot hold it, and a WebP card is flattened too, because crawlers composite a see-through card onto whatever they like. A pixel the
  template leaves see-through is flattened onto the card's ground: the target's or template's `heroBackground`, else the plugin's, else white.
  A transparent hero is drawn over the template's own background as always, so it shows that background through its see-through pixels, and
  only what the template leaves unpainted becomes the ground. Paint the template's ground explicitly for a JPEG or WebP card.
- **The path should name the format.** A target's `path` is the site's. A card path ending in `.png` with a JPEG or WebP card (or `.jpg` with a PNG) is
  **refused**: `defineTarget` throws for a target that sets `format`, and `ogImagePlugin` throws at start-up for the effective format, naming the path.
  A path with no image extension (`/og/:kind/:slug/card`) is accepted: crawlers go by `content-type`. The route file's folder name follows the path
  (`card.jpg/route.ts`).
- **Stored files.** A JPEG or WebP has no checksum, so a stored one is checked twice: the container structure (JPEG: markers, tables, scan header, EOI as the last two
  bytes; WebP: the RIFF size equals the file, every chunk in bounds, the VP8 start code) and then a full decode that fails on any warning. A torn, truncated
  or foreign file is a miss and is deleted, as for a PNG. A bit flipped inside a scan that still decodes cleanly cannot be told from a different picture; the PNG's per-chunk
  CRC has no equivalent.
- `templatesRender` in the kit draws each template as a PNG whatever the target's format: it checks the drawing, not the encoding.

Size, measured with sharp 0.35.5 (mozjpeg, libwebp effort 4) on a 1200x630 full-bleed landscape photograph with a 72px Inter title on a
bottom scrim (a smooth aerial photograph; a noisier one costs more in every format), and on a flat card (the same title on a dark ground).
The photograph is drawn as a truecolour PNG hero except where noted. Your numbers depend on the artwork; measure a real card with `ogKit(rt).sizeBudget`.

| Card                                    |       Photograph |   Flat |
| --------------------------------------- | ---------------: | -----: |
| PNG, default card palette (128 colours) | 282,588 (banded) | 12,225 |
| PNG, truecolour (`card: false`)         |        1,264,782 | 36,456 |
| JPEG quality 70                         |           55,648 | 15,802 |
| JPEG quality 82 (default)               |           79,893 | 19,790 |
| JPEG quality 90                         |          116,338 | 27,268 |
| WebP quality 70                         |           47,108 |  9,814 |
| WebP quality 80 (default)               |           63,832 | 11,178 |
| WebP quality 90                         |          112,864 | 14,172 |

With the default 256-colour palette hero the photograph card is 314,353 bytes as a palette PNG, 541,422 as a truecolour PNG and 82,059 as a
JPEG at quality 82. The photographic card at the JPEG default is a quarter of the palette PNG and keeps the photo's colour; a flat card
stays smallest as a palette PNG, so keep flat templates on PNG. The extra encode time per card, on the first draw only: about 35 ms for JPEG
and 55 ms for WebP on photographs (the PNG draw is 50 to 210 ms). Quality 82 and 80 are the lowest levels at which the title's edges show no ringing and
no colour bleed in a 2x crop of this card, and both stay under 100 KB, far inside the few hundred KB crawlers tolerate.

## Where the cards live

`store: { dir }` must be an absolute path to a volume that only the app writes, with room for the cap
(default 2000 files, 100 MiB). In Docker, mount a named volume there and keep the folder out of the build
context (`.dockerignore`: the same path). Without a writable volume the store switches itself off with one
`store_disabled` event and cards stay in memory only. [operations](operations.md) has the runbook.

`store: { memory: true }` keeps cards in memory only (tests, serverless).

The plugin targets the Node.js runtime: it draws with `sharp` and `fontkit` and its disk store uses `node:fs`. The edge
runtime is not supported. A serverless platform (no volume that outlives an instance) needs `store: { memory: true }`, so
every cold instance draws its cards again; that setup is untested.

## Crawlers

Link-preview crawlers need an absolute https image URL, no redirect, a 1200x630 image, and `Allow` for the
card path in `robots.txt`. They send HEAD first, so the card route answers HEAD. See
[crawlers](crawlers.md).

```txt
# robots.txt: the card path is the `path` of your targets (`/og/:kind/:slug/card.png` in the examples)
User-agent: *
Allow: /og/
```

Do not `Disallow` it: the crawler fetches the image as its own URL, whatever the page allows.

## HEAD for Payload REST

Payload's REST router looks endpoints up by method, so a HEAD to `/api/media/file/...` answers 404 and
LinkedIn drops an editor-chosen image. In the generated `app/(payload)/api/[...slug]/route.ts`:

```ts
import { withHead } from 'payload-og-image/next'

export const HEAD = withHead(GET)
```

`withHead` is a stopgap: remove it when Payload REST answers HEAD for GET endpoints. Do not use it on the card
route, where `HEAD = GET` is enough. `ogKit(rt).restHeadParity({ module, url })` checks it: it calls your REST route
module with a GET and a HEAD for an upload that exists (`url`, absolute, under `/api` unless you pass `apiRoute`) and
fails when the HEAD answers another status or other headers than the GET. A module with no `HEAD` export is called as Next
calls it, with the GET and the request's method set to HEAD, which is the case Payload answers 404.

## Testing your site

`payload-og-image/testing` exports `installTestRuntime` and `ogKit`. The kit calls your real page, metadata and
route modules and checks the failures this plugin exists to prevent: a draft cached, a stale version served as
immutable, a client-chosen version stored, a HEAD that is not GET's twin, a card route whose path no config
declares, a template that draws something the URL does not cover. The test runtime runs the production draft logic over an in-memory drafts collection, so give `draftNeverCached` a
document that exists only as a draft (`draftOnly`): the public and a draft-mode visitor without an editor must get a 404,
and an editor's credential (a user of the first editor collection) the draft. `routesMatchPaths` reads your route files
and counts one only when the `GET` it exports is the one `createOgRoute()` returned, resolved through the file's own
declarations; a mention in a comment or a string, a name shadowed in a helper, a `GET` re-exported from another module or
built from a compound expression does not count. It parses with the TypeScript compiler API (syntax only, no type
checking), so `payload-og-image/testing` has an optional peer: `typescript` 5, 6 or 7, but TypeScript 7 has no in-process
API, so on it the compiler comes from `@typescript/typescript6`, which the plugin falls back to. The project's own
packages are looked up first (from the working directory the tests run in), then the plugin's, so a linked or
workspace-symlinked copy of the plugin still finds yours. Without a compiler it throws and says what to install; the other entries
never load the compiler. Limits of the reading: a name declared twice at the top level is never credited; a `GET` that is
`let` and reassigned later is not modelled (declare it `const`); `import * as og from 'payload-og-image/next'` with
`og.createOgRoute(...)` is understood, and `export * from` is not followed. `everyRouteHasOwnCard` requires an `https` image URL for every image in the `og:image` and
`twitter:image` lists, as the crawlers document it; pass `allowHttpImages: true` for a site that is only ever served on plain HTTP, such as a local dev server. See [`dev/tests/og.spec.ts`](https://github.com/anatolykoptev/payload-og-image/blob/main/dev/tests/og.spec.ts).

**Give a kit spec a timeout.** vitest stops a test after 5 s, and a kit call that renders many cards can outlast that on a
loaded runner: `queueSheds` sends the gate, the queue and three more cold requests (55 with the defaults) through your
real route and waits for all of them. The kit itself adds almost nothing (about 10 ms against the stub renderer); the time
is your site's cold requests, and a call that is still waiting after 10 s fails with a message naming what it waited for.
Set the limit on the `describe` that holds the kit calls, and copy this line:

```ts
describe('og kit', { timeout: 60_000 }, () => {
  // installTestRuntime(...) and the ogKit(rt) calls
})
```

`sizeBudget` and `templatesRender` also draw real cards, so the same limit applies to them.

`ogKit(rt).glyphCoverage({ samples })` checks every stack against every sample. A stack that is not meant to draw them all (a
Latin-only mono face against a Cyrillic sample) takes its own list: `glyphCoverage({ samples, stacks: { mono: ['Plain text'] } })`
checks `mono` against that list and the others against `samples`; a stack name that is not configured is an error, and with
every stack named `samples` can be left out.

The test runtime's heroes are small stand-in images, always opaque. `installTestRuntime(options, docs, { heroDir })` prepares a
hero whose `filename` is a file in that folder with the production loader (the same cut, `heroBackground` and `palette.hero`),
so a real icon is drawn, and tested, as it will be; and `{ transparentHero: (hero) => boolean }` declares stand-ins
transparent, to see the URL a transparent hero gets.

`ogKit(rt).templatesRender({ props })` draws every registered template once with the real renderer, from the props
you give for its id (`{ [templateId]: props }`), and fails naming a template that cannot be drawn or does not give a PNG (whatever the target's `format`)
of its size: a `div` with several children and no `display: flex` is caught in CI, not by the first crawler. The plugin
also draws the brand fallback card once when Payload starts, so fonts and the renderer are proved at boot (an error
outside production, a `render_error` event in production).

### Specs that boot Payload

- **Run them in a Node environment.** The plugin's start-up self-test draws a card with `next/og` and `sharp`, which refuse a
  `Uint8Array` or `Buffer` from another realm, and under `jsdom` the test global is a different realm: the self-test fails with
  `Unsupported input ... of type object`. jsdom also replaces the global `URL`, so `new URL('...', import.meta.url)` resolves to
  `http://localhost/...` and a font loader built on it tries to fetch. Put such specs in a Node environment: `// @vitest-environment node` at the top of the file, or `environment: 'node'` in a vitest project for them.
- **Inline the plugin when you mock `next/headers.js`.** `vi.mock('next/headers.js', ...)` only reaches modules that vite
  processes, and vitest leaves a dependency in `node_modules` to Node. Inline the package so the mock applies to it:
  `test: { server: { deps: { inline: ['payload-og-image'] } } }`.
- **Do not build font paths with `new URL('...', import.meta.url)`.** Under vite and Next (and any jsdom or other web
  transform) that URL is rewritten to an asset URL or a path, not a `file:` URL, and `readFile` on it fails. Read from a folder
  relative to the project root instead, which is `process.cwd()` under vitest, `next dev` and `next build`:

  ```ts
  import { readFile } from 'node:fs/promises'
  import path from 'node:path'

  // fonts live in ./assets/fonts in the repository
  export const fontFile = (name: string) => () => readFile(path.join(process.cwd(), 'assets/fonts', name))
  // fonts: [{ family: 'Inter', weight: 800, data: fontFile('inter-800.woff') }]
  ```

  A standalone build (`output: 'standalone'`) runs from `.next/standalone`, which holds only the files Next traced: list the
  folder in `next.config` (`outputFileTracingIncludes: { '/**': ['./assets/fonts/**'] }`) so the fonts are copied. The dev app
  in this repository reads its fonts this way (`dev/src/og/options.ts`) and `scripts/probe-dev-server.mjs` serves it with `next start`.

`og-parity --old <dir> --new <dir>` compares two directories of rendered cards (`<card>.png`, `.jpg` or `.webp`, plus
`<card>.layout.json`) pixel for pixel, for a migration that must not change a card. Both formats are decoded; a JPEG or WebP is compared on its decoded pixels (exact for the same encoder and quality), and a card that is one format on one side and another on the other is reported (`format png vs jpeg`), not compared.

## MCP tools

A site that already runs `@payloadcms/plugin-mcp` can let an agent look at its cards. `payload-og-image/mcp` returns tool
definitions in the plugin's own custom-tool shape; it builds no server and imports nothing from the plugin. One line of wiring,
by the plugin's major (the two have different custom-tool APIs):

```ts
// @payloadcms/plugin-mcp 3 (Payload 3): an array under `mcp.tools`; this entry imports zod
import { ogImageMcpTools } from 'payload-og-image/mcp/v3'
mcpPlugin({ /* collections, globals... */ mcp: { tools: [...ogImageMcpTools({ describedBy: 'meta.description' })] } })

// @payloadcms/plugin-mcp 4 (Payload 4): a map under the top-level `tools`; this entry needs no zod
import { ogImageMcpToolMap } from 'payload-og-image/mcp'
mcpPlugin({ /* collections, globals... */ tools: { ...ogImageMcpToolMap({ describedBy: 'meta.description' }) } })
```

The same implementation serves both. `payload-og-image/mcp/v3` imports `zod` (`^3.25.50`, the version plugin 3 uses) statically, so a
bundler and Next's file tracer (`output: 'standalone'`) include it; the plugin depends on it, but under strict pnpm (no hoisting) add
it to your own dependencies, since an optional peer is not installed for you. `payload-og-image/mcp` (the Payload 4 map, JSON Schema
inputs) imports no zod at all. On Payload 4 the tools are available to a signed-in MCP user, as the plugin's own
default is; pass `access: ({ req }) => ...` to narrow it. On Payload 3 each tool is enabled per API key in the admin.

They change nothing in your content, and read what the card
route reads: published documents only, as the public, never a draft and never an editor, whatever the key's user may see. The one
write is `og_preview` storing a card the route would have stored, under its versioned key. Calls share a small queue of their own
(two at a time, two waiting); a busier moment answers `busy`, and any failure answers a fixed sentence while the detail goes to the server's log.

- `og_card`: for a page, the card URL with its version, which target or static card, whether it is stored (a store lookup, nothing
  is drawn) and its size, the hero (whether it is transparent, the ground it is flattened onto, whether its file can be read), and
  why there is no card or why it is not stored. Give `target` with `id` or `slug`, a `static` key, or a `path`: a card route path or
  URL, or a page path when the site maps pages with the `locate` option (`(pathname) => ({ target, slug })`); the plugin knows its
  own card paths only.
- `og_audit`: with no `scope`, the scopes (each target and `static`) and their document counts; with one, a page of at most 100
  rows with the card URL, stored or not, its size, and, when `describedBy` names a field path, whether the document has a meta
  description (the gap that leaves a share without text). No card is drawn and no stored card is read, only stat'ed; a row's version is
  built from the document, so a hero file is read once per upload (`checkHeroes` also reads every hero to find cards that would be
  drawn without it).
- `og_preview`: the card as an image (`mimeType` is the card's). Its info line keeps `status: 'png'`, which means "an image" (kept for compatibility); `type` carries the media type. A stored card is read from the store; otherwise it is drawn through the route's own admission
  gate and render queue (a full queue answers `shed`, retry later), memoised and stored under its versioned key, exactly as a crawler's
  request would. A card over `maxPreviewBytes` (1.5 MiB) is described, not sent.

`stored` means a file exists under the exact version in the store (a stat; the card is not re-validated).

## Not implemented

Pre-warming, locales, AVIF output, size variants, local emoji, another renderer, object-storage stores.
The version and URL formats already reserve the slots, so adding them later changes no existing URL.

## Threat model

The card store directory (`store: { dir }`) must be private to the application user and live on a volume only
the application writes. Anyone who can write that directory can already change the application, so the store
defends against corrupt or foreign files appearing in it (torn writes, symlinks, odd file types), not against a
local attacker racing it with directory swaps after boot.
