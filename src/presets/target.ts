import { HERO_MIME } from '../internal/limits.js'
import type { SiteInfo } from '../internal/types.js'
import type { ImageRef, ResolverArgs, Target } from '../template.js'
import type { PresetProps } from './layout.js'
import { HERO_MIN, PHOTO_ID, TEXT_ID } from './spec.js'

export type PresetName = 'auto' | 'photo' | 'text'

/** One collection of `ogImagePlugin({ collections })`, after detection. */
export type ResolvedPreset = {
  slug: string
  preset: PresetName
  title: string
  subtitle?: string
  byline?: string
  label: string
  hero?: { path: string; collection: string }
  hasSlug: boolean
  path: string
  /** The upload collection `site().logo` and `site().brandArt` are read from; default: the hero's, else the site's only one. */
  logoCollection?: string
  artOpacity?: number
  /** The editor's own share image for this collection (the plugin's `seoImage`, else plugin-seo's `meta.image`), when there is one. */
  seo?: { path: string; isDeliberate?: (image: unknown) => boolean; collection?: string }
  /** The document's `og.headline`, `og.subtitle`, `og.label` and `og.accent` may be drawn (the fields are absent or pass the field rules). */
  ogHeadline: boolean
  ogSubtitle: boolean
  ogLabel: boolean
  ogAccent: boolean
}

/** An own property, never the prototype's: `constructor.name` is not a field path. */
export function read(doc: unknown, path: string): unknown {
  let cur = doc
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, part)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** A hero a photo card can use: a populated raster upload with a file, at least `HERO_MIN`. Anything else draws the text preset. */
export function eligibleHero(hero: unknown): boolean {
  if (hero === null || typeof hero !== 'object') return false
  const h = hero as { id?: unknown; url?: unknown; width?: unknown; height?: unknown; mimeType?: unknown }
  return (
    (typeof h.id === 'string' || typeof h.id === 'number') &&
    typeof h.url === 'string' &&
    h.url !== '' &&
    typeof h.mimeType === 'string' &&
    (HERO_MIME as readonly string[]).includes(h.mimeType) &&
    typeof h.width === 'number' &&
    typeof h.height === 'number' &&
    h.width >= HERO_MIN.width &&
    h.height >= HERO_MIN.height
  )
}

/** The preset a document draws: the photo preset unless the collection forces text or the document has no eligible hero. */
export function choosePreset(p: Pick<ResolvedPreset, 'preset' | 'hero'>, doc: unknown): 'photo' | 'text' {
  if (p.preset === 'text' || p.hero === undefined) return 'text'
  return eligibleHero(read(doc, p.hero.path)) ? 'photo' : 'text'
}

const str = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
  return s === '' ? undefined : s
}
const ref = (v: unknown): ImageRef | undefined =>
  typeof v === 'string' || typeof v === 'number'
    ? v
    : v !== null && typeof v === 'object' && 'id' in v
      ? (v as { id: string | number })
      : undefined

/** The ordinary target a preset collection expands into. */
export function presetTarget(p: ResolvedPreset): Target {
  const choose = (doc: unknown) => choosePreset(p, doc)
  const target: Target = {
    path: p.path,
    collection: p.slug,
    slugField: p.hasSlug ? 'slug' : 'id',
    template: ({ doc }: ResolverArgs<unknown>) => (choose(doc) === 'photo' ? PHOTO_ID : TEXT_ID),
    // Only a photo card has a hero: a text card must not hash or load one it never draws.
    hero: ({ doc }: ResolverArgs<unknown>) => (p.hero && choose(doc) === 'photo' ? (read(doc, p.hero.path) as ImageRef) : undefined),
    ...(p.hero ? { heroCollection: p.hero.collection } : {}),
    // The photo set is cut from the hero field whether or not the card draws it (a 680 x 470 hero is too small for the photo card and still gives a set; a collection that
    // forces the text card still has its hero). Read as a bare id and verified by the reader, so the card's own reads do not change. Never the editor's share image: a hero
    // that IS the share image field (`meta.image`, however it was chosen, or a plugin `seoImage.path` that is also the hero) is no photo of ours.
    photo:
      p.hero && p.hero.path !== 'meta.image' && p.seo?.path !== p.hero.path
        ? ({ doc }: ResolverArgs<unknown>) => read(doc, (p.hero as { path: string }).path) as ImageRef
        : false,
    // A preset knows which upload fields it draws: the editor's share image, and the hero unless the collection forces text (the hero decides
    // the preset, so it is read for 'auto' and 'photo' only). Nothing else is read from the document.
    uploadFields: [...(p.seo ? [p.seo.path] : []), ...(p.preset !== 'text' && p.hero ? [p.hero.path] : [])],
    props: ({ doc, site, overrides }: ResolverArgs<unknown>): PresetProps => ({
      title: (p.ogHeadline ? overrides?.headline : undefined) ?? str(read(doc, p.title)) ?? '',
      subtitle: (p.ogSubtitle ? overrides?.subtitle : undefined) ?? (p.subtitle ? str(read(doc, p.subtitle)) : undefined),
      // The document's own label wins over the collection's, never the other way round.
      label: (p.ogLabel ? overrides?.label : undefined) ?? p.label,
      // Only a document that set one hashes it: the preset's own accent is the template's.
      ...(p.ogAccent && overrides?.accent ? { accent: overrides.accent } : {}),
      byline: p.byline ? str(read(doc, p.byline)) : undefined,
      site: site.name,
      // Only a site that chose one hashes it: the default is the template's own.
      ...(p.artOpacity === undefined ? {} : { artOpacity: p.artOpacity }),
    }),
    // Only a ref that exists is named: a name with no upload needs no upload collection, so a site with none (or several) still draws a text card.
    images: ({ doc, site }: ResolverArgs<unknown>) => {
      const logo = ref((site as SiteInfo).logo)
      const partner = logo === undefined ? undefined : ref((site as SiteInfo).partnerLogo)
      const art = ref((site as SiteInfo).brandArt)
      const photo = choose(doc) === 'photo'
      return {
        ...(logo === undefined ? {} : { logo }),
        ...(partner === undefined ? {} : { partner }),
        // The right side of the text card: the uploaded art, else the halftone of the logo (which the logo's shape may decline).
        ...(photo ? {} : art !== undefined ? { art } : logo !== undefined ? { mark: logo } : {}),
      }
    },
    // Scoped to this target. The hero is never the editor's deliberate share image, whether or not this card draws it (a text card does not).
    ...(p.seo
      ? {
          seoImage: {
            path: p.seo.path,
            isDeliberate: p.seo.isDeliberate,
            except: ({ doc }: ResolverArgs<unknown>) =>
              // Ids are only unique within a collection: the hero is the same upload only when it is read from the share image's own collection.
              p.hero && (p.seo?.collection === undefined || p.seo.collection === p.hero.collection) ? read(doc, p.hero.path) : undefined,
          },
        }
      : {}),
    ...(p.logoCollection
      ? { imageCollections: { logo: p.logoCollection, partner: p.logoCollection, mark: p.logoCollection, art: p.logoCollection } }
      : {}),
  }
  return target
}
