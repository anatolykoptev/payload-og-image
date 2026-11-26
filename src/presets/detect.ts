// Reads a collection's config to find what a preset card draws. Pure functions of the (unsanitized) collection config.
//
// A preset draws a published document to the PUBLIC, so only a field the public may read is a candidate (plan §9, applied to what is
// auto-detected): not `hidden`, `admin.hidden` or `admin.disabled`, not under such an ancestor, not named `_...`, and, with an `access.read`, only
// one that says `true` to an anonymous request when the config is built. Only scalar fields qualify: a `hasMany` text is an array.

import { type Entry, type Field, singleUpload, flatFields as walk } from '../internal/fields.js'

export type CollectionLike = {
  slug: string
  auth?: unknown
  upload?: unknown
  labels?: { plural?: unknown }
  admin?: { useAsTitle?: string }
  access?: { read?: unknown }
  fields?: Field[]
}

const TITLE_NAMES = ['title', 'name']
const HERO_NAMES = ['hero', 'heroImage', 'image', 'cover', 'coverImage', 'featuredImage']

type Asked = { kind: 'answer'; value: unknown } | { kind: 'async' } | { kind: 'threw' }

/**
 * What an `access.read`-style function says to an anonymous request, asked with a FRESH stub each time (a function may mutate its request). A function
 * that throws (it needs a real request, `req.payload`...) or answers with a Promise cannot be evaluated when the config is built; a Promise gets a
 * rejection handler at once, because a rejected access function must never become an unhandled rejection that ends start-up.
 */
function askAnonymously(fn: unknown, extra: Record<string, unknown> = {}): Asked {
  try {
    const answer = (fn as (a: unknown) => unknown)({ req: { user: null, headers: new Headers() }, ...extra })
    if (answer !== null && typeof answer === 'object' && typeof (answer as { then?: unknown }).then === 'function') {
      ;(answer as Promise<unknown>).then(undefined, () => undefined)
      return { kind: 'async' }
    }
    return { kind: 'answer', value: answer }
  } catch {
    return { kind: 'threw' }
  }
}

/** Why the public may not be shown this collection's documents, or undefined when it may (an `access.read` of `true` or a `Where`). */
export function collectionReadProblem(c: CollectionLike): string | undefined {
  if (c.access?.read === undefined) return "no access.read (Payload's default needs a login)"
  const a = askAnonymously(c.access.read)
  if (a.kind === 'threw') return 'access.read cannot be evaluated when the config is built (it threw with a stub request)'
  if (a.kind === 'async') return 'access.read is async and cannot be evaluated when the config is built'
  return a.value === true || (a.value !== null && typeof a.value === 'object')
    ? undefined
    : 'access.read does not let an anonymous request read it'
}

/** Why a field (or group, tab, row) cannot be drawn on a public card, or undefined. */
function blockOf(f: {
  name?: string
  hidden?: boolean
  admin?: { hidden?: boolean; disabled?: boolean }
  access?: { read?: unknown }
}): string | undefined {
  if (f.hidden === true || f.admin?.hidden === true) return 'hidden'
  if (f.admin?.disabled === true) return 'admin.disabled'
  if (typeof f.name === 'string' && f.name.startsWith('_')) return 'internal (named _...)'
  if (f.access?.read !== undefined) {
    const a = askAnonymously(f.access.read, { doc: undefined, siblingData: {} })
    if (a.kind === 'threw' || a.kind === 'async') return 'its access.read cannot be evaluated when the config is built'
    if (a.value !== true) return 'not publicly readable'
  }
  return undefined
}

/** The walk over the field tree (`internal/fields.ts`), with this module's reasons a field cannot be drawn on a public card. */
const flatFields = (fields: Field[] | undefined) => walk(fields, blockOf)

const fail = (msg: string): never => {
  throw new Error(`payload-og-image: ${msg}`)
}

const scalarText = (e: Entry) => (e.field.type === 'text' || e.field.type === 'textarea') && !e.field.hasMany

