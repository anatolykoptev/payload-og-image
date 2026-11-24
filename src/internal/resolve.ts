import { createHash } from 'node:crypto'
import type { OgOverrides, RelatedFn, Target, Template } from '../template.js'
import { firstShareImage, type ShareImage, shareImageOf } from './eligible.js'
import { type LoadedFont, type Stacks, stripMissing } from './fonts.js'
import type { CardKey, SiteInfo, Size, Upload } from './types.js'
import { canonicalJson, cardVersion, normalizeProps, pageId } from './version.js'

export type GeneratedCard = {
  kind: 'generated'
  key: CardKey
  pageId: string
  v: string
  template: Template<any>
  props: any
  hero: Upload | null
  /** The upload collection the hero is read from (the target's `heroCollection`). */
  heroCollection: string | undefined
  alt: string
  url: string
  size: Size
  type: 'image/png'
  /** Characters no face in the stack draws; they were stripped from the props. */
  missing: string[]
}
export type ResolvedCard = { kind: 'none' } | { kind: 'own'; image: ShareImage } | GeneratedCard

export type ResolveInput = {
  target: Target
  targetName: string
  doc: Record<string, any>
  site: SiteInfo
  host: string
  serverUrl: string
  templates: Map<string, Template<any>>
  fonts: LoadedFont[]
  fontsDigest: string
  stacks: Stacks
  /** Normalised hero background when not the default white. */
  heroBackground?: string
  seoImage?: { path: string; isDeliberate?: (image: unknown) => boolean }
  /** Handed to the target's resolvers (default: always null). */
  related?: RelatedFn
}

