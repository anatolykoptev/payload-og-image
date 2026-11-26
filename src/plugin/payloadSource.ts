import type { Payload } from 'payload'
import type { DocSource } from '../internal/handler.js'
import { uploadNeeds } from '../internal/needs.js'
import { pooled } from '../internal/pool.js'
import type { OgState } from '../internal/state.js'
import type { SiteInfo } from '../internal/types.js'
import type { Target } from '../template.js'

type FindArgs = Parameters<Payload['find']>[0]

/**
 * ONE query builder for the route and for the metadata helper, so both read the same document and the `v` a page
 * advertises is the route's etag. `select` is passed only when the target defines one: Payload then returns every
 * field, and a target that does not restrict itself never gets a half-empty document.
 */
export function buildFind(
  payload: Payload,
  name: string,
  target: Target,
  key: { slug: string } | { id: string | number },
  seoPath?: string,
): FindArgs {
  const collection = target.collection ?? name
  const slugField = target.slugField ?? 'slug'
  // Indexed loosely: a consumer's generated types narrow the collection keys, and this library must compile against any of them.
  const known = payload.collections as unknown as Record<string, { config?: { versions?: { drafts?: unknown } } } | undefined>
  const hasDrafts = Boolean(known?.[collection]?.config?.versions?.drafts)
  const match = 'slug' in key ? { [slugField]: { equals: key.slug } } : { id: { equals: key.id } }
  return {
    collection,
    // Depth 0, always: nothing is populated behind our back (`defaultPopulate` and `select` can hide the very `_status` a
    // filter would need, so a draft-only related document could leak). Uploads are read by id below; anything else a card
    // draws comes through `related()`.
    depth: 0,
    limit: 1,
    pagination: false,
    where: hasDrafts ? { and: [match, { _status: { equals: 'published' } }] } : match,
    // The slug field, the `og` group and the root of the editor's share-image field are always selected: without them
    // the resolver would drop the editor's chosen image or mode and fall through to a generated card.
    ...(target.select
      ? { select: { ...target.select, [slugField]: true, og: true, ...(seoPath ? { [seoPath.split('.')[0] as string]: true } : {}) } }
      : {}),
  } as FindArgs
}

/** One page of a target's published documents, by id: `buildFind`'s published-only rule over many, never a draft. */
export function buildList(
  payload: Payload,
  name: string,
  target: Target,
  a: { page: number; limit: number; alsoSelect?: string[] },
  seoPath?: string,
): FindArgs {
  const collection = target.collection ?? name
  const slugField = target.slugField ?? 'slug'
  const known = payload.collections as unknown as Record<string, { config?: { versions?: { drafts?: unknown } } } | undefined>
  const hasDrafts = Boolean(known?.[collection]?.config?.versions?.drafts)
  const extra = Object.fromEntries((a.alsoSelect ?? []).map((p) => [p.split('.')[0] as string, true]))
  return {
    collection,
    depth: 0,
    page: a.page,
    limit: a.limit,
    sort: 'id', // a stable order, so pages do not overlap or skip
    ...(hasDrafts ? { where: { _status: { equals: 'published' } } } : {}),
    ...(target.select
      ? {
          select: {
            ...target.select,
            ...extra,
            [slugField]: true,
            og: true,
            ...(seoPath ? { [seoPath.split('.')[0] as string]: true } : {}),
          },
        }
      : {}),
  } as FindArgs
}

/** The same query without the published-only filter: the latest draft of a drafts-enabled collection. */
function withoutStatus(args: FindArgs): FindArgs {
  const where = (args as { where: { and?: unknown[] } }).where
  return { ...args, where: where.and ? where.and[0] : where } as FindArgs
}

type Field = {
  type?: string
  name?: string
  relationTo?: unknown
  hasMany?: boolean
  fields?: Field[]
  tabs?: Array<{ fields?: Field[]; name?: string }>
}

/** Paths of the single-valued upload fields of a collection (a `hasMany` upload stays a list of bare ids: `resolveCard` reads the one a hero or named image takes) (top level, in groups, rows and tabs), with their upload collection. */
export function uploadFieldPaths(fields: Field[] | undefined, prefix: string[] = []): Array<{ path: string[]; relationTo: string }> {
  const found: Array<{ path: string[]; relationTo: string }> = []
  for (const f of fields ?? []) {
    if (f.type === 'upload' && f.name && typeof f.relationTo === 'string' && !f.hasMany)
      found.push({ path: [...prefix, f.name], relationTo: f.relationTo })
    else if (f.type === 'group' && f.name) found.push(...uploadFieldPaths(f.fields, [...prefix, f.name]))
    else if (f.type === 'tabs')
      for (const t of f.tabs ?? []) found.push(...uploadFieldPaths(t.fields, t.name ? [...prefix, t.name] : prefix))
    else if (!f.name && f.fields) found.push(...uploadFieldPaths(f.fields, prefix)) // a row or collapsible: no value of its own
  }
  return found
}

/**
 * One document by id, the way every read behind a card is made: access-respecting (`overrideAccess: false`), and published only. A
 * drafts-enabled collection gets the `_status` predicate, so a draft-only document is never returned to the public; an editor previewing
 * (`user`) sees the draft. Null when it does not exist or the caller may not read it.
 */
