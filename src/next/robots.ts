import type { Metadata } from 'next'

/** The object form of Next's `robots` metadata. */
export type OgRobots = Exclude<Metadata['robots'], string | null | undefined>

const HAS_PREVIEW = /(^|[\s,])max-image-preview\s*:/i

/**
 * `robots` with `max-image-preview:large` added, which Google Discover (and the large image in Search) needs, and everything else exactly as given.
 *
 * In Next a page's `robots` replaces the layout's whole object, so a page that sets only this would drop a site's `noindex`: pass the page's own robots
 * (or the one object the layout and pages share) and use the answer. Nothing is ever removed or turned on beyond the preview size: `index: false`, `noindex`,
 * `follow`, `nosnippet`, `googleBot` and every other member survive, and a `max-image-preview` the site already chose (`none`, `standard`) is its decision and stays.
 * A string (`'noindex, nofollow'`) stays a string; no robots at all (undefined or null) gives the default `index, follow` plus the preview size, which is what
 * a crawler assumes without the tag.
 */
/** A string stays a string. */
export function withLargeImagePreview(robots: string): string
/** An object (or none) stays an object. */
export function withLargeImagePreview(robots?: OgRobots | null): OgRobots
/** Whatever a page's `robots` metadata is. */
export function withLargeImagePreview(robots?: Metadata['robots']): Metadata['robots']
export function withLargeImagePreview(robots?: Metadata['robots']): Metadata['robots'] {
  if (typeof robots === 'string') {
    const t = robots.trim()
    if (t === '') return 'index, follow, max-image-preview:large'
    return HAS_PREVIEW.test(t) ? t : `${t}, max-image-preview:large`
  }
  if (robots === null || robots === undefined) return { index: true, follow: true, 'max-image-preview': 'large' }
  return { ...robots, 'max-image-preview': robots['max-image-preview'] ?? 'large' }
}
