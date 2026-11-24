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

/** Paths of the single-valued upload fields of a collection (top level, in groups, rows and tabs), with their upload collection. */
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
  const known = payload.collections as unknown as Record<
    string,
    { config?: { fields?: Field[]; versions?: { drafts?: unknown } } } | undefined
  >
  /**
   * The doc was read at depth 0, so its upload fields are bare ids. The hero and the share image are uploads, which have no
   * drafts: read each by id, with the caller's access (`user` for an editor, none for the public), and put it in place. An
   * upload that is missing or that the caller may not read becomes null.
   */
  const withUploads = async <T extends Record<string, any> | null>(collection: string, doc: T, user?: unknown): Promise<T> => {
    if (!doc) return doc
    for (const { path, relationTo } of uploadFieldPaths(known[collection]?.config?.fields)) {
      let holder: Record<string, any> | undefined = doc
      for (const key of path.slice(0, -1)) holder = holder?.[key] as Record<string, any> | undefined
      const field = path[path.length - 1] as string
      const id = holder?.[field]
      if (!holder || (typeof id !== 'string' && typeof id !== 'number')) continue
      holder[field] = await payload
        .findByID({ collection: relationTo as never, id, depth: 0, overrideAccess: false, ...(user ? { user } : {}) } as never)
        .catch(() => null)
    }
    return doc
  }
  const readIn = async (collection: string, args: FindArgs, user?: unknown) => withUploads(collection, await first(args), user)
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
      readIn(targetOf(name).collection ?? name, {
        ...buildFind(payload, name, targetOf(name), { slug }, o.seoImage?.path),
        draft: false,
        overrideAccess: false,
      } as FindArgs),
    publishedById: (name, id) =>
      readIn(targetOf(name).collection ?? name, {
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
      return readIn(
        targetOf(name).collection ?? name,
        { ...withoutStatus(found), draft: true, overrideAccess: false, user } as FindArgs,
        user,
      )
    },
    async related(collection, id, { previewing, request }) {
      const user = previewing && request ? await editor(request) : null
      const base = { collection, depth: 0, limit: 1, pagination: false, overrideAccess: false }
      try {
        // An editor previewing sees the draft; everyone else the published document, and never a draft-only one.
        if (user) return await first({ ...base, where: { id: { equals: id } }, draft: true, user } as FindArgs)
        const hasDrafts = Boolean(known[collection]?.config?.versions?.drafts)
        const match = { id: { equals: id } }
        return await first({
          ...base,
          where: hasDrafts ? { and: [match, { _status: { equals: 'published' } }] } : match,
          draft: false,
        } as FindArgs)
      } catch {
        return null // not readable by this caller
      }
    },
    async site(request) {
      // Draft site data only for an authenticated editor: a draft-mode cookie alone must not draw draft text.
      const user = request ? await editor(request) : null
      if (user) return await o.site({ payload, draft: true, user })
      return cachedSite()
    },
  }
}