export async function readRelated(
  payload: Payload,
  collection: string,
  id: string | number,
  user?: unknown,
): Promise<Record<string, any> | null> {
  const known = payload.collections as unknown as Record<string, { config?: { versions?: { drafts?: unknown } } } | undefined>
  const base = { collection, depth: 0, limit: 1, pagination: false, overrideAccess: false }
  try {
    const match = { id: { equals: id } }
    const args = user
      ? { ...base, where: match, draft: true, user }
      : {
          ...base,
          where: known[collection]?.config?.versions?.drafts ? { and: [match, { _status: { equals: 'published' } }] } : match,
          draft: false,
        }
    return ((await payload.find(args as unknown as FindArgs)).docs[0] ?? null) as Record<string, any> | null
  } catch {
    return null // not readable by this caller
  }
}

/**
 * The doc was read at depth 0, so its upload fields are bare ids. The hero and the share image are uploads: read each by id with
 * `readRelated` (published only and the caller's access: `user` for an editor, none for the public) and put it in place. An upload that is
 * missing, draft-only or that the caller may not read becomes null. A value that is already an object (a document assembled from an
 * editor's form) is reduced to its id first, so it is read afresh and never trusted. `only` (dotted paths) limits which fields are read:
 * the others are left as bare ids (or null), never read.
 */
export async function populateUploads<T extends Record<string, any> | null>(
  payload: Payload,
  collection: string,
  doc: T,
  user?: unknown,
  only?: ReadonlySet<string>,
): Promise<T> {
  if (!doc) return doc
  const known = payload.collections as unknown as Record<string, { config?: { fields?: Field[] } } | undefined>
  for (const { path, relationTo } of uploadFieldPaths(known[collection]?.config?.fields)) {
    let holder: Record<string, any> | undefined = doc
    for (const key of path.slice(0, -1)) holder = holder?.[key] as Record<string, any> | undefined
    const field = path[path.length - 1] as string
    const raw = holder?.[field]
    const id = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : raw
    if (!holder) continue
    if (typeof id !== 'string' && typeof id !== 'number') {
      if (raw && typeof raw === 'object') holder[field] = null // an object with no usable id is no upload of ours
      continue
    }
    if (only && !only.has(path.join('.'))) {
      holder[field] = id // not drawn by this target: never read, and never an object nobody verified
      continue
    }
    holder[field] = await readRelated(payload, relationTo, id, user)
  }
  return doc
}

/**
 * Documents for the handler, from Payload. Published reads are `draft: false` AND `overrideAccess: false` (the
 * first means "published only" only together with the second). A draft is returned only to an authenticated
 * editor, and draft site data likewise.
 */
export function payloadSource(payload: Payload, state: OgState, cachedSite: () => Promise<SiteInfo>): DocSource {
  const o = state.options
  const targetOf = (name: string): Target => {
    if (!Object.hasOwn(o.targets, name)) throw new Error(`payload-og-image: no target "${name}"`)
    return o.targets[name] as Target
  }
  // The root of the editor's share-image field the read must always select: the target's own, else the plugin's.
  const seoPathOf = (name: string) => targetOf(name).seoImage?.path ?? o.seoImage?.path
  const first = async (args: FindArgs) => ((await payload.find(args)).docs[0] ?? null) as Record<string, any> | null
  // Only the upload fields the target draws (a preset says which; a hand-written target, whose resolvers are opaque, reads them all).
  const withUploads = <T extends Record<string, any> | null>(name: string, doc: T, user?: unknown) =>
    populateUploads(payload, targetOf(name).collection ?? name, doc, user, doc ? uploadNeeds.get(targetOf(name))?.(doc) : undefined)
  const readIn = async (name: string, args: FindArgs, user?: unknown) => withUploads(name, await first(args), user)
  // Editors: users of the admin user collection (or the configured auth collections), nobody else.
  const editorCollections = new Set(o.editors ?? [payload.config?.admin?.user ?? 'users'])
  const editor = async (request: Request) => {
    try {
      const user = (await payload.auth({ headers: request.headers })).user as { collection?: string } | null
      return user && typeof user.collection === 'string' && editorCollections.has(user.collection) ? user : null
    } catch {
      return null
    }
  }
  return {
    published: (name, slug) =>
      readIn(name, {
        ...buildFind(payload, name, targetOf(name), { slug }, seoPathOf(name)),
        draft: false,
        overrideAccess: false,
      } as FindArgs),
    publishedById: (name, id) =>
      readIn(name, {
        ...buildFind(payload, name, targetOf(name), { id }, seoPathOf(name)),
        draft: false,
        overrideAccess: false,
      } as FindArgs),
    async listPublished(name, a) {
      const found = await payload.find({
        ...buildList(payload, name, targetOf(name), a, seoPathOf(name)),
        draft: false,
        overrideAccess: false,
      } as FindArgs)
      // Each document reads its uploads by id: a few at a time, not a hundred at once.
      const docs = await pooled(found.docs as Record<string, any>[], 4, (d) => withUploads(name, d))
      return { docs, totalDocs: found.totalDocs }
    },
    async draft(name, key, request) {
      const user = await editor(request)
      if (!user) return null
      const found = buildFind(
        payload,
        name,
        targetOf(name),
        key.slug !== undefined ? { slug: key.slug } : { id: key.id as string | number },
        seoPathOf(name),
      )
      return readIn(name, { ...withoutStatus(found), draft: true, overrideAccess: false, user } as FindArgs, user)
    },
    async related(collection, id, { previewing, request }) {
      // An editor previewing sees the draft; everyone else the published document, and never a draft-only one.
      return readRelated(payload, collection, id, previewing && request ? await editor(request) : null)
    },
    async site(request) {
      // Draft site data only for an authenticated editor: a draft-mode cookie alone must not draw draft text.
      const user = request ? await editor(request) : null
      if (user) return await o.site({ payload, draft: true, user })
      return cachedSite()
    },
  }
}
