import type { Payload } from 'payload'
import sharp from 'sharp'
import type { HeroLoader, Renderer, RouteContext } from '../internal/handler.js'
import { cardPaletteOf } from '../internal/palette.js'
import { buildRuntime, type OgRuntime, setTestRuntime } from '../internal/runtime.js'
import { createState, type OgState } from '../internal/state.js'
import { memoryStore } from '../internal/store/memory.js'
import type { CardStore } from '../internal/types.js'
import type { OgImagePluginOptions } from '../plugin/index.js'
import { payloadSource } from '../plugin/payloadSource.js'
import { nextOgRenderer } from '../render/nextOg.js'

export type KitDocs = {
  published: Record<string, Record<string, any>[]>
  drafts?: Record<string, Record<string, any>[]>
  globals?: Record<string, Record<string, any>>
}

/** What the kit needs of the installed runtime. */
export type TestRuntimeHandle = { handler(fixedTarget?: string): { GET(r: Request, c: RouteContext): Promise<Response> } }

export type TestRuntime = {
  readonly options: OgImagePluginOptions
  readonly docs: KitDocs
  readonly serverUrl: string
  /** `real` draws with next/og; `stub` draws a tiny PNG of the element's JSON (fast, but its size says nothing about a real card). */
  readonly rendererKind: 'real' | 'stub'
  setGlobal(slug: string, data: Record<string, any>): void
  setDoc(target: string, doc: Record<string, any>): void
  /**
   * Draft mode on or off, and whether requests carry an authenticated editor. The editor is a real credential the production
   * `payloadSource` checks (`payload.auth`, the admin user collection): the kit adds it through `requestHeaders()`.
   */
  draftMode(on: boolean, editor?: boolean): void
  /** Headers every request the kit (or a page) makes carries in the current mode: the editor credential, or none. */
  requestHeaders(): Record<string, string>
  /** How many times the renderer ran since the last reset. */
  renders(): number
  /** How many times a hero was prepared since the last reset. */
  heroLoads(): number
  /** `[pageId, v]` of every card put in the store since the last reset. */
  stored(): Array<{ pageId: string; v: string }>
  /** How many times the store was read since the last reset. */
  storeReads(): number
  /** The render gate's current occupancy (to know when it is full without sleeping). */
  gateStats(): { active: number; waiting: number }
  /** Forget the memo but keep the store (what a restart does to a process while the volume survives). */
  clearMemo(): void
  /** Forget memo AND store, keeping counters and draft mode: the next card is drawn from the current documents. */
  clearCaches(): void
  /** Forget memo, store, counters and draft mode. */
  reset(): void
  /** Make renders wait until `release()` (to fill the queue deterministically). */
  holdRenders(): () => void
  /** The route's handler, for the kit's own requests. */
  readonly runtime: TestRuntimeHandle
}

export type TestRuntimeOptions = {
  renderer?: 'real' | 'stub'
  serverUrl?: string
  /**
   * Which stand-in heroes count as having a see-through pixel (default none: every stand-in is an opaque image). A card with a
   * transparent hero and no `heroBackground` has a different URL from an opaque one, and only the kit can see that when it is set.
   */
  transparentHero?: (hero: { id: string | number; filename?: string | null; updatedAt?: string | null }) => boolean
}

const EDITOR_AUTH = 'JWT kit-editor'

/**
 * Installs a runtime built exactly like production's (same handler, resolver, gate, memo, and the same `payloadSource`:
 * its editor check, published-only reads and cached `site()`) over in-memory documents served by a small fake Payload, a
 * recording memory store and either the real renderer or a stub that draws the element's JSON.
 *
 * A hero whose `filename` starts with `missing` cannot be read (how a fixture models a missing upload file); any other hero
 * is a small image whose colour depends on its id and `updatedAt`, so replacing a hero changes the card's pixels.
 */
