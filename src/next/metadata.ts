import type { Metadata } from 'next'
import type { SanitizedConfig } from 'payload'
import type { PhotoName } from '../internal/photo.js'
import type { ResolvedCard } from '../internal/resolve.js'
import { getRuntime } from '../internal/runtime.js'
import { variantTargetName } from '../internal/variants.js'

const logged = new Set<string>()
/** The runtime never came up (the plugin is not registered, Payload failed to start), so there is no event sink: say so once per process and message, the way the route does. */
function logNoRuntime(what: string, error: unknown) {
  const line = `[payload-og] event=render_error detail=${JSON.stringify({ message: `${what}: ${String((error as Error)?.message ?? error)}` }).replace(/[^\x20-\x7e]/g, '?')}`
  if (logged.has(line)) return
  logged.add(line)
  console.error(line)
}

export type OgMetadataArgs =
  | { config: Promise<SanitizedConfig> | SanitizedConfig; target: string; doc: { id: string | number } | null | undefined }
  | { config: Promise<SanitizedConfig> | SanitizedConfig; static: string }

/** `openGraph.images` and `twitter` for a resolved card: one image, in both vocabularies, so X and every other unfurler agree. */
export function descriptorOf(card: ResolvedCard): Pick<Metadata, 'openGraph' | 'twitter'> {
  if (card.kind === 'none') return {}
  const image =
    card.kind === 'own' ? card.image : { url: card.url, width: card.size.width, height: card.size.height, type: card.type, alt: card.alt }
  const base = { url: image.url, width: image.width, height: image.height, alt: image.alt ?? '' }
  // `og:image:secure_url` is Facebook's "https:// URL for the image": set only when the image is, never to an http URL.
  const secure = /^https:\/\//i.test(image.url) ? { secureUrl: image.url } : {}
  return {
    openGraph: { images: [{ ...base, ...secure, type: image.type }] },
    twitter: { card: 'summary_large_image', images: [base] },
  }
}

/**
 * What a page puts in its metadata for its share image. The document passed in is only a key: it is read again by
 * id with the route's own query, so a page that loaded it shallow (a bare upload id) still advertises exactly the
 * card the route serves. In production a failure is an event and `{}`, never a broken page; in development and
 * test it throws.
 */
export async function ogMetadata(a: OgMetadataArgs): Promise<Pick<Metadata, 'openGraph' | 'twitter'>> {
  let rt: Awaited<ReturnType<typeof getRuntime>> | undefined
  try {
    if ('static' in a) {
      rt = await getRuntime(a.config)
      return descriptorOf(await rt.resolveForMetadata({ static: a.static }))
    }
    if (a.doc == null) return {}
    rt = await getRuntime(a.config)
    return descriptorOf(await rt.resolveForMetadata({ target: a.target, id: a.doc.id }))
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') throw error
    if (rt) rt.emit({ name: 'render_error', detail: { message: `metadata: ${String((error as Error)?.message ?? error)}` } })
    else logNoRuntime('metadata', error)
    return {}
  }
}

/** One image of a page: the wide `og:image` first (`variant: null`), then each declared variant by name. */
export type OgImage = { url: string; width: number; height: number; variant: string | null }

/** What `ogImages` takes: the same page key as `ogMetadata`, and optionally which variants to list. */
export type OgImagesArgs = {
  config: Promise<SanitizedConfig> | SanitizedConfig
  target: string
  doc: { id: string | number } | null | undefined
  /** Which declared variants to list, in this order. Default: every declared variant, in declaration order. A name the target does not declare throws (in production: `[]` and an event). */
  variants?: string[]
}

const imageOf = (card: ResolvedCard, variant: string | null): OgImage | undefined => {
  if (card.kind === 'none') return undefined
  const i = card.kind === 'own' ? card.image : { url: card.url, width: card.size.width, height: card.size.height }
  return { url: i.url, width: i.width, height: i.height, variant }
}

