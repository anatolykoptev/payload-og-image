import type { StaticCard } from '../template.js'
import { isKind, register } from './errorKinds.js'
import type { Gate } from './gate.js'
import type { CardHandler, DocSource, HeroLoader } from './handler.js'
import { pooled } from './pool.js'
import { type GeneratedCard, getPath, type ResolvedCard } from './resolve.js'
import type { CardMime, CardStore, Upload } from './types.js'

/** What a card is asked for: a document of a target (by id or by the slug field), or a static card by its key (`kind/slug`). */
export type CardRef = { target: string; id?: string | number; slug?: string } | { static: string }

export type HeroReport = {
  id: string | number
  filename: string | null
  /** The card shows through the hero (it has a see-through pixel and nothing flattens it). */
  transparent: boolean
  /** The colour the hero is flattened onto, or null when nothing flattens it. */
  ground: string | null
  /** Whether the hero's file can be read: null when it was not asked. */
  readable: boolean | null
}

export type CardReport =
  | { found: false; reason: string }
  | {
      found: true
      scope: string
      kind: 'generated' | 'own' | 'none'
      slug?: string
      /** A generated card. */
      card?: {
        url: string
        v: string
        pageId: string
        template: string
        alt: string
        size: { width: number; height: number }
        type: CardMime
      }
      /** The page shares this image instead of a generated card. */
      shares?: { url: string; alt?: string }
      stored: { bytes: number } | null
      hero: HeroReport | null
      /** Why there is nothing, or why the card is not what a page would expect. Absent when the card is generated and stored. */
      reason?: string
    }

export type AuditRow = {
  id: string | number | null
  slug: string | null
  kind: 'generated' | 'own' | 'none'
  url: string | null
  v: string | null
  stored: boolean
  bytes: number | null
  hero: HeroReport | null
  /** A hero that cannot be read: the card would be drawn without it and never stored. Null when heroes were not checked. */
  downgraded: boolean | null
  /** Whether the document has text at the configured field path; absent when no path is configured. */
  hasDescription?: boolean
}

export type AuditPage = {
  scope: string
  page: number
  limit: number
  total: number
  hasNext: boolean
  summary: { rows: number; generated: number; stored: number; notStored: number; downgraded: number | null; missingDescription?: number }
  rows: AuditRow[]
}

export type ServeResult =
  | { status: 'png'; bytes: Uint8Array; type: CardMime; v: string; source: string; url: string; stored: boolean }
  | { status: 'shed'; retryAfter: string | null }
  | { status: 'not_found' | 'no_card'; reason: string }
  | { status: 'error'; httpStatus: number }

const CARD_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

export type Inspector = {
  scopes(): Promise<Array<{ scope: string; kind: 'target' | 'static'; total: number }>>
  card(a: CardRef): Promise<CardReport>
  audit(a: { scope: string; page: number; limit: number; describedBy?: string; checkHeroes?: boolean }): Promise<AuditPage>
  serve(a: CardRef): Promise<ServeResult>
  /** The card a pathname is the route of (`/og/posts/a/card.png`), or null: only the plugin's own card paths, never a page path. */
  locate(pathname: string): CardRef | null
}

/** An input the caller can fix: its message is safe to show a tool's user. Any other error is the server's. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
    register(this, 'input')
  }
}
/** True for a `ToolInputError` built by any copy of this module, and for nothing else. */
export const isToolInputError = (e: unknown): e is ToolInputError => isKind(e, 'input')

export type InspectorDeps = {
  /** Bounds the work an inspector does at once (document reads, hero reads, resolution): a full queue is a `ShedError`. Separate from the render gate. */
  gate: Gate
  targets: Record<string, unknown>
  statics: Record<string, StaticCard>
  source: DocSource
  store: CardStore
  heroLoader: HeroLoader
  /** Resolves with published data only (`previewing: false`) and serves through the normal gate, memo and store. */
  handler: CardHandler
}

const STATIC = 'static'
const POOL = 4

const uploadId = (u: Upload) => u.id

/**
 * Read-only views of cards for tools: every read is published-only (`previewing: false`, no editor, no request), nothing is
 * rendered except through `serve`, which is the route's own path (gate, memo, versioned store key).
 */
