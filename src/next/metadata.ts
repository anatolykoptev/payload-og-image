import type { Metadata } from 'next'
import type { SanitizedConfig } from 'payload'
import type { ResolvedCard } from '../internal/resolve.js'
import { getRuntime } from '../internal/runtime.js'

type Cfg = { config: Promise<SanitizedConfig> | SanitizedConfig }
type Args = (Cfg & { target: string; doc: { id: string | number } | null | undefined }) | (Cfg & { static: string })

/** `openGraph.images` and `twitter` for a resolved card: one image, in both vocabularies, so X and every other unfurler agree. */
export function descriptorOf(card: ResolvedCard): Pick<Metadata, 'openGraph' | 'twitter'> {
  if (card.kind === 'none') return {}
  const image =
    card.kind === 'own' ? card.image : { url: card.url, width: card.size.width, height: card.size.height, type: card.type, alt: card.alt }
  const base = { url: image.url, width: image.width, height: image.height, alt: image.alt ?? '' }
  return {
    openGraph: { images: [{ ...base, type: image.type }] },
    twitter: { card: 'summary_large_image', images: [base] },
  }
}

/**
 * What a page puts in its metadata for its share image. The document passed in is only a key: it is read again by
 * id with the route's own query, so a page that loaded it shallow (a bare upload id) still advertises exactly the
 * card the route serves. In production a failure is an event and `{}`, never a broken page; in development and
 * test it throws.
 */
export async function ogMetadata(a: Args): Promise<Pick<Metadata, 'openGraph' | 'twitter'>> {
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
    rt?.emit({ name: 'render_error', detail: { message: `metadata: ${String((error as Error)?.message ?? error)}` } })
    return {}
  }
}
