import { createHash } from 'node:crypto'
import type { OgOverrides, RelatedFn, ResolverArgs, Target, Template } from '../template.js'
import { DEFAULT_HERO_BACKGROUND, normaliseHeroBackground } from './colour.js'
import { firstShareImage, type ShareImage, shareImageOf } from './eligible.js'
import { type LoadedFont, type Stacks, stripMissing } from './fonts.js'
import {
  type CardFormat,
  encodingOf,
  extensionOf,
  formatOf,
  groundOf,
  type JpegOptions,
  mimeOf,
  variantOf,
  type WebpOptions,
} from './format.js'
import { IMAGE_NAME, MAX_CARD_IMAGES } from './limits.js'
import { uploadSource } from './needs.js'
import { pooled } from './pool.js'
import type { CardEncoding, CardKey, CardMime, SiteInfo, Size, Upload } from './types.js'
import { canonicalJson, cardVersion, normalizeProps, pageId } from './version.js'

export type GeneratedCard = {
  kind: 'generated'
  key: CardKey
  pageId: string
  v: string
  template: Template<any>
  props: any
  hero: Upload | null
  /**
   * The target's named images that resolved (read again with the visitor's access, by id), in the order the target gave them; a name none of
   * whose uploads resolved is not here. Each is read only from its own upload collection's folder.
   */
  images: Array<{ name: string; collection: string; uploads: Upload[] }>
  /** The upload collection the hero was read from: the target's `heroCollection`, else the field's it was populated from, else the site's only one. */
  heroCollection: string | undefined
  /** The ground this card's own target or template set for a transparent hero (normalised); the loader flattens onto it. Undefined: the plugin's. */
  heroBackground: string | undefined
  /** The hero has a see-through pixel and nothing flattens it, so the card shows through it (what the version's `ha` tag records). */
  heroTransparent: boolean
  /** The colour the hero is flattened onto, whoever set it (the card's own, else the plugin's, white included); undefined when none flattens it. */
  heroGround: string | undefined
  alt: string
  url: string
  size: Size
  type: CardMime
  /** How the card is encoded: the format, and for a JPEG or WebP its quality and the ground a see-through pixel is flattened onto. Part of the version. */
  encoding: CardEncoding
  /** Characters no face in the stack draws; they were stripped from the props. */
  missing: string[]
}
export type ResolvedCard = { kind: 'none' } | { kind: 'own'; image: ShareImage } | GeneratedCard

export type ResolveInput = {
  target: Target
  targetName: string
  /** The target is a size variant of another: it never uses an uploaded share image. */
  variant?: boolean
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
  /** True when the site set `heroBackground` (white included), so a transparent hero is flattened. */
  heroFlattened?: boolean
  /** Whether a hero has a see-through pixel; asked only for a hero the site did not flatten. */
  heroHasAlpha?: (hero: Upload, o?: { collection?: string }) => Promise<boolean>
  /** Effective card / hero palette tags when not the default (see `paletteTags`). */
  cardPalette?: string
  heroPalette?: string
  /** The plugin's card format and JPEG settings; a target's own win. */
  format?: CardFormat
  jpeg?: JpegOptions
  webp?: WebpOptions
  seoImage?: { path: string; isDeliberate?: (image: unknown) => boolean }
  /** Handed to the target's resolvers (default: always null). */
  related?: RelatedFn
  /** The site's only upload collection, when it has exactly one: where a hero or named image that is a bare id is read from if the target names no collection. */
  uploadCollection?: string
}

