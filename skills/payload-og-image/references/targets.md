# Targets, heroes, formats, store

Source: `src/template.ts` (`Target`, `defineTarget`, `StaticCard`), `src/plugin/index.ts` (`OgImagePluginOptions`), `docs/reference.md`.

## A target

```ts
defineTarget({
  path: '/og/:kind/:slug/card.jpg', // pathname only, starts with "/", must hold :slug or :id; ?/# are refused
  kind: 'places', // optional: defaults to the key in `targets`; one URL-safe segment
  collection: 'places', // optional: defaults to the target's key
  slugField: 'slug', // the field holding the URL key; a doc without it is keyed by its id
  template: 'place', // a template id, or (args) => id to choose per document
  props: ({ doc, site, related, overrides }) => ({ title: doc.title, site: site.name }),
  hero: ({ doc }) => doc.heroImage, // an upload (or null/undefined for none)
  heroCollection: 'media', // the upload collection; optional with a single upload collection
  format: 'jpeg', // wins over the plugin's format
  alt: ({ props }) => props.title, // og:image:alt; not drawn, so not in the URL
  share: ({ doc }) => [doc.meta?.image], // uploads shared as they are before a card is generated
  select: { title: true }, // fields to read; omit to read all
})
```

`defineTarget` throws at once for a bad path, a missing `:slug`/`:id`, a bad `kind`, a `format` that contradicts the path extension, a non-function `alt`.

- **`props`** return plain JSON (strings, finite numbers, booleans, null, arrays, plain objects, `Date` as ISO string). A `Map`, class instance or function throws, naming the field. This is the only way data reaches a card.
- **`related(collection, id)`**: published-only, access-respecting; `null` for a missing, unpublished or forbidden document. Documents are read at depth 0, so relations arrive as bare ids; use `related` for authors, categories and so on.
- **`overrides`**: `{ headline?, subtitle? }` from the document's `og` group, trimmed and absent when empty. They change a card only if `props` reads them.
- **`hero`**: the plugin loads the file by id with the visitor's access, from the `heroCollection` folder only. A transparent hero keeps its transparency unless `heroBackground` (`#rgb`/`#rrggbb`, on target, template or plugin; target wins) flattens it. A missing hero file downgrades the card (drawn without it, served 5 minutes, never stored).
- **A hero that is a bare id**: a `hasMany` upload field is not populated (depth 0), so `hero: ({ doc }) => doc.photos?.[0]` is an id. The plugin reads a bare id by id with the visitor's access, from `heroCollection`, else the site's only upload collection. With several upload collections and no `heroCollection` it stays no hero: name the collection.
- **`images`**: named upload lists besides the hero, `images: ({ doc }) => ({ stack: doc.photos, logo: doc.logo })` (each a list, one upload or nothing; an entry is an id, or an object whose `id` is used). `imageCollections: { logo: 'logos' }` names a name's upload collection (default `heroCollection`, else the only one; several and none named throws). Each entry is re-read by id with the visitor's access, so a forbidden or missing upload is left out and an object is never trusted. At most 8 in all, in the order given. They are never flattened (a transparent logo stays transparent) and are part of the version (id and `updatedAt`); a card with none hashes as before. The template declares every name in `imageBoxes` and draws `ctx.images[name]`. A file that cannot be prepared downgrades the card like a hero.
- **Remote heroes** are refused unless the host is in `allowedImageHosts` (https only, default port, no redirect, public addresses only). Default: nothing is fetched at render time.

## Which image a page advertises (precedence)

1. The editor's image at `seoImage.path` (for example `meta.image`), unless it is the hero itself or `seoImage.isDeliberate` says it is a placeholder.
2. Another eligible image from the target's `share`.
3. The generated card.

Eligible: width, height and MIME type on record, and JPEG, PNG, WebP or GIF; never SVG. A card whose `required` fails (empty title) advertises nothing. The per-document `og.mode` changes this order (see `fields-and-mcp.md`). Set `seoImage: { path: 'meta.image' }` when the site has an SEO plugin; without it the generated card is always used.

## Format

```ts
ogImagePlugin({
  format: 'jpeg', // 'png' (default) | 'jpeg' | 'webp'; the target's own format wins
  jpeg: { quality: 82 }, // 1 to 100, mozjpeg (default 82)
  webp: { quality: 80 },
  palette: { card: false, hero: false }, // card: PNG only; hero: every format. false = truecolour, or a colour count 2 to 256
})
```

- Photo-first card: `jpeg` and a `.jpg` path. With the default palette a photo posterises; truecolour PNG of a photo is over a megabyte. While issue #71 is open, a JPEG card still cuts its hero to a 256-colour palette (`palette.hero` applies to every format, `palette.card` only to PNG); set `palette: { hero: false }` for photographic heroes.
- Flat text card: keep PNG; it is the smallest and the default.
- JPEG and WebP have no alpha: transparency is flattened onto `heroBackground` (white by default). Paint the template's own background.
- Changing format, quality or palette gives new URLs for the affected cards by design.
- Measure real cards with `ogKit(rt).sizeBudget` (crawlers tolerate a few hundred KB).

