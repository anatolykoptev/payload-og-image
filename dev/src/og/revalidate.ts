import { revalidateTag } from 'next/cache.js'
import type { CollectionAfterChangeHook, GlobalAfterChangeHook } from 'payload'
import { OG_SITE_TAG, ogTag } from 'payload-og-image/next'

/** Expire at once. `'max'` serves the stale page to the next visitor, and a crawler is that visitor. */
const NOW = { expire: 0 }

/**
 * Saving a post refreshes the cached pages that advertise its card. `context.disableRevalidate` is for scripts that run outside
 * Next (a seed), where `revalidateTag` has no cache to talk to. A document that was never published has no public page to refresh.
 */
export const revalidatePost: CollectionAfterChangeHook = ({ doc, previousDoc, req }) => {
  if (req.context.disableRevalidate) return doc
  if (doc._status !== 'published' && previousDoc?._status !== 'published') return doc
  for (const slug of new Set([doc.slug, previousDoc?.slug])) if (slug) revalidateTag(ogTag('posts', slug), NOW)
  return doc
}

/** A site global is drawn on every card (`site()`): refresh every page tagged with the site tag. */
export const revalidateSite: GlobalAfterChangeHook = ({ doc, req }) => {
  if (!req.context.disableRevalidate) revalidateTag(OG_SITE_TAG, NOW)
  return doc
}
