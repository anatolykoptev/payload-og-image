# Pitfalls: symptom, cause, fix

Sources are the package docs (`docs/reference.md`, `docs/crawlers.md`, `docs/operations.md`) unless a line names another. The Next 16 streaming item is from the Next docs, not from this package.

## Nothing is advertised, or the URL 404s

- **Missing or misplaced route file.** The page advertises a card URL that the app does not serve. The route folder must follow the target `path` (`/og/:kind/:slug/card.png` becomes `app/(frontend)/og/[kind]/[slug]/card.png/route.ts`; a `.jpg` path becomes `card.jpg/`). It must export `GET` from `createOgRoute()` and `HEAD = GET`. Fix by adding the file; prove with `kit.routesMatchPaths`.
- **Plugin not registered**: the route answers 503 (`render_error`). Outside production `ogMetadata` throws; in production it emits `render_error` and returns `{}`. With `disabled: true` every card route answers 404 and no metadata is produced.
- **No `serverURL`**: start-up error; card URLs are absolute.
- **A collection with drafts and no public read of published documents.** Reads use `overrideAccess: false`, so the card 404s. Use `read: ({ req: { user } }) => (user ? true : { _status: { equals: 'published' } })`.
- **Page passes `doc: null`**: `ogMetadata` returns `{}`; fine for a not-found page.

## HEAD

- LinkedIn HEADs an `og:image` first and drops an image whose HEAD is 404. The card route must export `HEAD = GET`.
- Payload's REST router answers 404 to HEAD, so an editor-chosen upload at `/api/media/file/...` loses its preview. In `app/(payload)/api/[...slug]/route.ts` add `import { withHead } from 'payload-og-image/next'` and `export const HEAD = withHead(GET)`. Never on the card route. Prove with `kit.restHeadParity`. `withHead` is a stopgap; drop it when Payload answers HEAD.

## Next 16 streams metadata into `<body>` for some bots

Cause (Next docs, `generateMetadata` "Streaming metadata" and `htmlLimitedBots`): Next sends the page without waiting for `generateMetadata` and appends the metadata tags to `<body>`. Crawlers that do not run JavaScript need them in `<head>`, so Next detects HTML-limited bots by user agent and blocks until metadata resolves. The plugin docs do not mention this; the rule is Next's.

In Next 16.4.6 the default list (`dist/shared/lib/router/utils/html-bots.js`) names, among others, facebookexternalhit, Twitterbot, LinkedInBot, Slackbot, Discordbot, WhatsApp, applebot, Bingbot and Google crawlers, and it does not name Telegram. A preview bot that is not on the list gets the metadata in `<body>` and shows no card. A custom `htmlLimitedBots` value **replaces** the default list.

Fix, the simple safe choice: in `next.config`, `htmlLimitedBots: /.*/`. The Next docs (`generateMetadata` "Streaming metadata" and `htmlLimitedBots` "Disabling") give this as the way to fully disable streaming metadata, so every request gets metadata in `<head>`; the cost is that the response starts after `generateMetadata` resolves (Next warns of longer response times and says streaming metadata only helps TTFB and LCP). Verify: `curl -s -A 'TelegramBot' <page>` has the `og:image` inside `<head>`. Read the installed Next version's own docs: the list changes between releases.

## `og:image` must stay a single tag

`ogMetadata` returns one image in `openGraph.images` and one in `twitter.images`. A second `og:image` tag (a manual `openGraph.images`, a file-convention `opengraph-image`, a size variant) buys nothing and breaks Discord. Almost every crawler takes the first `og:image` and ignores the rest, and Discord turns two or more `og:image` tags into a gallery of all of them, which breaks the single preview (`docs/reference.md`, "Why `og:image` stays a single wide image"). `ogMetadata` never lists a variant and has no option to. Rules:

- Do not add images next to `ogMetadata`. A default in the layout is fine because mode `off` or a missing card returns `{}` and lets it apply.
- Next merges metadata **shallowly**: a page returning `openGraph` replaces the layout's whole `openGraph` (title, siteName, locale). Spread the layout's values into the page's `openGraph` if the page must keep them: `const og = await ogMetadata(...); return { openGraph: { ...base, ...og.openGraph }, twitter: { ...baseTwitter, ...og.twitter } }`.
- Check with `curl -s <page> | grep -o '<meta[^>]*og:image[^>]*>'` and count.

