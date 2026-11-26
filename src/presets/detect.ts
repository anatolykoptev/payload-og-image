// Reads a collection's config to find what a preset card draws. Pure functions of the (unsanitized) collection config.
//
// A preset draws a published document to the PUBLIC, so only a field the public may read is a candidate (plan §9, applied to what is
// auto-detected): not `hidden`, `admin.hidden` or `admin.disabled`, not under such an ancestor, not named `_...`, and, with an `access.read`, only
// one that says `true` to an anonymous request when the config is built. Only scalar fields qualify: a `hasMany` text is an array.

type Field = {
  type?: string
  name?: string
  fields?: Field[]
  tabs?: Array<{ fields?: Field[]; name?: string }>
  relationTo?: unknown
  hasMany?: boolean
  hidden?: boolean
  admin?: { hidden?: boolean; disabled?: boolean }
  access?: { read?: unknown }
}
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

/** What an access function is asked with at config time: nobody signed in. */
const ANONYMOUS = { user: null, headers: new Headers() }

/** The answer of an `access.read`-style function for an anonymous request, or `undefined` when it throws or is not synchronous. */
function askAnonymously(fn: unknown, extra: Record<string, unknown> = {}): unknown {
  if (typeof fn !== 'function') return undefined
  try {
    const answer = (fn as (a: unknown) => unknown)({ req: ANONYMOUS, ...extra })
    return answer !== null && typeof answer === 'object' && typeof (answer as { then?: unknown }).then === 'function' ? undefined : answer
  } catch {
    return undefined
  }
}

/** Why the public may not be shown this collection's documents, or undefined when it may (an `access.read` of `true` or a `Where`). */
export function collectionReadProblem(c: CollectionLike): string | undefined {
  if (c.access?.read === undefined) return "no access.read (Payload's default needs a login)"
  const answer = askAnonymously(c.access.read)
  if (answer === true || (answer !== null && typeof answer === 'object')) return undefined
  return 'access.read does not let an anonymous request read it'
}

/** Why a field (or group) cannot be drawn on a public card, or undefined. */
function blockOf(f: Field): string | undefined {
  if (f.hidden === true || f.admin?.hidden === true) return 'hidden'
  if (f.admin?.disabled === true) return 'admin.disabled'
  if (typeof f.name === 'string' && f.name.startsWith('_')) return 'internal (named _...)'
  if (f.access?.read !== undefined && askAnonymously(f.access.read, { doc: undefined, siblingData: {} }) !== true)
    return 'not publicly readable'
  return undefined
}

type Entry = { path: string; field: Field; blocked?: string }

/** Every named leaf field with its dotted path, through groups, tabs, rows and collapsibles; `blocked` is why it cannot be drawn (its own or an ancestor's). */
export function flatFields(fields: Field[] | undefined, prefix: string[] = [], blocked?: string): Entry[] {
  const out: Entry[] = []
  for (const f of fields ?? []) {
    const own = blocked ?? blockOf(f)
    if (f.type === 'group' && f.name) out.push(...flatFields(f.fields, [...prefix, f.name], own))
    else if (f.type === 'tabs')
      for (const t of f.tabs ?? []) out.push(...flatFields(t.fields, t.name ? [...prefix, t.name] : prefix, blocked))
    else if (!f.name && f.fields) out.push(...flatFields(f.fields, prefix, blocked))
    else if (f.name) out.push({ path: [...prefix, f.name].join('.'), field: f, ...(own ? { blocked: own } : {}) })
  }
  return out
}

const fail = (msg: string): never => {
  throw new Error(`payload-og-image: ${msg}`)
}

const scalarText = (e: Entry) => (e.field.type === 'text' || e.field.type === 'textarea') && !e.field.hasMany
const singleUpload = (e: Entry) => e.field.type === 'upload' && typeof e.field.relationTo === 'string' && !e.field.hasMany

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
