/**
 * The names a page and a Payload hook agree on, so that saving a document refreshes the pages that advertise its card.
 * A page Next keeps in its cache (no `force-dynamic`, no `revalidate = 0`) holds the `og:image` it was first rendered with,
 * `?v` included: tag what it reads with `ogTag(collection, key)` and call `revalidateTag` with the same tag from `afterChange`.
 * `key` is anything both sides know: the document's slug or id.
 */
export const ogTag = (collection: string, key: string | number): string => `og:${collection}:${key}`

/** The tag of a page whose card draws site data (`site()`): revalidate it when a site global saves. */
export const OG_SITE_TAG = 'og:site'
