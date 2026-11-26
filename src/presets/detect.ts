// Reads a collection's config to find what a preset card draws. Pure functions of the (unsanitized) collection config.
import { uploadFieldPaths } from '../plugin/payloadSource.js'

type Field = {
  type?: string
  name?: string
  fields?: Field[]
  tabs?: Array<{ fields?: Field[]; name?: string }>
  relationTo?: unknown
  hasMany?: boolean
}
export type CollectionLike = {
  slug: string
  auth?: unknown
  labels?: { plural?: unknown }
  admin?: { useAsTitle?: string }
  fields?: Field[]
}

const TITLE_NAMES = ['title', 'name']
const HERO_NAMES = ['hero', 'heroImage', 'image', 'cover', 'coverImage', 'featuredImage']

/** Every named leaf field with its path, through groups, tabs, rows and collapsibles. */
export function flatFields(fields: Field[] | undefined, prefix: string[] = []): Array<{ path: string[]; field: Field }> {
  const out: Array<{ path: string[]; field: Field }> = []
  for (const f of fields ?? []) {
    if (f.type === 'group' && f.name) out.push(...flatFields(f.fields, [...prefix, f.name]))
    else if (f.type === 'tabs') for (const t of f.tabs ?? []) out.push(...flatFields(t.fields, t.name ? [...prefix, t.name] : prefix))
    else if (!f.name && f.fields) out.push(...flatFields(f.fields, prefix))
    else if (f.name) out.push({ path: [...prefix, f.name], field: f })
  }
  return out
}

const fail = (msg: string): never => {
  throw new Error(`payload-og-image: ${msg}`)
}

const isText = (f: Field) => f.type === 'text' || f.type === 'textarea'

/** The collection's title field path: the option, else `admin.useAsTitle`, else `title`, else `name`. None is a start-up error naming the collection. */
export function titlePathOf(c: CollectionLike, given: string | undefined): string {
  const flat = flatFields(c.fields)
  const textual = new Set(flat.filter((x) => isText(x.field)).map((x) => x.path.join('.')))
  if (given !== undefined) {
    if (!textual.has(given)) fail(`collection "${c.slug}": title "${given}" is not a text or textarea field of it`)
    return given
  }
  const candidates = [c.admin?.useAsTitle, ...TITLE_NAMES].filter((n): n is string => typeof n === 'string')
  const found = candidates.find((n) => textual.has(n))
  if (found === undefined) {
    fail(
      `collection "${c.slug}" has no title field the card can draw (looked for ${[...new Set(candidates)].join(', ')}): name one with collections: [{ slug: '${c.slug}', title: '<field path>' }]`,
    )
  }
  return found as string
}

/** The hero upload field: the option (`false`: never a photo), else the first single upload field named like a hero, else `meta.image`. */
export function heroOf(c: CollectionLike, given: string | false | undefined): { path: string; collection: string } | undefined {
  if (given === false) return undefined
  const uploads = uploadFieldPaths(c.fields).map((u) => ({ path: u.path.join('.'), collection: u.relationTo }))
  if (given !== undefined) {
    const hit = uploads.find((u) => u.path === given)
    if (!hit) fail(`collection "${c.slug}": hero "${given}" is not a single upload field of it`)
    return hit
  }
  for (const n of HERO_NAMES) {
    const hit = uploads.find((u) => u.path === n)
    if (hit) return hit
  }
  return uploads.find((u) => u.path === 'meta.image')
}

/** The collection's `meta.image` (plugin-seo's group), when it has one: the editor's own share image. */
export const hasSeoImage = (c: CollectionLike): boolean =>
  flatFields(c.fields).some((x) => x.path.join('.') === 'meta.image' && x.field.type === 'upload')

/** A text or textarea field path, checked. */
export function textPathOf(c: CollectionLike, what: string, given: string): string {
  const ok = flatFields(c.fields).some((x) => isText(x.field) && x.path.join('.') === given)
  if (!ok) fail(`collection "${c.slug}": ${what} "${given}" is not a text or textarea field of it`)
  return given
}

/** The card's label: the option, else `labels.plural` (a string, `en`, or the first locale), else the slug. */
export function labelOf(c: CollectionLike, given: string | undefined): string {
  if (given !== undefined) return given
  const p = c.labels?.plural
  if (typeof p === 'string' && p.trim() !== '') return p.trim()
  if (p !== null && typeof p === 'object') {
    const map = p as Record<string, unknown>
    const v = typeof map.en === 'string' ? map.en : Object.values(map).find((x) => typeof x === 'string')
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  const words = c.slug.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `slug` when the collection has a top-level text `slug` field; else the path keys by `:id`. */
export const hasSlugField = (c: CollectionLike): boolean => flatFields(c.fields).some((x) => x.path.join('.') === 'slug' && isText(x.field))
