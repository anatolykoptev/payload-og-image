# Operations

## Events

Pass `onEvent(e)` to receive every event. Without it, one line per event goes to `console.warn`:
`[payload-og] event=render kind=posts slug=a v=0aa023e2fb5b ms=68 bytes=8266`. Cache hits are sampled (the first,
then every 100th); values that came from a request are printed as plain ASCII.

| Event                   | Meaning                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `hit_memo`, `hit_store` | a card answered from memory or from the disk store                                                                          |
| `render`                | a card was drawn (`ms`, `bytes`)                                                                                            |
| `shed`                  | the render queue was full: 503 with `Retry-After: 5`                                                                        |
| `store_disabled`        | the disk store switched itself off (unwritable, a symlinked root, a permanent error)                                        |
| `store_write_skipped`   | one write was skipped (low free space at boot, a transient error, bytes that were not a whole PNG, JPEG or WebP)            |
| `store_corrupt`         | a stored file failed its checks and was removed                                                                             |
| `downgraded`            | the hero could not be read: the card was drawn without it and served for 5 minutes                                          |
| `render_error`          | a card could not be drawn, or a failure happened before one existed                                                         |
| `glyph_missing`         | characters no font draws were removed from a card's text or from what its template draws                                    |
| `svg_rejected`          | an SVG logo or hero gave no picture: `detail.reason` is `refused` (the file), `busy`, `timeout`, `memory` or `worker-error` |
| `draft`                 | a draft-mode request was drawn, uncached                                                                                    |
| `not_found`             | an unknown route, kind or slug                                                                                              |
| `crawler`               | a sampled card request (`crawlerEvents`): `ua_family`, `method`, `status`, `cache`                                          |

Alert on `store_disabled` and on `render_error` above zero per hour, and on `shed` above about 50 per hour.

## Playbooks

**503s under a crawl.** The queue (`gate.queue`, default 50 behind 2 concurrent renders) filled up. Raise
`gate.queue` if the box has the memory, or pre-warm by requesting the new cards after a deploy. A shed answer is
never cached, so crawlers retry.

**A platform still shows the old image.** Compare the `v` in the page's `og:image` with the `etag` the card
route answers for the same URL (they must be equal), then ask the platform to re-scrape (LinkedIn Post
Inspector, Facebook Sharing Debugger). A platform caches by full URL, so a card that changed has a new URL;
if it did not change when you expected, something the template draws is not in its props. If the page itself still
advertises the old `v`, it is a cached page: see [reference](reference.md#pages-that-next-caches). To give a card a new
URL on purpose, use the admin's "Force new image" (or bump the template's `revision` for every card).

**The store is writable but not on the volume.** The store checks that its directory exists and is writable. It cannot tell a mounted volume from a folder inside the container, so a missing mount gives no `store_disabled` event: cards then vanish with every container recreate. Confirm the mount in your compose file (and `df` on the path) when you deploy.

**The store is off (`store_disabled`).** Cards keep working from memory but are redrawn after every restart.
Check that the volume is mounted at `store.dir`, that the app user owns it and can write, that it is not a
symlink, and that it has free space. The event's `detail` names the errno. Restart after fixing it.

**Cards look wrong after a font or design change.** Change `revision` (design) or the font file (the face
digest changes by itself). Old files are pruned: the newest two versions of a page are kept.

**A card shows the brand fallback.** A render threw: look for `render_error` with the message. The fallback is
served for 5 minutes and never stored.

## What the store does

One file per card version, `<page id>-<version>.png` (`.jpg` for a JPEG card, `.webp` for a WebP one), written to a temp file, fsynced, renamed, and the
directory fsynced. A read checks the whole file (a PNG: every chunk's CRC, the image data inflates to the size the
header promises; a JPEG or WebP: its container structure, then a full decode); a torn file is deleted and drawn again. Only files that match the store's own two name
patterns are ever counted or deleted. Pruning runs off the request path at most once a minute and keeps the
newest two versions of a page, then trims oldest-first to `maxFiles` and `maxBytes`.

## Several app processes

The cached `site()` (60 seconds) and the memo are per process. Saving a site global drops the cache of the
process that handled the save; other workers show the old value until their 60 seconds are up. The card URL
changes when a worker reads the new value, so the worst case is a card that lags a minute behind a site-wide
edit. The disk store is shared between processes that mount the same directory.

## Response framing (`content-length`)

The handler sets `content-length` on every card answer that has a body. Next 16 drops it: measured on the dev app with
Next 16.4.6, both `next dev` and a production build under `next start` answer a card GET with
`transfer-encoding: chunked` and a HEAD with neither header, with or without `accept-encoding: identity`. Next's route
response writer strips `content-length`, `content-encoding` and `transfer-encoding` from a route handler's response, so
nothing the handler can set changes it. Crawlers read chunked bodies; if you need a length on the wire, let a reverse
proxy buffer the response. Re-measure after a Next upgrade: CI does it on every push (`node scripts/probe-dev-server.mjs` builds the dev app, serves it with `next start` and checks a card's GET and HEAD headers, a stale `?v`, an unknown slug, HEAD on a REST upload and a cached page's `og:image` after an edit), and `curl -I` a card shows the framing by hand.
