import type { Payload } from 'payload'
import type { DocSource } from '../internal/handler.js'
import type { OgState } from '../internal/state.js'
import type { SiteInfo } from '../internal/types.js'
import { orAbsent } from '../internal/uploads.js'
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

/**
 * Documents by id, the way every read behind a card is made: access-respecting (`overrideAccess: false`), and published only. A drafts-enabled
 * collection gets the `_status` predicate, so a draft-only document is never returned to the public; an editor previewing (`user`) sees the draft.
 * One find, whatever the number of ids. Only the documents found are returned. An error is thrown as it is: whether it means "no such readable
 * document" is the caller's to decide, through `orAbsent`.
 */
async function readMany(
  payload: Payload,
  collection: string,
  ids: Array<string | number>,
  user?: unknown,
): Promise<Array<Record<string, any>>> {
  if (ids.length === 0) return []
  const known = payload.collections as unknown as Record<string, { config?: { versions?: { drafts?: unknown } } } | undefined>
  const base = { collection, depth: 0, limit: ids.length, pagination: false, overrideAccess: false }
  const match = ids.length === 1 ? { id: { equals: ids[0] } } : { id: { in: ids } }
  const args = user
    ? { ...base, where: match, draft: true, user }
    : {
        ...base,
        where: known[collection]?.config?.versions?.drafts ? { and: [match, { _status: { equals: 'published' } }] } : match,
        draft: false,
      }
  return (await payload.find(args as unknown as FindArgs)).docs as Array<Record<string, any>>
}

/** One document by id (see `readMany`): null when it does not exist or the caller may not read it; any other error is thrown. */
export async function readRelated(
  payload: Payload,
  collection: string,
  id: string | number,
  user?: unknown,
): Promise<Record<string, any> | null> {
  return (await orAbsent(() => readMany(payload, collection, [id], user), []))[0] ?? null
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
  // A collection the caller may not read at all makes Payload throw `Forbidden`: that is no document (404), not a server error.
  const first = (args: FindArgs) => orAbsent(async () => ((await payload.find(args)).docs[0] ?? null) as Record<string, any> | null, null)
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
      first({
        ...buildFind(payload, name, targetOf(name), { slug }, seoPathOf(name)),
        draft: false,
        overrideAccess: false,
      } as FindArgs),
    publishedById: (name, id) =>
      first({
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
      return { docs: found.docs as Record<string, any>[], totalDocs: found.totalDocs }
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
      return first({ ...withoutStatus(found), draft: true, overrideAccess: false, user } as FindArgs)
    },
    async related(collection, id, { previewing, request }) {
      // An editor previewing sees the draft; everyone else the published document, and never a draft-only one.
      return readRelated(payload, collection, id, previewing && request ? await editor(request) : null)
    },
    async uploads(collection, ids, { previewing, request }) {
      const docs = await readMany(payload, collection, ids, previewing && request ? await editor(request) : null)
      // Keyed by the id the caller asked with: a record without an `id` is none of them.
      return new Map(docs.flatMap((d) => (d.id === undefined || d.id === null ? [] : [[String(d.id), d] as const])))
    },
    async site(request) {
      // Draft site data only for an authenticated editor: a draft-mode cookie alone must not draw draft text.
      const user = request ? await editor(request) : null
      if (user) return await o.site({ payload, draft: true, user })
      return cachedSite()
    },
  }
}