/** The target's own alt, else `<label>: <title>`. An empty answer is the default; anything but a string is the site's bug and says so. */
function altOf(target: Target, args: ResolverArgs<any>, props: Record<string, any>, title: string): string {
  const own = target.alt?.({ ...args, props } as never)
  if (own !== undefined && own !== null && typeof own !== 'string')
    throw new Error(`payload-og-image: target alt must return a string, got ${typeof own}`)
  if (own && own.trim() !== '') return own.trim()
  return typeof props.label === 'string' && props.label !== '' ? `${props.label}: ${title}` : title
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

/**
 * The upload, read again by id with the caller's access (`related`: published and access-respecting, the editor's draft view in a preview), or null
 * when it is missing, unreadable to this caller, or has no file. Never the object the target handed over: that is only the id it names.
 */
async function readUpload(related: RelatedFn, collection: string, id: string): Promise<Upload | null> {
  try {
    return usableHero(await related(collection, id))
  } catch {
    return null
  }
}

/**
 * The card's hero: the id the target's `hero` resolver names (a bare id, or an upload object, of which only the id is taken), read again by id
 * with the caller's access (`related`: published only, the editor's draft view in a preview), from `heroCollection`, else the collection `populateUploads` read the object from, else the site's only upload
 * collection, exactly as a named image is. The object the target handed over is never drawn as it is: whatever filled it (a populated field, a custom
 * field, a hand-built value) is not proof that the public may read that upload. With no collection to name, or nothing readable, there is no hero.
 */
async function heroOf(
  i: ResolveInput,
  args: ResolverArgs<any>,
  raw: unknown,
): Promise<{ hero: Upload | null; collection: string | undefined }> {
  const id = uploadId(raw)
  // The target's collection, else the one `populateUploads` read this very object from. What it reads from is also what the hero loader and the alpha probe
  // look in; with neither, the site's only upload collection reads it, and they fall back to that one themselves.
  const collection = i.target.heroCollection ?? (raw !== null && typeof raw === 'object' ? uploadSource.get(raw) : undefined)
  const from = collection ?? i.uploadCollection
  return { hero: id === undefined || from === undefined ? null : await readUpload(args.related, from, id), collection }
}

/** The target's named images, each upload re-read by id (see `readUpload`) from its own collection. Throws for a target that is wrong, never for a missing upload. */
async function namedImages(i: ResolveInput, args: ResolverArgs<any>, template: Template<any>): Promise<GeneratedCard['images']> {
  if (!i.target.images) return []
  const given: unknown = i.target.images(args)
  if (given === null || given === undefined) return []
  if (!isPlainObject(given))
    throw new Error(`payload-og-image: target "${i.targetName}" images() must return a plain object, got ${typeof given}`)
  const wanted: Array<{ name: string; collection: string; ids: string[] }> = []
  let left = MAX_CARD_IMAGES
  for (const [name, value] of Object.entries(given)) {
    if (!IMAGE_NAME.test(name)) throw new Error(`payload-og-image: target "${i.targetName}" image name "${name}" must match ${IMAGE_NAME}`)
    if (!template.imageBoxes || !Object.hasOwn(template.imageBoxes, name)) {
      throw new Error(
        `payload-og-image: target "${i.targetName}" gives image "${name}" that template "${template.id}" does not declare in imageBoxes`,
      )
    }
    // Ids are collected up to the remaining budget only: a huge hasMany list costs no more than the first few entries.
    const ids: string[] = []
    if (value !== null && value !== undefined) {
      for (const ref of Array.isArray(value) ? value : [value]) {
        if (ids.length >= left) break
        const id = uploadId(ref)
        if (id !== undefined) ids.push(id)
      }
    }
    // A name with no usable id needs no collection: only an image that is really wanted can fail for lack of one.
    if (ids.length === 0) continue
    const collection =
      (i.target.imageCollections && Object.hasOwn(i.target.imageCollections, name) ? i.target.imageCollections[name] : undefined) ??
      i.target.heroCollection ??
      i.uploadCollection
    if (collection === undefined) {
      throw new Error(
        `payload-og-image: target "${i.targetName}" image "${name}" needs an upload collection: set imageCollections.${name} (the site has more than one upload collection)`,
      )
    }
    wanted.push({ name, collection, ids })
    left -= ids.length
  }
  // Each distinct upload is read once, a few at a time.
  const distinct = [
    ...new Map(
      wanted.flatMap((w) => w.ids.map((id) => [`${w.collection}\u0000${id}`, { collection: w.collection, id }] as const)),
    ).entries(),
  ]
  const read = new Map(await pooled(distinct, 4, async ([key, u]) => [key, await readUpload(args.related, u.collection, u.id)] as const))
  const resolved = wanted.flatMap(({ name, collection, ids }) => {
    const uploads = ids.map((id) => read.get(`${collection}\u0000${id}`) ?? null).filter((u): u is Upload => u !== null)
    return uploads.length > 0 ? [{ name, collection, uploads }] : []
  })
  // One canonical order (by name) for the version and for the template, so equal hash means equal drawing whatever order the target listed them in.
  return resolved.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
}

/** The document's `og.mode`: one of the four, and `inherit` for anything else (including no `og` data). */
export function ogMode(doc: Record<string, any>): 'inherit' | 'generated' | 'custom' | 'off' {
  const m = isPlainObject(doc.og) ? doc.og.mode : undefined
  return m === 'generated' || m === 'custom' || m === 'off' ? m : 'inherit'
}

/** `og.nonce`: a positive safe integer, else 0 (absent, negative, fractional or not a number all hash as 0.1). */
const ogNonce = (og: Record<string, unknown>): number =>
  typeof og.nonce === 'number' && Number.isSafeInteger(og.nonce) && og.nonce > 0 ? og.nonce : 0

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

/**
 * `/og/:kind/:slug/card.png` filled in; `:ext` is the extension of the card's `format` (`png`, `jpg`, `webp`). A single pass, so a value that
 * contains `:slug` is never expanded again. A path with `:ext` and no format to take it from is the caller's bug and throws.
 */
export function cardPath(target: Target, targetName: string, slug: string, format?: CardFormat): string {
  const values: Record<string, string> = { kind: target.kind ?? targetName, slug, id: slug }
  return target.path.replace(/:(kind|slug|id|ext)\b/g, (_, name: string) => {
    if (name === 'ext') {
      if (format === undefined) throw new Error(`payload-og-image: card path "${target.path}" has :ext and no format to name it`)
      return extensionOf(format)
    }
    return encodeURIComponent(values[name] as string)
  })
}

/** The file name a card is served under (the last segment of its path, percent-decoded), or undefined when the path is malformed. */
export function cardFile(target: Target, targetName: string, slug: string, format: CardFormat): string | undefined {
  try {
    return decodeURIComponent(cardPath(target, targetName, slug, format).split('/').pop() as string)
  } catch {
    return undefined
  }
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
  // The target's own `seoImage` wins over the plugin's: it is scoped to the target. `except` is an upload that is not a deliberate share image (the hero).
  const seoOption = i.target.seoImage ?? i.seoImage
  const seo = seoOption ? getPath(i.doc, seoOption.path) : undefined
  const except = i.target.seoImage?.except ? i.target.seoImage.except(args) : undefined
  const editor =
    mode !== 'generated' && seo != null && (seoOption?.isDeliberate?.(seo) ?? true) && !sameUpload(seo, rawHero) && !sameUpload(seo, except)
      ? seo
      : undefined
  const title = typeof i.doc.title === 'string' ? i.doc.title.trim() : ''
  // The editor's image wins without asking the target for alternatives (and without running its code).
  // Mode `custom` is the editor's image alone (target.share() is not asked); `generated` skips the image step.
  // A variant is another size of the generated card: an upload has one size, so a variant never uses it.
  const own =
    mode === 'generated' || i.variant === true
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
  if (template.normalize) {
    // The template's own say on what it never draws, before the version is taken (a member left undefined is no part of it).
    const next = normalizeProps(template.normalize(props as never), `${templateId}.normalize`) as Record<string, any>
    for (const k of Object.keys(props)) delete props[k]
    Object.assign(props, next)
  }
  if (template.required && !template.required(props as never)) return { kind: 'none' }

  const slug = routable(nonEmpty(getPath(i.doc, i.target.slugField ?? 'slug')))
  if (slug === undefined) return { kind: 'none' }
  const { hero, collection: heroCollection } = await heroOf(i, args, rawHero)
  const images = await namedImages(i, args, template)
  const key = { kind: i.target.kind ?? i.targetName, slug }
  // A transparent hero nobody flattens is drawn with its alpha (0.5.0); its bytes differ from 0.4.0's, so its URL must too.
  const ownBackground = i.target.heroBackground ?? template.heroBackground
  const background = ownBackground === undefined ? undefined : normaliseHeroBackground(ownBackground)
  const flattened = background !== undefined || i.heroFlattened
  const heroTransparent = hero !== null && !flattened && i.heroHasAlpha ? await i.heroHasAlpha(hero, { collection: heroCollection }) : false
  // The target's own format wins, then the template's, then the plugin's.
  const { format, quality } = formatOf(
    { format: i.format, jpeg: i.jpeg, webp: i.webp },
    { ...i.target, format: i.target.format ?? template.format },
  )
  const encoding: CardEncoding = encodingOf(format, quality, groundOf(background, i.heroBackground))
  const v = cardVersion({
    templateId,
    templateRevision: template.revision,
    props,
    heroes: hero ? [hero] : [],
    images,
    // An own ground is hashed like the plugin's: only when it is not white (white is what 0.4.0 flattened onto, and hashes no tag).
    heroBackground: background === undefined ? i.heroBackground : background === DEFAULT_HERO_BACKGROUND ? undefined : background,
    heroTransparent,
    cardPalette: i.cardPalette,
    heroPalette: i.heroPalette,
    variant: variantOf(encoding),
    fontsDigest: fontsKey(i.fontsDigest, i.stacks),
    host: i.host,
    nonce: ogNonce(og),
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
    images,
    heroCollection,
    heroBackground: background,
    heroTransparent,
    heroGround: background ?? (i.heroFlattened ? (i.heroBackground ?? DEFAULT_HERO_BACKGROUND) : undefined),
    alt: altOf(i.target, args, props, cardTitle),
    url: `${i.serverUrl.replace(/\/+$/, '')}${cardPath(i.target, i.targetName, slug, format)}?v=${v}`,
    size: template.size,
    type: mimeOf(format),
    encoding,
    missing: [...new Set(missing)],
  }
}