## Static cards (pages that are not documents)

```ts
static: {
  home: { path: '/og/:kind/:slug/card.png', kind: 'static', slug: 'home', template: 'post', props: ({ site }) => ({ label: '', title: site.name, site: site.name }) },
}
```

Page side: `ogMetadata({ config, static: 'home' })`: the argument is the key in the plugin's `static` map. The card route serves it at the path with `:kind` = `static` and `:slug` = `home`. A static card's `kind` must not equal any target's kind (a target's kind defaults to its key in `targets`, so a `pages` kind collides with a `pages` target): start-up refuses it with a "collides with a target kind" error.

## Size variants (0.7.0 and later)

For the schema.org `image` of a page, not for `og:image`. Google asks for Article images in three ratios (16:9, 4:3, 1:1); the page's `og:image` stays one wide image. Source: `docs/reference.md` "Size variants".

```ts
posts: defineTarget({
  path: '/og/:kind/:slug/card.png',
  template: 'post', // 1200x630
  props: ({ doc }) => ({ title: doc.title }),
  variants: {
    square: { path: '/og/:kind/:slug/square.png', template: 'post-square' }, // a template with size 1080x1080
    '4x3': { path: '/og/:kind/:slug/4x3.png', template: 'post-4x3' },
  },
})
```

- A variant has its own `path` and `template` (the template sets the size). It shares the target's collection, `props()`, hero, format and slug field, and is served as a hidden target `posts~square` of kind `posts-square`, with its own URL, version and etag. Names are `[a-z0-9-]+`; a taken kind or target name, a bad path or an unknown template is refused at start-up.
- **Add a route file for each variant path**, like the target's own. Or pin a route to the hidden target: `createOgRoute({ config, target: 'posts~square' })` takes no `:kind` in its params, so give that variant a `path` without `:kind` (for example `/og/posts/:slug/square.png`, route folder `app/og/posts/[slug]/square.png/route.ts`), or `kit.routesMatchPaths` flags the route. `kit.routesMatchPaths` wants a route file for each variant path.
- A variant always draws its template: an editor's own share image (`seoImage`, `share`, mode `custom`) is never used for it. `og.mode: off` hides every size.
- `ogImages({ config, target, doc, variants? })` from `payload-og-image/next` returns `{ url, width, height, variant }[]`: the wide image first (`variant: null`), then the variants in declaration order (or in the order of `variants: ['square']`). A blank size is left out; an undeclared name throws (production: an event and `[]`).

```tsx
const images = await ogImages({ config, target: 'posts', doc })
const jsonLd = { '@context': 'https://schema.org', '@type': 'Article', headline: doc.title, image: images.map((i) => i.url) }
// <script type="application/ld+json">{JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
```

Keep `ogMetadata` as it is. **`og:image` stays a single tag**: almost every crawler takes the first `og:image` and ignores the rest, and Discord turns two or more into a gallery, which breaks the single preview. Variants live in JSON-LD only.

## Store, gate, cache

- `store: { dir, maxFiles?, maxBytes? }` (defaults 2000 files, 100 MiB) or `{ memory: true }`. `dir` is absolute, owned by the app, a volume that survives container recreate, listed in `.dockerignore`. Not a symlink. Edge and serverless runtimes are unsupported (use `memory: true`, untested).
- `gate: { concurrency?, queue? }`: render queue (default 2 concurrent, 50 waiting); a full queue answers 503 `Retry-After: 5`, never cached.
- `memo`, `admission`: memory and database-read bounds; defaults are fine.
- `onEvent(e)` receives `render`, `hit_memo`, `hit_store`, `shed`, `store_disabled`, `render_error`, `glyph_missing` and more (`docs/operations.md`). Alert on `store_disabled` and `render_error`. `crawlerEvents: { sample: 0.1 }` shows which crawlers hit the cards.
- `editors: ['users']`: auth collections whose users count as editors (draft text in draft mode). Default is the admin user collection; customers never are.
- `disabled: true`: every card route answers 404 and no metadata is produced.

## Cache headers (what the route answers)

| Answer                                          | `Cache-Control`                                     |
| ----------------------------------------------- | --------------------------------------------------- |
| `?v=` equals the current version                | `public, max-age=31536000, immutable, no-transform` |
| any other or missing `v` (current bytes served) | `public, max-age=3600, no-transform`                |
| hero unreadable, or fallback card               | `public, max-age=300, no-transform`                 |
| unknown document, shed 503, draft mode          | `no-store`                                          |

`x-og-cache` says `render`, `memo`, `store`, `draft`, `downgraded` or `fallback`. A CDN in front must keep the query string in its cache key.