export function getPath(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj
  for (const part of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** The id of an upload, whether the field is populated (an object) or not (the bare id). */
const uploadId = (u: unknown): string | undefined => {
  const id = u && typeof u === 'object' && 'id' in u ? (u as { id?: unknown }).id : u
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined
}
const sameUpload = (a: unknown, b: unknown) => {
  const x = uploadId(a)
  return x !== undefined && x === uploadId(b)
}

/** A hero is drawn only from a populated upload with an id and a file; anything else draws nothing and is no part of the version. */
const usableHero = (h: unknown): Upload | null =>
  h && typeof h === 'object' && uploadId(h) !== undefined && typeof (h as Upload).url === 'string' && (h as Upload).url !== ''
    ? (h as Upload)
    : null

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** The document's `og.mode`: one of the four, and `inherit` for anything else (including no `og` data). */
export function ogMode(doc: Record<string, any>): 'inherit' | 'generated' | 'custom' | 'off' {
  const m = isPlainObject(doc.og) ? doc.og.mode : undefined
  return m === 'generated' || m === 'custom' || m === 'off' ? m : 'inherit'
}

/** A card key (slug) longer than this is no document of ours: the route refuses it, so a page must not advertise it either. */
export const MAX_SLUG = 256

/** `.` and `..` as a whole path segment are resolved away by every URL parser (even as %2E), so they cannot key a route. */
const routable = (slug: string | undefined) =>
  slug === undefined || slug === '.' || slug === '..' || slug.length > MAX_SLUG ? undefined : slug

const nonEmpty = (v: unknown, stringsOnly = false): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' && !stringsOnly ? String(v) : ''
  return s === '' ? undefined : s
}

/**
 * The face digest plus the stack order. Which family draws a title depends on the stacks, so reordering them
 * must change every card URL just as swapping a font file does.
 */
const fontsKey = (digest: string, stacks: Stacks) =>
  createHash('sha256')
    .update(`${digest}\n${canonicalJson(stacks)}`)
    .digest('hex')

/** `/og/:kind/:slug/card.png` filled in. A single pass, so a value that contains `:slug` is never expanded again. */
export function cardPath(target: Target, targetName: string, slug: string): string {
  const values: Record<string, string> = { kind: target.kind ?? targetName, slug, id: slug }
  return target.path.replace(/:(kind|slug|id)\b/g, (_, name: string) => encodeURIComponent(values[name] as string))
}

/** kind -> target name. Two targets sharing a kind would share card URLs and store keys, so it throws. */
export function buildKindIndex(targets: Record<string, Target>): Record<string, string> {
  // A Map, then own properties: a target called `constructor` or `__proto__` must not collide with Object.prototype.
  const index = new Map<string, string>()
  for (const [name, t] of Object.entries(targets)) {
    const kind = t.kind ?? name
    const other = index.get(kind)
    if (other !== undefined) throw new Error(`payload-og-image: targets "${other}" and "${name}" share the kind "${kind}"`)
    index.set(kind, name)
  }
  return Object.fromEntries(index)
}

/**
 * What a link to a document shows, by one precedence: the editor's own share image (unless it is just the
 * hero), then any other eligible photo the target offers, then a generated card, and nothing at all when
 * the card would be blank. The document's `og.mode` bends it: `off` shows nothing, `generated` skips the
 * images, `custom` takes the editor's image only; `inherit` (and no `og` data) is the precedence above, unchanged.
 */
export async function resolveCard(i: ResolveInput): Promise<ResolvedCard> {
  const og = isPlainObject(i.doc.og) ? i.doc.og : {}
  const mode = ogMode(i.doc)
  const overrides = { headline: nonEmpty(og.headline, true), subtitle: nonEmpty(og.subtitle, true) }
  if (mode === 'off') return { kind: 'none' }
  const args = {
    doc: i.doc,
    site: i.site,
    related: i.related ?? (async () => null),
    overrides: Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) as OgOverrides,
  }
  const rawHero = i.target.hero?.(args)
  const hero = usableHero(rawHero)
  const seo = i.seoImage ? getPath(i.doc, i.seoImage.path) : undefined
  const editor =
    mode !== 'generated' && seo != null && (i.seoImage?.isDeliberate?.(seo) ?? true) && !sameUpload(seo, rawHero) ? seo : undefined
  const title = typeof i.doc.title === 'string' ? i.doc.title.trim() : ''
  // The editor's image wins without asking the target for alternatives (and without running its code).
  // Mode `custom` is the editor's image alone (target.share() is not asked); `generated` skips the image step.
  const own =
    mode === 'generated'
      ? undefined
      : (shareImageOf(editor, i.serverUrl) ?? (mode === 'custom' ? undefined : firstShareImage(i.target.share?.(args) ?? [], i.serverUrl)))
  if (own) return { kind: 'own', image: { ...own, alt: own.alt ?? title } }

  const templateId = typeof i.target.template === 'function' ? i.target.template(args) : i.target.template
  const template = i.templates.get(templateId)
  if (!template) throw new Error(`payload-og-image: target "${i.targetName}" names unknown template "${templateId}"`)
  const given: unknown = await i.target.props(args)
  if (!isPlainObject(given)) {
    throw new Error(
      `payload-og-image: target "${i.targetName}" props() must return a plain object, got ${given === null ? 'null' : typeof given}`,
    )
  }
  // The normalized value is what is hashed AND what the template receives: one model, no divergence.
  const props = normalizeProps(given, `${i.targetName}.props`) as Record<string, any>
  const missing: string[] = []
  for (const field of template.textFields ?? []) {
    if (typeof props[field] !== 'string') continue
    // The field's mapped stack, else the stack named like the field, else the one explicit `default` stack.
    const stackName = template.stacks?.[field] ?? field
    const stack = i.stacks[stackName] ?? i.stacks.default
    if (!stack || stack.length === 0) {
      throw new Error(
        `payload-og-image: template "${template.id}" field "${field}" has no font stack (looked for "${stackName}", then "default")`,
      )
    }
    const s = stripMissing(i.fonts, stack, props[field])
    // Stripping leaves holes ("a 🚀 b" -> "a  b"): close them. Text that lost nothing is left exactly as given.
    props[field] = s.missing.length > 0 ? s.text.replace(/\s+/g, ' ').trim() : s.text
    missing.push(...s.missing)
  }
  if (template.required && !template.required(props as never)) return { kind: 'none' }

  const slug = routable(nonEmpty(getPath(i.doc, i.target.slugField ?? 'slug')))
  if (slug === undefined) return { kind: 'none' }
  const key = { kind: i.target.kind ?? i.targetName, slug }
  const v = cardVersion({
    templateId,
    templateRevision: template.revision,
    props,
    heroes: hero ? [hero] : [],
    heroBackground: i.heroBackground,
    fontsDigest: fontsKey(i.fontsDigest, i.stacks),
    host: i.host,
  })
  const cardTitle = typeof props.title === 'string' ? props.title : ''
  return {
    kind: 'generated',
    key,
    pageId: pageId(key),
    v,
    template,
    props,
    hero,
    heroCollection: i.target.heroCollection,
    alt: typeof props.label === 'string' && props.label !== '' ? `${props.label}: ${cardTitle}` : cardTitle,
    url: `${i.serverUrl.replace(/\/+$/, '')}${cardPath(i.target, i.targetName, slug)}?v=${v}`,
    size: template.size,
    type: 'image/png',
    missing: [...new Set(missing)],
  }
}
