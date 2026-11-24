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
export function buildFind(payload: Payload, name: string, target: Target, key: { slug: string } | { id: string | number }): FindArgs {
  const collection = target.collection ?? name
  const slugField = target.slugField ?? 'slug'
  const hasDrafts = Boolean(payload.collections?.[collection as never]?.config?.versions?.drafts)
  const match = 'slug' in key ? { [slugField]: { equals: key.slug } } : { id: { equals: key.id } }
  return {
    collection,
    depth: target.depth ?? 1,
    limit: 1,
    pagination: false,
    where: hasDrafts ? { and: [match, { _status: { equals: 'published' } }] } : match,
    ...(target.select ? { select: { ...target.select, [slugField]: true } } : {}),
  } as FindArgs
}

/** The same query without the published-only filter: the latest draft of a drafts-enabled collection. */
function withoutStatus(args: FindArgs): FindArgs {
  const where = (args as { where: { and?: unknown[] } }).where
  return { ...args, where: where.and ? where.and[0] : where } as FindArgs
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
  const editor = async (request: Request) => {
    try {
      return (await payload.auth({ headers: request.headers })).user ?? null
    } catch {
      return null
    }
  }
  return {
    published: (name, slug) =>
      first({ ...buildFind(payload, name, targetOf(name), { slug }), draft: false, overrideAccess: false } as FindArgs),
    publishedById: (name, id) =>
      first({ ...buildFind(payload, name, targetOf(name), { id }), draft: false, overrideAccess: false } as FindArgs),
    async draft(name, key, request) {
      const user = await editor(request)
      if (!user) return null
      const found = buildFind(
        payload,
        name,
        targetOf(name),
        key.slug !== undefined ? { slug: key.slug } : { id: key.id as string | number },
      )
      return first({ ...withoutStatus(found), draft: true, overrideAccess: false, user } as FindArgs)
    },
    async site(request) {
      // Draft site data only for an authenticated editor: a draft-mode cookie alone must not draw draft text.
      if (request && (await editor(request))) return await o.site({ payload, draft: true })
      return cachedSite()
    },
  }
}
