import type { SiteInfo } from '../internal/types.js'
import type { ImageRef, ResolverArgs, Target } from '../template.js'
import type { PresetProps } from './layout.js'
import { HERO_MIME, HERO_MIN, PHOTO_ID, TEXT_ID } from './spec.js'

export type PresetName = 'auto' | 'photo' | 'text'

/** One collection of `ogImagePlugin({ collections })`, after detection. */
export type ResolvedPreset = {
  slug: string
  preset: PresetName
  title: string
  subtitle?: string
  label: string
  hero?: { path: string; collection: string }
  hasSlug: boolean
  path: string
  /** The upload collection `site().logo` and `site().brandArt` are read from; default: the hero's, else the site's only one. */
  logoCollection?: string
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
  return {
    path: p.path,
    collection: p.slug,
    slugField: p.hasSlug ? 'slug' : 'id',
    template: ({ doc }: ResolverArgs<unknown>) => (choose(doc) === 'photo' ? PHOTO_ID : TEXT_ID),
    // Only a photo card has a hero: a text card must not hash or load one it never draws.
    hero: ({ doc }: ResolverArgs<unknown>) => (p.hero && choose(doc) === 'photo' ? (read(doc, p.hero.path) as ImageRef) : undefined),
    ...(p.hero ? { heroCollection: p.hero.collection } : {}),
    props: ({ doc, site, overrides }: ResolverArgs<unknown>): PresetProps => ({
      title: overrides?.headline ?? str(read(doc, p.title)) ?? '',
      subtitle: overrides?.subtitle ?? (p.subtitle ? str(read(doc, p.subtitle)) : undefined),
      label: p.label,
      site: site.name,
    }),
    images: ({ doc, site }: ResolverArgs<unknown>) => {
      const logo = ref((site as SiteInfo).logo)
      const art = ref((site as SiteInfo).brandArt)
      if (choose(doc) === 'photo') return { logo }
      return { logo, ...(art !== undefined ? { art } : { mark: logo }) }
    },
    ...(p.logoCollection ? { imageCollections: { logo: p.logoCollection, mark: p.logoCollection, art: p.logoCollection } } : {}),
  }
}
