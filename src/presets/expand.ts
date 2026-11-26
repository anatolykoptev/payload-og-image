import type { Config } from 'payload'
import type { OgImagePluginInput, OgImagePluginOptions, PresetCollection } from '../plugin/index.js'
import type { Target } from '../template.js'
import { type CollectionLike, hasSeoImage, hasSlugField, heroOf, labelOf, textPathOf, titlePathOf } from './detect.js'
import { BUNDLED_FONTS, BUNDLED_STACKS } from './fonts.js'
import { presetTarget, type ResolvedPreset } from './target.js'
import { photoPreset, textPreset } from './templates.js'

const fail = (msg: string): never => {
  throw new Error(`payload-og-image: ${msg}`)
}

const SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/

/** The site name when the site gives none: the `serverURL` host without `www.`. */
function hostName(serverUrl: string | undefined): string {
  try {
    return new URL(serverUrl ?? '').host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Turns `collections` into ordinary targets and fills what the preset path defaults, before anything validates: the same place and kind of
 * step as `withVariants`. Without `collections` the options are returned as they are, and a site that configured nothing is refused.
 */
export function expandPresets(o: OgImagePluginInput, config: Config): OgImagePluginOptions {
  if (o.collections === undefined) {
    if (o.targets === undefined && o.static === undefined)
      fail('nothing is configured: give `collections` (the built-in presets) or `targets` (your own templates)')
    return o as OgImagePluginOptions
  }
  if (!Array.isArray(o.collections) || o.collections.length === 0)
    fail('options.collections must list at least one collection slug or { slug, ... }')
  const known = new Map(((config.collections ?? []) as unknown as CollectionLike[]).map((c) => [c.slug, c]))
  const targets: Record<string, Target> = { ...(o.targets ?? {}) }
  let seo = false
  for (const entry of o.collections as PresetCollection[]) {
    const c = typeof entry === 'string' ? { slug: entry } : entry
    if (c === null || typeof c !== 'object' || typeof c.slug !== 'string') fail('collections entries must be a slug or { slug, ... }')
    const collection = known.get(c.slug)
    if (!collection) fail(`collections names "${c.slug}", which is not a collection of this config`)
    const found = collection as CollectionLike
    if (found.auth) fail(`collections names "${c.slug}", an auth collection: a card for a user is never offered`)
    if (!SEGMENT.test(c.slug)) fail(`collection "${c.slug}" must be one URL-safe segment to be a card kind`)
    if (Object.hasOwn(targets, c.slug)) fail(`collections names "${c.slug}", and a target of that name is configured too`)
    if (c.preset !== undefined && c.preset !== 'auto' && c.preset !== 'photo' && c.preset !== 'text')
      fail(`collection "${c.slug}": preset must be 'auto', 'photo' or 'text'`)
    const hasSlug = hasSlugField(found)
    const path = c.path ?? (hasSlug ? '/og/:kind/:slug/card.:ext' : '/og/:kind/:id/card.:ext')
    if (!/:ext\b/.test(path)) fail(`collection "${c.slug}": path "${path}" needs :ext (the photo preset is a JPEG, the text preset a PNG)`)
    const resolved: ResolvedPreset = {
      slug: c.slug,
      preset: c.preset ?? 'auto',
      title: titlePathOf(found, c.title),
      subtitle: c.subtitle === undefined ? undefined : textPathOf(found, 'subtitle', c.subtitle),
      label: labelOf(found, c.label),
      hero: heroOf(found, c.hero),
      hasSlug,
      path,
      logoCollection: o.logoCollection,
    }
    if (resolved.preset === 'photo' && resolved.hero === undefined)
      fail(`collection "${c.slug}": preset 'photo' needs a hero upload field, and none was found (set hero: '<upload field path>')`)
    targets[c.slug] = presetTarget(resolved)
    seo ||= hasSeoImage(found)
  }
  const bundled = o.fonts === undefined && o.stacks === undefined
  const site = o.site ?? (() => ({ name: o.siteName ?? hostName(o.serverURL ?? config.serverURL) }))
  const taken = new Set((o.templates ?? []).map((t) => t.id))
  return {
    ...o,
    site,
    fonts: o.fonts ?? (bundled ? BUNDLED_FONTS : (undefined as never)),
    stacks: o.stacks ?? (bundled ? BUNDLED_STACKS : (undefined as never)),
    templates: [...(o.templates ?? []), ...[textPreset, photoPreset].filter((t) => !taken.has(t.id))],
    targets,
    store: o.store ?? { memory: true },
    seoImage: o.seoImage ?? (seo ? { path: 'meta.image' } : undefined),
  } as OgImagePluginOptions
}