## Format

- JPEG is read by every crawler checked; WebP is documented for X and Discord only, LinkedIn and Facebook publish no list, Telegram is reported to drop WebP (`docs/crawlers.md`). Photo card: JPEG. Do not pick WebP for byte savings (16 to 20 percent).
- A `.png` path with a JPEG or WebP format (or `.jpg` with PNG) is refused at start-up. No alpha in JPEG/WebP: paint the template ground.
- A JPEG card still palette-cuts its hero on 0.6.0 unless `palette: { hero: false }` (issue #71).

## Stale previews

- **A cached page keeps the old `?v`.** `ogMetadata` runs when Next renders. A page with `generateStaticParams` or other caching serves the old `og:image` after an edit. Fix: `export const dynamic = 'force-dynamic'` on the page, or tag the read with `ogTag(collection, key)` and `OG_SITE_TAG` and call `revalidateTag(tag, { expire: 0 })` from `afterChange` and `afterDelete` (import `revalidateTag` from `next/cache.js`; skip when `req.context.disableRevalidate`). `{ expire: 0 }`, not `'max'`. Full recipe, including the hot-page transaction window: `docs/reference.md` "Pages that Next caches".
- **A platform still shows the old image.** Compare the page's `v` with the card's `etag`; they must be equal. If yes, ask the platform to re-scrape (LinkedIn Post Inspector, Facebook Sharing Debugger). Telegram and WhatsApp refetch behaviour is unverified: a changed URL is the only dependable refresh (admin "Force new image").
- **A card changed without its URL changing**: the template draws something that is not in its props (site data read from elsewhere, a constant edited without `revision`). Move it into `props`; prove with `kit.versionCoversEverythingDrawn`.
- A CDN in front of the route must keep the query string in its cache key.
- `robots.txt` must `Allow: /og/`; never `Disallow` the card path.

## Store and runtime

- A store `dir` that is not a mounted volume gives no event; cards vanish on container recreate. Confirm the mount (`df` on the path) and the user's write access. `store_disabled` means the store switched itself off (unwritable, symlink, low space); cards keep working from memory.
- Keep `fontkit` out of the Next bundle: `serverExternalPackages: ['fontkit']` (it reads data files relative to its own location, which fails when bundled).
- `output: 'standalone'` needs the fonts traced: `outputFileTracingIncludes: { '/**': ['./assets/fonts/**'] }`.
- Edge and serverless runtimes are unsupported; use `store: { memory: true }` and expect cold draws.
- Several app processes share a disk store; `site()` and the memo are per process, so a site-global edit lags up to 60 s on other workers.
- 503 with `Retry-After: 5` under a crawl: the render queue is full; raise `gate.queue` or warm cards after deploy.
- `content-length` is absent on Next 16 card answers (chunked); crawlers cope.

## Payload 3 versus 4

- Payload 4 changes the Local API default to `overrideAccess: false`. Your code that the plugin calls (`site()`, `props`, `related` follow-ups) must say what it means: `payload.findGlobal({ slug, overrideAccess: true })` for trusted site data identical for every visitor; never `true` for per-document or private data. The plugin's own calls state `overrideAccess: false` already.
- Payload 4: run `payload generate:importmap`, use the Node version Payload 4 requires, expect extra authorship columns (the site's migration). The plugin range names a beta floor (`^4.0.0-beta.12`).
- MCP: plugin-mcp 3 uses `payload-og-image/mcp/v3` (zod), plugin-mcp 4 uses `payload-og-image/mcp`.

## Next 16 params

A page component's `params` arrive percent-encoded; `generateMetadata` and route-handler params arrive decoded. Decode in the page component only. The card route never decodes.

## Tests

- Specs that boot Payload need a Node environment (jsdom realm issue, #70). Vitest's 5 s default is too short for kit calls: `{ timeout: 60_000 }`.
- `routesMatchPaths` needs `typescript` installed; without it, it throws and says what to add.