export function installTestRuntime(options: OgImagePluginOptions, docs: KitDocs, o: TestRuntimeOptions = {}): TestRuntime {
  const serverUrl = o.serverUrl ?? 'https://example.test'
  let state: OgState
  let memoryOnly: CardStore
  let store: CardStore
  let renders = 0
  let heroLoads = 0
  let storeReads = 0
  let puts: Array<{ pageId: string; v: string }> = []
  let draft = { on: false, editor: false }
  let hold: Promise<void> | undefined
  let runtime: OgRuntime

  const targetOfCollection = (collection: string) =>
    Object.entries(options.targets).find(([name, t]) => (t.collection ?? name) === collection)?.[0] ?? collection

  const editorCollection = options.editors?.[0] ?? 'users'
  const sameDoc = (a: Record<string, any>, b: Record<string, any>) => String(a.id) === String(b.id)
  /**
   * The main collection table as Payload holds it for a drafts-enabled collection: published documents (`_status: published`)
   * and documents that were never published (`_status: draft`). `draft: true` reads the latest version, so a draft replaces its
   * published document. Only the production query's own `where` decides what a public read may see.
   */
  const table = (name: string, latest: boolean) => {
    const published = (docs.published[name] ?? []).map((d) => ({ ...d, _status: 'published' }))
    const drafts = docs.drafts?.[name] ?? []
    const main = [...published, ...drafts.filter((d) => !published.some((p) => sameDoc(p, d))).map((d) => ({ ...d, _status: 'draft' }))]
    return latest
      ? main.map((m) => ({ ...(drafts.find((d) => sameDoc(d, m)) ?? m), _status: drafts.some((d) => sameDoc(d, m)) ? 'draft' : m._status }))
      : main
  }
  /** The `where` shapes the production source sends: `and`, and `equals` on one field. Anything else fails loudly. */
  const matches = (where: any, doc: Record<string, any>): boolean => {
    if (where && typeof where === 'object' && Array.isArray(where.and)) return where.and.every((w: unknown) => matches(w, doc))
    const entries = Object.entries(where ?? {})
    const [field, cond] = entries[0] as [string, any]
    if (entries.length !== 1 || !cond || typeof cond !== 'object' || Object.keys(cond).join() !== 'equals') {
      throw new Error(`payload-og-image test runtime: unsupported where clause ${JSON.stringify(where)}`)
    }
    return String(doc[field]) === String(cond.equals)
  }

  // The parts of Payload the production source touches: auth, find (the table above), collections, findGlobal.
  const fakePayload = {
    // `globals` as Payload lists them: a site's `site()` often asks which of its globals have drafts.
    config: { admin: { user: options.editors?.[0] ?? 'users' }, globals: Object.keys(docs.globals ?? {}).map((slug) => ({ slug })) },
    collections: Object.fromEntries(
      Object.entries(options.targets).map(([name, t]) => [t.collection ?? name, { config: { versions: { drafts: true } } }]),
    ),
    findGlobal: async ({ slug }: { slug: string }) => structuredClone(docs.globals?.[slug] ?? {}),
    auth: async ({ headers }: { headers: Headers }) => ({
      user: headers.get('authorization') === EDITOR_AUTH ? { id: 1, collection: editorCollection } : null,
    }),
    find: async (args: { collection: string; where: unknown; draft?: boolean }) => {
      const name = targetOfCollection(args.collection)
      const found = table(name, args.draft === true).filter((d) => matches(args.where, d))
      return { docs: found.slice(0, 1).map((d) => structuredClone(d)) }
    },
  } as unknown as Payload
  const inner: Renderer =
    o.renderer === 'real'
      ? nextOgRenderer({ palette: cardPaletteOf(options.palette) })
      : {
          // The stub draws the element's JSON: any change to what a template would draw changes the bytes.
          render: async (el) =>
            new Uint8Array(
              await sharp({ create: { width: 8, height: 8, channels: 3, background: colourOf(JSON.stringify(el)) } })
                .png()
                .toBuffer(),
            ),
        }
  const renderer: Renderer = {
    async render(el, a) {
      renders += 1
      await hold
      return inner.render(el, a)
    },
  }
  const heroImages = new Map<string, string>()
  const heroLoader: HeroLoader = async (hero) => {
    heroLoads += 1
    if (typeof hero.filename === 'string' && hero.filename.startsWith('missing')) return null
    const tag = `${String(hero.id)}:${hero.updatedAt ?? ''}`
    let url = heroImages.get(tag)
    if (!url) {
      const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: colourOf(tag) } })
        .png()
        .toBuffer()
      url = `data:image/png;base64,${png.toString('base64')}`
      heroImages.set(tag, url)
    }
    return url
  }
  heroLoader.hasAlpha = async (hero) => o.transparentHero?.(hero) === true

  const build = (keepStore: boolean) => {
    state = createState(options, serverUrl)
    if (!keepStore) {
      memoryOnly = memoryStore()
      store = {
        async get(p, v) {
          storeReads += 1
          return memoryOnly.get(p, v)
        },
        async put(p, v, b) {
          puts.push({ pageId: p, v })
          await memoryOnly.put(p, v, b)
        },
      }
    }
    const current = state
    runtime = buildRuntime(current, fakePayload, {
      source: payloadSource(fakePayload, current, () => (current.siteCache as NonNullable<OgState['siteCache']>).get()),
      store,
      renderer,
      heroLoader,
      isDraftRequest: async () => draft.on,
      requestForPage: async () => new Request(serverUrl, { headers: rt.requestHeaders() }),
    })
    setTestRuntime(runtime)
  }

  const rt: TestRuntime = {
    options,
    docs,
    serverUrl,
    rendererKind: o.renderer === 'real' ? 'real' : 'stub',
    get runtime() {
      return runtime
    },
    setGlobal(slug, data) {
      docs.globals = { ...docs.globals, [slug]: data }
      // What the `afterChange` hook on a site global does in production.
      if ((options.siteGlobals ?? []).includes(slug)) state.invalidateSite()
    },
    setDoc(target, doc) {
      docs.published[target] ??= []
      const list = docs.published[target] as Record<string, any>[]
      const at = list.findIndex((d) => String(d.id) === String(doc.id))
      if (at >= 0) list[at] = doc
      else list.push(doc)
    },
    draftMode(on, editor = false) {
      draft = { on, editor }
    },
    requestHeaders: (): Record<string, string> => (draft.editor ? { authorization: EDITOR_AUTH } : {}),
    renders: () => renders,
    heroLoads: () => heroLoads,
    stored: () => [...puts],
    storeReads: () => storeReads,
    gateStats: () => state.gate.stats(),
    clearMemo: () => build(true),
    clearCaches: () => build(false),
    reset() {
      renders = 0
      heroLoads = 0
      storeReads = 0
      puts = []
      draft = { on: false, editor: false }
      hold = undefined
      build(false)
    },
    holdRenders() {
      let release!: () => void
      hold = new Promise<void>((r) => {
        release = r
      })
      return () => {
        release()
        hold = undefined
      }
    },
  }
  build(false)
  return rt
}

const colourOf = (text: string) => {
  let h = 7
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return { r: h & 255, g: (h >> 8) & 255, b: (h >> 16) & 255 }
}
