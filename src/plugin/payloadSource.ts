import type { Payload } from 'payload'
import type { DocSource } from '../internal/handler.js'
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
    depth: target.depth ?? 1,
    limit: 1,
    pagination: false,
    where: hasDrafts ? { and: [match, { _status: { equals: 'published' } }] } : match,
    // The slug field and the root of the editor's share-image field are always selected: without them the resolver
    // would drop the editor's chosen image and fall through to a generated card.
    ...(target.select
      ? { select: { ...target.select, [slugField]: true, ...(seoPath ? { [seoPath.split('.')[0] as string]: true } : {}) } }
      : {}),
  } as FindArgs
}

/** The same query without the published-only filter: the latest draft of a drafts-enabled collection. */
function withoutStatus(args: FindArgs): FindArgs {
  const where = (args as { where: { and?: unknown[] } }).where
  return { ...args, where: where.and ? where.and[0] : where } as FindArgs
}

/**
 * A published read must never surface a draft: related documents populated by `depth` are read without a published
 * filter, so any populated document that is not published (it carries `_status`) is replaced by its bare id. The root
 * document is already filtered by the query.
 */
export function withoutDraftRelations<T>(value: T, isRoot = true): T {
  if (Array.isArray(value)) return value.map((v) => withoutDraftRelations(v, false)) as T
  if (value === null || typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  if (!isRoot && typeof obj._status === 'string' && obj._status !== 'published') return (obj.id ?? null) as T
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, withoutDraftRelations(v, false)])) as T
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
  const first = async (args: FindArgs) => ((await payload.find(args)).docs[0] ?? null) as Record<string, any> | null
  const firstPublished = async (args: FindArgs) => {
    const doc = await first(args)
    return doc ? withoutDraftRelations(doc) : null
  }
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
      firstPublished({
        ...buildFind(payload, name, targetOf(name), { slug }, o.seoImage?.path),
        draft: false,
        overrideAccess: false,
      } as FindArgs),
    publishedById: (name, id) =>
      firstPublished({
        ...buildFind(payload, name, targetOf(name), { id }, o.seoImage?.path),
        draft: false,
        overrideAccess: false,
      } as FindArgs),
    async draft(name, key, request) {
      const user = await editor(request)
      if (!user) return null
      const found = buildFind(
        payload,
        name,
        targetOf(name),
        key.slug !== undefined ? { slug: key.slug } : { id: key.id as string | number },
        o.seoImage?.path,
      )
      return first({ ...withoutStatus(found), draft: true, overrideAccess: false, user } as FindArgs)
    },
    async site(request) {
      // Draft site data only for an authenticated editor: a draft-mode cookie alone must not draw draft text.
      const user = request ? await editor(request) : null
      if (user) return await o.site({ payload, draft: true, user })
      return cachedSite()
    },
  }
}