/**
 * Every size of a page's share image, for a schema.org `image` array (Google asks for 16:9, 4:3 and 1:1): the wide image
 * `ogMetadata` advertises first (the editor's own image when there is one), then the target's variants. It is not for
 * `og:image`: put one image there (see docs/reference.md). A size that would be blank is left out. `[]` when the page has no image.
 * Failure handling is `ogMetadata`'s: in production an event and `[]`, in development and test it throws.
 */
export async function ogImages(a: OgImagesArgs): Promise<OgImage[]> {
  let rt: Awaited<ReturnType<typeof getRuntime>> | undefined
  try {
    if (a.doc == null) return []
    rt = await getRuntime(a.config)
    const declared = rt.variantsOf(a.target)
    const names = a.variants ?? declared
    for (const n of names)
      if (!declared.includes(n))
        throw new Error(`payload-og-image: target "${a.target}" has no variant "${n}" (variants: ${declared.join(', ') || 'none'})`)
    const targets = [a.target, ...names.map((n) => variantTargetName(a.target, n))]
    // One read of the document serves every size; a size that fails is an event of its own and the others still list.
    const cards = await rt.resolveSizes({ targets, id: a.doc.id })
    const live = rt
    return cards.flatMap((c, i) => {
      if (c.status === 'fulfilled') return imageOf(c.value, i === 0 ? null : (names[i - 1] as string)) ?? []
      if (process.env.NODE_ENV !== 'production') throw c.reason
      live.emit({ name: 'render_error', detail: { message: `images: ${targets[i]}: ${String((c.reason as Error)?.message ?? c.reason)}` } })
      return []
    })
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') throw error
    if (rt) rt.emit({ name: 'render_error', detail: { message: `images: ${String((error as Error)?.message ?? error)}` } })
    else logNoRuntime('images', error)
    return []
  }
}

/** One image of a page's photo set: a clean crop of its hero photograph (no text, no logo), by ratio. */
export type OgPhotoImage = { url: string; width: number; height: number; ratio: PhotoName }

/** What `ogPhotoImages` takes: the same page key as `ogMetadata`. */
export type OgPhotoImagesArgs = {
  config: Promise<SanitizedConfig> | SanitizedConfig
  target: string
  doc: { id: string | number } | null | undefined
}

/**
 * The photo set of a page for schema.org `image` and Google Discover: up to three clean crops of the page's hero photograph, 16:9, 4:3 and 1:1 in that order,
 * each at most 1200 px wide and never enlarged (a small photograph gives smaller crops, none under 600 px wide). The branded card is never in it: Google asks for no
 * logo or text in a structured-data image, so `og:image` stays the card (`ogMetadata`) and this list is the photograph. `[]` when the page has no usable photograph
 * (no hero, an unpublished or unreadable one, a file too small, or a target whose card path is not a `.:ext` route): the page then lists no image from this feature.
 * Failure handling is `ogMetadata`'s: in production an event and `[]`, in development and test it throws. See docs/reference.md.
 */
export async function ogPhotoImages(a: OgPhotoImagesArgs): Promise<OgPhotoImage[]> {
  let rt: Awaited<ReturnType<typeof getRuntime>> | undefined
  try {
    if (a.doc == null) return []
    rt = await getRuntime(a.config)
    const set = await rt.resolvePhotos({ target: a.target, id: a.doc.id })
    return (set?.images ?? []).map(({ url, width, height, name }) => ({ url, width, height, ratio: name }))
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') throw error
    if (rt) rt.emit({ name: 'render_error', detail: { message: `photos: ${String((error as Error)?.message ?? error)}` } })
    else logNoRuntime('photos', error)
    return []
  }
}

/** schema.org `primaryImageOfPage` for a list from `ogPhotoImages`: the 16:9 crop as an `ImageObject`, or undefined when the list has none. */
export function ogPrimaryImageOfPage(
  images: readonly OgPhotoImage[],
): { '@type': 'ImageObject'; url: string; width: number; height: number } | undefined {
  const wide = images.find((i) => i.ratio === '16x9')
  return wide ? { '@type': 'ImageObject', url: wide.url, width: wide.width, height: wide.height } : undefined
}
