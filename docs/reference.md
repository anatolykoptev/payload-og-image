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

A card answer carries `etag: "<v>"` and `x-og-cache` (`render`, `memo`, `store` or `draft`). A downgraded card
(`x-og-cache: downgraded`, hero missing) and the brand fallback carry no `etag`, so a cache cannot revalidate them
into the current version; a 304 carries the `etag`, `cache-control`, `content-type` and `x-og-cache` and is sent only once the current card is in hand. The request's `?v=` only picks the header; it is never a key, and the version is always derived
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

## Who counts as an editor

Draft text and draft site data go only to users of the admin user collection (`admin.user`, normally `users`), or of
the auth collections named in the `editors` option. A user of any other auth collection (customers, say) is never
an editor, and `site()` is told which user it is serving (`site({ payload, draft: true, user })`).

## Per-document share card fields

Set `fields: { enabled: true }` on `ogImagePlugin` and each target's collection gets a group `og` with three
fields: `mode`, `headline` and `subtitle`. It is off by default, and with it off the schema is exactly what it
was without the option. The plugin only adds fields: it never adds a collection, an endpoint or a job.

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
  (it has a `filename`, or a `url` and a `mimeType`) is reduced to its plain id or dropped; the known upload fields are
  read again with the user's own access, never taken from the request. The body is capped at 256 KB even without a length;
- the card is drawn through the render gate and returned as a PNG with `Cache-Control: no-store`. It never touches the
  memo or the store. A full gate answers 503 with `Retry-After`.

The picture is always the card `generated` would draw, whatever the mode, so an editor sees what Off or Custom would fall
back to. The warnings travel in the `x-og-warnings` header (ASCII JSON).

### Force new image

The group holds a hidden number `og.nonce` (default 0), changed by the preview's "Force new image" button, which adds 1.
It is part of the card's version, so a new value is a new card URL: LinkedIn, Facebook and Telegram fetch the card again.
A nonce of 0 (or none) is exactly the 0.1 version, so no existing URL changes. The field is a column: run
`payload migrate:create` after upgrading, as for the rest of the group.

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
collection's folder. A transparent hero is flattened onto `heroBackground` (`#rgb` or `#rrggbb`, default white; names and alpha forms are refused at start-up) before it is cut. It is part of the version of a card with a hero, so changing it gives new URLs. Remote heroes (`allowedImageHosts`) are fetched over https on the default port with a dedicated
agent (never an environment proxy), from a vetted public address only (IANA special-purpose ranges are refused), with no
redirect.

## Where the cards live

`store: { dir }` must be an absolute path to a volume that only the app writes, with room for the cap
(default 2000 files, 100 MiB). In Docker, mount a named volume there and keep the folder out of the build
context (`.dockerignore`: the same path). Without a writable volume the store switches itself off with one
`store_disabled` event and cards stay in memory only. [operations](operations.md) has the runbook.

`store: { memory: true }` keeps cards in memory only (tests, serverless).

## Crawlers

Link-preview crawlers need an absolute https image URL, no redirect, a 1200x630 image, and `Allow` for the
card path in `robots.txt`. They send HEAD first, so the card route answers HEAD. See
[crawlers](crawlers.md).

## HEAD for Payload REST

Payload's REST router looks endpoints up by method, so a HEAD to `/api/media/file/...` answers 404 and
LinkedIn drops an editor-chosen image. In the generated `app/(payload)/api/[...slug]/route.ts`:

```ts
import { withHead } from 'payload-og-image/next'

export const HEAD = withHead(GET)
```

`withHead` is a stopgap: remove it when Payload REST answers HEAD for GET endpoints. Do not use it on the card
route, where `HEAD = GET` is enough.

## Testing your site

`payload-og-image/testing` exports `installTestRuntime` and `ogKit`. The kit calls your real page, metadata and
route modules and checks the failures this plugin exists to prevent: a draft cached, a stale version served as
immutable, a client-chosen version stored, a HEAD that is not GET's twin, a card route whose path no config
declares, a template that draws something the URL does not cover. The test runtime runs the production draft logic over an in-memory drafts collection, so give `draftNeverCached` a
document that exists only as a draft (`draftOnly`): the public and a draft-mode visitor without an editor must get a 404,
and an editor's credential (a user of the first editor collection) the draft. `routesMatchPaths` reads your route files
and counts one only when the `GET` it exports is the one `createOgRoute()` returned; a mention in a comment or a string
does not count. `everyRouteHasOwnCard` requires an `https` image URL, as the crawlers document it; pass `allowHttpImages: true` for a site that is only ever served on plain HTTP, such as a local dev server. See [`dev/tests/og.spec.ts`](https://github.com/anatolykoptev/payload-og-image/blob/main/dev/tests/og.spec.ts).

`og-parity --old <dir> --new <dir>` compares two directories of rendered cards (`<card>.png` plus
`<card>.layout.json`) pixel for pixel, for a migration that must not change a card.

## Not implemented

A force-new-image nonce, a stats endpoint,
pre-warming, locales, JPEG/WebP output, size variants, local emoji, another renderer, object-storage stores.
The version and URL formats already reserve the slots, so adding them later changes no existing URL.

## Threat model

The card store directory (`store: { dir }`) must be private to the application user and live on a volume only
the application writes. Anyone who can write that directory can already change the application, so the store
defends against corrupt or foreign files appearing in it (torn writes, symlinks, odd file types), not against a
local attacker racing it with directory swaps after boot.
