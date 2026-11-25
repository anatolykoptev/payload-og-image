import { createHash } from 'node:crypto'

/** Next's longest cache tag (`NEXT_CACHE_TAG_MAX_LENGTH`): `unstable_cache` drops a longer one with a console warning and `revalidateTag` silently matches nothing. */
const MAX_TAG_LENGTH = 256

/**
 * The names a page and a Payload hook agree on, so that saving a document refreshes the pages that advertise its card.
 * A page Next keeps in its cache (no `force-dynamic`, no `revalidate = 0`) holds the `og:image` it was first rendered with,
 * `?v` included: tag what it reads with `ogTag(collection, key)` and call `revalidateTag` with the same tag from `afterChange`.
 * `key` is anything both sides know: the document's slug or id.
 *
 * Next drops a tag longer than 256 characters, so the page would then never be revalidated. A name that long (a very long slug)
 * is shortened to a hash of the collection and key: the same input always gives the same tag, and every shorter tag is returned
 * as it is. A raw key that looks like a shortened tag (`~` and 32 hex digits) can equal one; the only effect is that a save
 * refreshes one more page than needed.
 */
export const ogTag = (collection: string, key: string | number): string => {
  const tag = `og:${collection}:${key}`
  if (tag.length <= MAX_TAG_LENGTH) return tag
  const hash = `~${createHash('sha256')
    .update(JSON.stringify([collection, String(key)]))
    .digest('hex')
    .slice(0, 32)}`
  const scoped = `og:${collection}:${hash}`
  return scoped.length <= MAX_TAG_LENGTH ? scoped : `og:${hash}`
}

/** The tag of a page whose card draws site data (`site()`): revalidate it when a site global saves. */
export const OG_SITE_TAG = 'og:site'