export function createInspector(d: InspectorDeps): Inspector {
  const staticList = Object.values(d.statics)
  const hasTarget = (name: string) => Object.hasOwn(d.targets, name)

  const heroReport = async (card: GeneratedCard, collection: string | undefined, check: boolean): Promise<HeroReport | null> => {
    const hero = card.hero
    if (!hero) return null
    let readable: boolean | null = null
    if (check && d.heroLoader.readable) readable = await d.heroLoader.readable(hero, { collection })
    return {
      id: uploadId(hero),
      filename: typeof hero.filename === 'string' ? hero.filename : null,
      transparent: card.heroTransparent,
      ground: card.heroGround ?? null,
      readable,
    }
  }

  async function resolveRef(a: CardRef): Promise<{ scope: string; card: ResolvedCard; doc: Record<string, any> } | { reason: string }> {
    if ('static' in a) {
      const card = staticList.find((c) => `${c.kind}/${c.slug}` === a.static)
      if (!card) return { reason: `no static card "${a.static}"` }
      return { scope: STATIC, card: await d.handler.resolve({ staticKey: a.static }, { previewing: false }), doc: { slug: card.slug } }
    }
    if (!hasTarget(a.target)) return { reason: `no target "${a.target}" (targets: ${Object.keys(d.targets).join(', ')})` }
    if (a.id === undefined && a.slug === undefined) return { reason: 'give an id or a slug' }
    const doc = a.id !== undefined ? await d.source.publishedById(a.target, a.id) : await d.source.published(a.target, a.slug as string)
    if (!doc) return { reason: 'no published document' } // a draft-only document is exactly this: the public cannot see it
    return { scope: a.target, card: await d.handler.resolve({ target: a.target, doc }, { previewing: false }), doc }
  }

  const collectionOf = (scope: string) =>
    scope === STATIC ? undefined : ((d.targets[scope] as { heroCollection?: string }).heroCollection ?? undefined)

  async function describe(scope: string, card: ResolvedCard, check: boolean): Promise<Omit<AuditRow, 'id' | 'slug' | 'hasDescription'>> {
    if (card.kind === 'generated') {
      const stat = await d.store.stat(card.pageId, card.v, card.encoding.format)
      const hero = await heroReport(card, collectionOf(scope), check)
      return {
        kind: 'generated',
        url: card.url,
        v: card.v,
        stored: stat !== null,
        bytes: stat?.bytes ?? null,
        hero,
        downgraded: hero && hero.readable !== null ? !hero.readable : check ? false : null,
      }
    }
    return {
      kind: card.kind,
      url: card.kind === 'own' ? card.image.url : null,
      v: null,
      stored: false,
      bytes: null,
      hero: null,
      downgraded: null,
    }
  }

  /** A route pattern (`/og/:kind/:slug/card.png`) against a pathname: the named segments, or null. */
  const matchPath = (pattern: string, pathname: string): Record<string, string> | null => {
    const want = pattern.split('/')
    const got = pathname.split('/')
    if (want.length !== got.length) return null
    const out: Record<string, string> = {}
    for (const [i, w] of want.entries()) {
      const g = got[i] as string
      if (w.startsWith(':')) {
        if (g === '') return null
        try {
          out[w.slice(1)] = decodeURIComponent(g)
        } catch {
          return null
        }
      } else if (/:ext\b/.test(w)) {
        // A file name with `:ext` (`card.:ext`): the literal around it, then any card extension. Which one a card really has is the route's check.
        const [head = '', tail = ''] = w.split(/:ext\b/)
        const m = g.startsWith(head) && g.endsWith(tail) ? g.slice(head.length, g.length - tail.length) : ''
        if (!CARD_EXTENSIONS.includes(m)) return null
      } else if (w !== g) return null
    }
    return out
  }

  const raw: Inspector = {
    locate(pathname) {
      for (const c of staticList) if (c.path === pathname) return { static: `${c.kind}/${c.slug}` }
      for (const [name, raw] of Object.entries(d.targets)) {
        const t = raw as { path: string; kind?: string; slugField?: string }
        const m = matchPath(t.path, pathname)
        if (!m) continue
        if ('kind' in m && m.kind !== (t.kind ?? name)) continue
        if (m.slug !== undefined) return { target: name, slug: m.slug }
        // `:id` in a card path carries the same key as `:slug` (the route reads `slug ?? id` and looks the document up by its slug field).
        if (m.id !== undefined) return { target: name, slug: m.id }
      }
      return null
    },

    async scopes() {
      const out: Array<{ scope: string; kind: 'target' | 'static'; total: number }> = []
      for (const name of Object.keys(d.targets)) {
        const total = d.source.listPublished ? (await d.source.listPublished(name, { page: 1, limit: 1 })).totalDocs : 0
        out.push({ scope: name, kind: 'target', total })
      }
      if (staticList.length > 0) out.push({ scope: STATIC, kind: 'static', total: staticList.length })
      return out
    },

    async card(a) {
      const r = await resolveRef(a)
      if ('reason' in r) return { found: false, reason: r.reason }
      const { scope, card } = r
      const row = await describe(scope, card, true)
      if (card.kind === 'none')
        return {
          found: true,
          scope,
          kind: 'none',
          stored: null,
          hero: null,
          reason: 'no card: the document is off, has no usable slug or title, or the template says it would be blank',
        }
      if (card.kind === 'own')
        return {
          found: true,
          scope,
          kind: 'own',
          shares: { url: card.image.url, alt: card.image.alt },
          stored: null,
          hero: null,
          reason: 'the page shares an image instead of a generated card',
        }
      const stored = row.bytes === null ? null : { bytes: row.bytes }
      const reason = row.downgraded
        ? 'hero_unreadable: the card is drawn without its hero, served briefly and never stored'
        : stored
          ? undefined
          : 'not_stored: no request has drawn this version yet (or it was pruned)'
      return {
        found: true,
        scope,
        kind: 'generated',
        slug: card.key.slug,
        card: {
          url: card.url,
          v: card.v,
          pageId: card.pageId,
          template: card.template.id,
          alt: card.alt,
          size: card.size,
          type: card.type,
        },
        stored,
        hero: row.hero,
        ...(reason ? { reason } : {}),
      }
    },

    async audit({ scope, page, limit, describedBy, checkHeroes = false }) {
      let docs: Record<string, any>[]
      let total: number
      if (scope === STATIC) {
        total = staticList.length
        docs = staticList.slice((page - 1) * limit, page * limit).map((c) => ({ slug: c.slug, _static: `${c.kind}/${c.slug}` }))
      } else {
        if (!hasTarget(scope))
          throw new ToolInputError(
            `no scope "${scope}" (targets: ${Object.keys(d.targets).join(', ')}${staticList.length ? `, ${STATIC}` : ''})`,
          )
        if (!d.source.listPublished) throw new ToolInputError('this document source cannot list documents')
        const found = await d.source.listPublished(scope, { page, limit, alsoSelect: describedBy ? [describedBy] : [] })
        docs = found.docs
        total = found.totalDocs
      }
      const rows = await pooled(docs, POOL, async (doc): Promise<AuditRow> => {
        const card =
          typeof doc._static === 'string'
            ? await d.handler.resolve({ staticKey: doc._static }, { previewing: false })
            : await d.handler.resolve({ target: scope, doc }, { previewing: false })
        const base = await describe(scope, card, checkHeroes)
        const slug = scope === STATIC ? doc.slug : getPath(doc, (d.targets[scope] as { slugField?: string }).slugField ?? 'slug')
        const row: AuditRow = {
          id: doc.id ?? null,
          slug: typeof slug === 'string' || typeof slug === 'number' ? String(slug) : null,
          ...base,
        }
        if (describedBy && scope !== STATIC) {
          const text = getPath(doc, describedBy)
          row.hasDescription = typeof text === 'string' && text.trim() !== ''
        }
        return row
      })
      const stored = rows.filter((r) => r.stored).length
      return {
        scope,
        page,
        limit,
        total,
        hasNext: page * limit < total,
        summary: {
          rows: rows.length,
          generated: rows.filter((r) => r.kind === 'generated').length,
          stored,
          notStored: rows.filter((r) => r.kind === 'generated').length - stored,
          downgraded: checkHeroes ? rows.filter((r) => r.downgraded).length : null,
          ...(describedBy && scope !== STATIC ? { missingDescription: rows.filter((r) => r.hasDescription === false).length } : {}),
        },
        rows,
      }
    },

    async serve(a) {
      const r = await d.gate.run(() => resolveRef(a)) // the lookup and the resolution are bounded like an audit's; the draw is the route's
      if ('reason' in r) return { status: 'not_found', reason: r.reason }
      const { card } = r
      if (card.kind !== 'generated')
        return {
          status: 'no_card',
          reason: card.kind === 'own' ? 'the page shares an image instead of a generated card' : 'no card for this document',
        }
      const before = await d.store.stat(card.pageId, card.v, card.encoding.format)
      // The route's own path: gate and admission, the memo, the store read, and a write under `pageId` and the version only.
      const res = await d.handler.GET(new Request(card.url), { params: Promise.resolve({ kind: card.key.kind, slug: card.key.slug }) })
      if (res.status === 503) return { status: 'shed', retryAfter: res.headers.get('retry-after') }
      if (res.status === 404) return { status: 'not_found', reason: 'the route answered 404 for this card' }
      if (res.status !== 200) return { status: 'error', httpStatus: res.status }
      return {
        status: 'png',
        bytes: new Uint8Array(await res.arrayBuffer()),
        type: card.type,
        v: card.v,
        source: res.headers.get('x-og-cache') ?? 'unknown',
        url: card.url,
        stored: before !== null,
      }
    },
  }
  // One slot per call: concurrent audits queue briefly and then shed, so a caller holding a key cannot open unbounded reads.
  return {
    ...raw,
    scopes: () => d.gate.run(() => raw.scopes()),
    card: (a) => d.gate.run(() => raw.card(a)),
    audit: (a) => d.gate.run(() => raw.audit(a)),
  }
}
