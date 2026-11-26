import type { Config } from 'payload'
import type { OgImagePluginInput, OgImagePluginOptions, PresetCollection, PresetCollectionOptions } from '../plugin/index.js'
import type { Target } from '../template.js'
import {
  type CollectionLike,
  collectionReadProblem,
  hasSeoImage,
  hasSlugField,
  heroOf,
  labelOf,
  textPathOf,
  titlePathOf,
} from './detect.js'
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

const isOptions = (v: unknown): v is PresetCollectionOptions => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * One collection's preset, or a thrown named reason. `seo` is the editor's share image the target honours: the plugin's `seoImage`, else the
 * collection's own `meta.image`: scoped to this target, never plugin-wide.
 */
function resolvePreset(c: CollectionLike, own: PresetCollectionOptions, o: OgImagePluginInput): ResolvedPreset {
  if (c.auth) fail(`collection "${c.slug}" is an auth collection: a card for a user is never offered`)
  if (c.upload) fail(`collection "${c.slug}" is an upload collection: a file is not a page`)
  if (!SEGMENT.test(c.slug)) fail(`collection "${c.slug}" must be one URL-safe segment to be a card kind`)
  if (own.preset !== undefined && own.preset !== 'auto' && own.preset !== 'photo' && own.preset !== 'text')
    fail(`collection "${c.slug}": preset must be 'auto', 'photo' or 'text'`)
  const hasSlug = hasSlugField(c)
  const path = own.path ?? (hasSlug ? '/og/:kind/:slug/card.:ext' : '/og/:kind/:id/card.:ext')
  const hero = heroOf(c, own.hero)
  if ((own.preset ?? 'auto') === 'photo' && hero === undefined)
    fail(`collection "${c.slug}": preset 'photo' needs a hero upload field, and none was found (set hero: '<upload field path>')`)
  return {
    slug: c.slug,
    preset: own.preset ?? 'auto',
    title: titlePathOf(c, own.title),
    subtitle: own.subtitle === undefined ? undefined : textPathOf(c, 'subtitle', own.subtitle),
    byline: own.byline === undefined ? undefined : textPathOf(c, 'byline', own.byline),
    label: labelOf(c, own.label),
    hero,
    hasSlug,
    path,
    logoCollection: o.logoCollection,
    artOpacity: o.artOpacity,
    seo: o.seoImage ?? (hasSeoImage(c) ? { path: 'meta.image' } : undefined),
  }
}

/**
 * Turns the preset side of the options into ordinary targets and fills what the preset path defaults, before anything validates: the same
 * place and kind of step as `withVariants`. A classic input (`targets`, no `collections`) is returned as it is.
 *
 * The plugin serves every public page on its own: with no `collections` and no `targets` it discovers each collection that is not an upload or
 * an auth collection, that the public may read (its `access.read` answers an anonymous request with `true` or a `Where`), and that has a title
 * field the public may read. A collection that is unclear is skipped, never a crash: one start-up line names each and the reason.
 * `collections` as a list is exactly those; as an object it customises (and adds) entries on top of the discovered ones; `exclude` opts out.
 */
export function expandPresets(o: OgImagePluginInput, config: Config): OgImagePluginOptions {
  if (o.collections === undefined && o.targets !== undefined) return o as OgImagePluginOptions
  if (o.artOpacity !== undefined && !(typeof o.artOpacity === 'number' && o.artOpacity >= 0 && o.artOpacity <= 1))
    fail(`artOpacity must be a number from 0 to 1, got ${JSON.stringify(o.artOpacity)}`)
  const all = (config.collections ?? []) as unknown as CollectionLike[]
  const known = new Map(all.map((c) => [c.slug, c]))
  const targets = new Map<string, Target>(Object.entries(o.targets ?? {}))
  const exclude = new Set<string>()
  for (const slug of o.exclude ?? []) {
    if (!known.has(slug)) fail(`exclude names "${String(slug)}", which is not a collection of this config`)
    exclude.add(slug)
  }

  const given = o.collections
  if (given !== undefined && !Array.isArray(given) && !isOptions(given))
    fail('options.collections must be a list of slugs or an object of options by slug')
  if (Array.isArray(given) && given.length === 0) fail('options.collections must list at least one collection slug or { slug, ... }')
  const explicit = new Map<string, PresetCollectionOptions>()
  if (Array.isArray(given)) {
    for (const entry of given as PresetCollection[]) {
      const c = typeof entry === 'string' ? { slug: entry } : entry
      if (c === null || typeof c !== 'object' || typeof c.slug !== 'string') fail('collections entries must be a slug or { slug, ... }')
      if (explicit.has(c.slug)) fail(`collections names "${c.slug}" twice`)
      explicit.set(c.slug, c)
    }
  } else if (given) for (const [slug, opts] of Object.entries(given)) explicit.set(slug, isOptions(opts) ? opts : {})

  const add = (c: CollectionLike, opts: PresetCollectionOptions) => {
    targets.set(c.slug, presetTarget(resolvePreset(c, opts, o)))
  }
  // What was asked for by name is strict: a mistake there is the site's to fix at start-up.
  for (const [slug, opts] of explicit) {
    const c = known.get(slug)
    if (!c) fail(`collections names "${slug}", which is not a collection of this config`)
    if (targets.has(slug) && Object.hasOwn(o.targets ?? {}, slug))
      fail(`collections names "${slug}", and a target of that name is configured too`)
    if (exclude.has(slug)) fail(`"${slug}" is both in collections and in exclude`)
    add(c as CollectionLike, opts)
  }
  // Discovery: everything else that is public, unless the list form says "these only".
  const skipped: string[] = []
  if (!Array.isArray(given)) {
    for (const c of all) {
      if (explicit.has(c.slug) || exclude.has(c.slug) || c.auth || c.upload || targets.has(c.slug)) continue
      const why = collectionReadProblem(c)
      if (why) {
        skipped.push(`${c.slug} (${why})`)
        continue
      }
      try {
        add(c, {})
      } catch (error) {
        skipped.push(
          `${c.slug} (${String((error as Error).message)
            .replace(/^payload-og-image: /, '')
            .replace(`collection "${c.slug}" `, '')})`,
        )
      }
    }
  }
  if (skipped.length > 0) console.warn(`payload-og-image: no card for ${skipped.join('; ')}`)

  const bundled = o.fonts === undefined && o.stacks === undefined
  const site = o.site ?? (() => ({ name: o.siteName ?? hostName(o.serverURL ?? config.serverURL) }))
  const taken = new Set((o.templates ?? []).map((t) => t.id))
  return {
    ...o,
    site,
    fonts: o.fonts ?? (bundled ? BUNDLED_FONTS : (undefined as never)),
    stacks: o.stacks ?? (bundled ? BUNDLED_STACKS : (undefined as never)),
    templates: [...(o.templates ?? []), ...[textPreset, photoPreset].filter((t) => !taken.has(t.id))],
    targets: Object.fromEntries(targets),
    store: o.store ?? { memory: true },
  } as OgImagePluginOptions
}