/** The entry a given path names, which must pass `kind`, and must not be blocked. */
function given(c: CollectionLike, what: string, path: string, kind: (e: Entry) => boolean, kindName: string): Entry {
  const e = flatFields(c.fields).find((x) => x.path === path)
  if (!e || !kind(e)) fail(`collection "${c.slug}": ${what} "${path}" is not ${kindName} of it`)
  const entry = e as Entry
  if (entry.blocked) fail(`collection "${c.slug}": ${what} "${path}" cannot be drawn on a public card (${entry.blocked})`)
  return entry
}

/** The collection's title field path: the option, else `admin.useAsTitle`, else `title`, else `name`. None is a start-up error naming the collection. */
export function titlePathOf(c: CollectionLike, path: string | undefined): string {
  if (path !== undefined) return given(c, 'title', path, scalarText, 'a text or textarea field').path
  const flat = flatFields(c.fields).filter(scalarText)
  const candidates = [c.admin?.useAsTitle, ...TITLE_NAMES].filter((n): n is string => typeof n === 'string')
  const found = candidates.find((n) => flat.some((e) => e.path === n && !e.blocked))
  if (found !== undefined) return found
  const skipped = candidates.flatMap((n) => flat.filter((e) => e.path === n && e.blocked).map((e) => `${n} is ${e.blocked}`))
  return fail(
    `collection "${c.slug}" has no title field the card can draw (looked for ${[...new Set(candidates)].join(', ')}${skipped.length ? `; skipped: ${skipped.join(', ')}` : ''}): name one with collections: [{ slug: '${c.slug}', title: '<field path>' }]`,
  )
}

/** The hero upload field: the option (`false`: never a photo), else the first single upload field named like a hero, else `meta.image`. */
export function heroOf(c: CollectionLike, path: string | false | undefined): { path: string; collection: string } | undefined {
  if (path === false) return undefined
  const mine = (e: Entry) => ({ path: e.path, collection: e.field.relationTo as string })
  if (path !== undefined) return mine(given(c, 'hero', path, singleUpload, 'a single upload field'))
  const uploads = flatFields(c.fields).filter((e) => singleUpload(e) && !e.blocked)
  for (const n of HERO_NAMES) {
    const hit = uploads.find((e) => e.path === n)
    if (hit) return mine(hit)
  }
  const meta = uploads.find((e) => e.path === 'meta.image')
  return meta ? mine(meta) : undefined
}

/** The collection's `meta.image` (plugin-seo's group), when it has one the public may read: the editor's own share image. */
export const hasSeoImage = (c: CollectionLike): boolean =>
  flatFields(c.fields).some((e) => e.path === 'meta.image' && singleUpload(e) && !e.blocked)

/** A text or textarea field path, checked. */
export function textPathOf(c: CollectionLike, what: string, path: string): string {
  return given(c, what, path, scalarText, 'a text or textarea field').path
}

/** The card's label: the option, else `labels.plural` (a string, `en`, or the first locale), else the slug. */
export function labelOf(c: CollectionLike, label: string | undefined): string {
  if (label !== undefined) return label
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

/** `slug` when the collection has a top-level scalar text `slug` field the public may read; else the path keys by `:id`. */
export const hasSlugField = (c: CollectionLike): boolean =>
  flatFields(c.fields).some((e) => e.path === 'slug' && scalarText(e) && !e.blocked)

/** Whether a field the preset READS from a document's `og` group (`og.headline`, `og.subtitle`) may be drawn: absent is fine (nobody can set it), present must pass the same rules. */
export const overrideAllowed = (c: CollectionLike, path: string): boolean =>
  flatFields(c.fields).every((e) => e.path !== path || !e.blocked)

/** The upload collection a field path points to (a single upload field), when it is one. */
export const uploadCollectionOf = (c: CollectionLike, path: string): string | undefined => {
  const e = flatFields(c.fields).find((x) => x.path === path && singleUpload(x))
  return e ? (e.field.relationTo as string) : undefined
}
