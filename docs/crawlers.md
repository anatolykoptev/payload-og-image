# Link-preview crawlers

What a share card has to satisfy, and which parts are checked by this package. "Documented" means the
platform's own guidance says it; "observed" means we saw it on a production site; "unverified" means we have
not tested it.

| Requirement                                                     | Status                                                                             | Where it is handled                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| An absolute `https` image URL in `og:image` and `twitter:image` | documented (Facebook, LinkedIn, X)                                                 | `ogMetadata` builds it from the Payload `serverURL`; the kit's `everyRouteHasOwnCard` checks it |
| 1200x630 (1.91:1), at most a few hundred KB                     | documented; the size budget is observed                                            | templates default to 1200x630; the kit's `sizeBudget`                                           |
| `og:image:width`, `height`, `type` and `alt` present            | documented (LinkedIn reads the size; without it the first share can show no image) | `ogMetadata`; an upload with no size on record is never advertised                              |
| No redirect between the advertised URL and the bytes            | documented                                                                         | the card route answers 200 at the advertised URL                                                |
| HEAD answered like GET                                          | observed: LinkedInBot HEADs first and drops an image whose HEAD is 404             | `HEAD = GET` on the card route; the kit's `headParity`                                          |
| `Allow` for the card path in `robots.txt`                       | documented                                                                         | yours: do not `Disallow` `/og/`                                                                 |
| A new URL when the image changes                                | documented (platforms cache by full URL)                                           | the `?v=` version                                                                               |
| X accepts JPEG, PNG, WebP, GIF in a large card, never SVG       | documented                                                                         | eligibility rules                                                                               |
| A fast first fetch (a crawler gives up on a slow one)           | observed                                                                           | the render queue and the store; `crawlerEvents` shows the share of cold renders                 |
| Telegram and WhatsApp refetch behaviour                         | unverified                                                                         | a change of the URL is the only dependable way to refresh a card there                          |
| Facebook scrapes both HEAD and GET and caches for about 30 days | observed                                                                           | re-scrape with the Sharing Debugger after a change                                              |

Turn on `crawlerEvents: { sample: 0.1 }` to learn which crawlers actually hit your cards and how often a
first fetch is a cold render.
