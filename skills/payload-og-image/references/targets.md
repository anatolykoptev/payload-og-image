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
- **`overrides`**: `{ headline?, subtitle?, label?, accent? }` from the document's `og` group, trimmed and absent when empty. They change a card only if `props` reads them.
- **`hero`**: only the id the resolver names counts: the plugin reads the upload again by id with the visitor's access (published only), then loads the file from the `heroCollection` folder only. An upload object a resolver built by hand is never drawn as it is. A transparent hero keeps its transparency unless `heroBackground` (`#rgb`/`#rrggbb`, on target, template or plugin; target wins) flattens it. A missing hero file downgrades the card (drawn without it, served 5 minutes, never stored).
- **A hero that is a bare id**: a `hasMany` upload field is not populated (depth 0), so `hero: ({ doc }) => doc.photos?.[0]` is an id. The plugin reads a bare id by id with the visitor's access, from `heroCollection`, else the site's only upload collection. With several upload collections and no `heroCollection` it stays no hero: name the collection.
- **`uploadFields`**: the document's upload fields (dotted paths) the target draws, for `hero`, `images`, `share` and the editor's share image. Only these are read (one batched read per upload collection) and arrive in `doc` as the upload; every other upload field arrives as its bare id. The collection of each comes from the field's `relationTo`. Omit it to read every single-valued upload field. The presets set it. Details: `docs/reference.md`, Related documents.
- **`images`**: named upload lists besides the hero, `images: ({ doc }) => ({ stack: doc.photos, logo: doc.logo })` (each a list, one upload or nothing; an entry is an id, or an object whose `id` is used). `imageCollections: { logo: 'logos' }` names a name's upload collection (default `heroCollection`, else the only one; several and none named throws). Each entry is re-read by id with the visitor's access, so a forbidden or missing upload is left out and an object is never trusted. At most 8 in all, in the order given. They are never flattened (a transparent logo stays transparent) and are part of the version (id and `updatedAt`); a card with none hashes as before. The template declares every name in `imageBoxes` and draws `ctx.images[name]`. A file that cannot be prepared downgrades the card like a hero.
- **Remote heroes** are refused unless the host is in `allowedImageHosts` (https only, default port, no redirect, public addresses only). Default: nothing is fetched at render time.

## Which image a page advertises

The order (the editor's image at `seoImage.path`, then `share`, then the generated card), what makes an image eligible, and the effect of `og.mode` are in `docs/reference.md`, "Which image a page gets" (and `fields-and-mcp.md` for the mode). Set `seoImage: { path: 'meta.image' }` when the site has an SEO plugin; without it the generated card is always used (the zero-config presets honour `meta.image` by themselves).

## Format

```ts
ogImagePlugin({
  format: 'jpeg', // 'png' (default) | 'jpeg' | 'webp'; the target's own format wins
  jpeg: { quality: 82 }, // 1 to 100, mozjpeg (default 82)
  webp: { quality: 80 },
  palette: { card: false, hero: false }, // card: PNG only; hero: every format. false = truecolour, or a colour count 2 to 256
})
```

- Photo-first card: `jpeg` and a `.jpg` path. With the default palette a photo posterises; truecolour PNG of a photo is over a megabyte. A JPEG or WebP card draws its hero in truecolour by default; `palette.hero` (a number) cuts it anyway, `palette.card` applies to PNG only.
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

## Photo set for JSON-LD and Discover

A target with a `hero` (or `photo`, an upload resolver of its own; `photo: false` opts out) has clean crops of that photograph, served beside the card as `photo-16x9.jpg`, `photo-4x3.jpg` and `photo-1x1.jpg`: `ogPhotoImages({ config, target, doc })` lists them for the page's JSON-LD, `ogPrimaryImageOfPage(images)` gives the 16:9 as an `ImageObject`, `withLargeImagePreview(robots)` adds `max-image-preview:large` to the page's robots without dropping a `noindex`. Never enlarged, none under 600 px wide, never the editor's share image, none at all without a hero; needs a card path ending in `.:ext` (the `[file]` route). Rules, versions and the JSON-LD example: `docs/reference.md`, "Photo set for structured data and Discover".

## Size variants (0.7.0 and later)

Other sizes of the CARD (not for structured data, where Google asks for no logo or text: use the photo set above). Declare `variants: { square: { path, template } }` on a target and read every size with `ogImages({ config, target, doc })`. Full rules, naming and why `og:image` stays single: `docs/reference.md`, "Size variants".

- **Add a route file for each variant path**, like the target's own. Or pin a route to the hidden target: `createOgRoute({ config, target: 'posts~square' })` takes no `:kind` in its params, so give that variant a `path` without `:kind` (for example `/og/posts/:slug/square.png`, route folder `app/og/posts/[slug]/square.png/route.ts`), or `kit.routesMatchPaths` flags the route.

## Store, gate, cache

- `store: { dir, maxFiles?, maxBytes? }` (defaults 2000 files, 100 MiB) or `{ memory: true }`. `dir` is absolute, owned by the app, a volume that survives container recreate, listed in `.dockerignore`. Not a symlink. Edge and serverless runtimes are unsupported (use `memory: true`, untested).
- `gate: { concurrency?, queue? }`: render queue (default 2 concurrent, 50 waiting); a full queue answers 503 `Retry-After: 5`, never cached.
- `memo`, `admission`: memory and database-read bounds; defaults are fine.
- `onEvent(e)` receives `render`, `hit_memo`, `hit_store`, `shed`, `store_disabled`, `render_error`, `glyph_missing` and more (`docs/operations.md`). Alert on `store_disabled` and `render_error`. `crawlerEvents: { sample: 0.1 }` shows which crawlers hit the cards.
- `editors: ['users']`: auth collections whose users count as editors (draft text in draft mode). Default is the admin user collection; customers never are.
- `disabled: true`: every card route answers 404 and no metadata is produced.

## Cache headers

The table of what the route answers (`Cache-Control` per case, `etag`, `x-og-cache`) lives in `docs/reference.md`, "Cache headers". A CDN in front must keep the query string in its cache key.
