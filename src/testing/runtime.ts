import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Payload } from 'payload'
import sharp from 'sharp'
import type { HeroLoader, Renderer, RouteContext } from '../internal/handler.js'
import { cardPaletteOf } from '../internal/palette.js'
import { buildRuntime, heroLoaderOptionsOf, type OgRuntime, setTestRuntime } from '../internal/runtime.js'
import { createState, type OgState } from '../internal/state.js'
import { memoryStore } from '../internal/store/memory.js'
import type { CardStore } from '../internal/types.js'
import { withVariants } from '../internal/variants.js'
import type { OgImagePluginOptions } from '../plugin/index.js'
import { payloadSource } from '../plugin/payloadSource.js'
import { payloadHeroLoader } from '../render/hero.js'
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
  /**
   * A folder of real hero files. A hero whose `filename` is a file in it is prepared by the production hero loader (the same
   * cut, `heroBackground` and `palette.hero` the plugin's options say), so a card with a real icon is drawn as it will be. Any
   * other hero stays the small stand-in image; a `missing...` filename is still unreadable.
   */
  heroDir?: string
  /**
   * The site's upload collections, by slug then id, for a kit whose documents hold bare ids or whose uploads must differ by collection. A
   * `_status: 'draft'` entry is a draft-only upload: a public read never sees it. A collection not listed holds nothing; without this option the stand-in upload objects inside the documents are used.
   * Naming a target's collection, or an entry whose `id` is not its key, throws; an entry with no `id` takes its key.
   */
  uploads?: Record<string, Record<string | number, Record<string, unknown>>>
}

const EDITOR_AUTH = 'JWT kit-editor'
/** The stand-in upload collection of a kit with no modelled `uploads`: not a name a site would pick. */
const KIT_UPLOADS = 'og-kit-uploads'

/**
 * Installs a runtime built exactly like production's (same handler, resolver, gate, memo, and the same `payloadSource`:
 * its editor check, published-only reads and cached `site()`) over in-memory documents served by a small fake Payload, a
 * recording memory store and either the real renderer or a stub that draws the element's JSON.
 *
 * A hero whose `filename` starts with `missing` cannot be read (how a fixture models a missing upload file); any other hero
 * is a small image whose colour depends on its id and `updatedAt`, so replacing a hero changes the card's pixels.
 */
export function installTestRuntime(given: OgImagePluginOptions, docs: KitDocs, o: TestRuntimeOptions = {}): TestRuntime {
  const options = withVariants(given) // the kit sees the hidden variant targets exactly as the plugin does
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

  /**
   * The uploads the fixtures hold, read the way Payload reads them. With `o.uploads` they are modelled by collection and id (a `_status: 'draft'` entry
   * is a draft-only upload), and a collection it does not list holds nothing. Without it, the stand-in uploads inside the documents are used, found by
   * id in whichever upload collection is asked, since a fixture document does not say which collection its upload is in. A public read (`draft` not set) sees published documents and uploads
   * only; a draft read sees the drafts first, then the published ones.
   */
  const uploadOf = (collection: string, id: unknown, draftRead: boolean): Record<string, any> | null => {
    if (o.uploads !== undefined) {
      const modelled = Object.hasOwn(o.uploads, collection) ? o.uploads[collection] : undefined
      const hit = modelled && Object.hasOwn(modelled, String(id)) ? (modelled[String(id)] as Record<string, any>) : undefined
      // The key is the id: an entry that omits its own `id` is that upload under it.
      return hit && (draftRead || hit._status !== 'draft') ? { ...hit, id: hit.id ?? id } : null
    }
    const seen = new Set<unknown>()
    const find = (v: unknown): Record<string, any> | null => {
      if (v === null || typeof v !== 'object' || seen.has(v)) return null
      seen.add(v)
      const u = v as Record<string, any>
      if (u.id !== undefined && typeof u.url === 'string' && String(u.id) === String(id)) return u
      for (const c of Object.values(u)) {
        const hit = find(c)
        if (hit) return hit
      }
      return null
    }
    return (draftRead ? find(docs.drafts) : null) ?? find(docs.published)
  }
  const isTargetCollection = (collection: string) =>
    Object.entries(options.targets).some(([name, t]) => (t.collection ?? name) === collection)
  for (const [slug, byId] of Object.entries(o.uploads ?? {})) {
    if (isTargetCollection(slug))
      throw new Error(
        `payload-og-image test runtime: uploads names "${slug}", which is a target's collection (its documents are fixtures in \`docs\`, not uploads)`,
      )
    for (const [key, upload] of Object.entries(byId))
      if (upload.id !== undefined && String(upload.id) !== key)
        throw new Error(`payload-og-image test runtime: uploads.${slug}["${key}"] has id ${JSON.stringify(upload.id)}: the key is the id`)
  }

  // The parts of Payload the production source touches: auth, find (the table above), collections, findGlobal.
  const fakePayload = {
    // `globals` as Payload lists them: a site's `site()` often asks which of its globals have drafts.
    config: { admin: { user: options.editors?.[0] ?? 'users' }, globals: Object.keys(docs.globals ?? {}).map((slug) => ({ slug })) },
    collections: {
      ...Object.fromEntries(
        Object.entries(options.targets).map(([name, t]) => [t.collection ?? name, { config: { versions: { drafts: true } } }]),
      ),
      // The site's only upload collection, so a target that names no `heroCollection` still reads its hero (stand-ins have no folder to load from).
      // Never over a target's own collection of that name, and not at all when `uploads` models the site's collections itself.
      ...(o.uploads === undefined && !isTargetCollection(KIT_UPLOADS) ? { [KIT_UPLOADS]: { config: { upload: { staticDir: '' } } } } : {}),
      ...Object.fromEntries(Object.keys(o.uploads ?? {}).map((slug) => [slug, { config: { upload: { staticDir: '' } } }])),
    },
    findGlobal: async ({ slug }: { slug: string }) => structuredClone(docs.globals?.[slug] ?? {}),
    auth: async ({ headers }: { headers: Headers }) => ({
      user: headers.get('authorization') === EDITOR_AUTH ? { id: 1, collection: editorCollection } : null,
    }),
    find: async (args: { collection: string; where?: unknown; draft?: boolean; page?: number; limit?: number; sort?: string }) => {
      if (!isTargetCollection(args.collection)) {
        const id = (args.where as { and?: unknown[] } | undefined)?.and?.[0] ?? args.where
        const upload = uploadOf(args.collection, (id as { id?: { equals?: unknown } } | undefined)?.id?.equals, args.draft === true)
        return { docs: upload ? [structuredClone(upload)] : [], totalDocs: upload ? 1 : 0 }
      }
      const name = targetOfCollection(args.collection)
      const found = table(name, args.draft === true).filter((d) => args.where === undefined || matches(args.where, d))
      if (args.sort === 'id') found.sort((a: any, b: any) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))
      const limit = args.limit ?? 1
      const from = ((args.page ?? 1) - 1) * limit
      return { docs: found.slice(from, from + limit).map((d) => structuredClone(d)), totalDocs: found.length }
    },
  } as unknown as Payload
  const inner: Renderer =
    o.renderer === 'real'
      ? nextOgRenderer({ palette: cardPaletteOf(options.palette) })
      : {
          // The stub draws the element's JSON: any change to what a template would draw changes the bytes.
          render: async (el, a) => {
            const image = sharp({ create: { width: 8, height: 8, channels: 3, background: colourOf(JSON.stringify(el)) } })
            const format = a.encoding?.format ?? 'png'
            return new Uint8Array(await (format === 'jpeg' ? image.jpeg() : format === 'webp' ? image.webp() : image.png()).toBuffer())
          },
        }
  const renderer: Renderer = {
    async render(el, a) {
      renders += 1
      await hold
      return inner.render(el, a)
    },
  }
  const heroImages = new Map<string, string>()
  const heroDir = o.heroDir
  const real = heroDir === undefined ? undefined : payloadHeroLoader({ staticDirs: async () => [heroDir], ...heroLoaderOptionsOf(options) })
  /** A hero with a file in `heroDir` (by base name, as the loader reads it). */
  const isReal = (hero: { filename?: string | null }) => {
    if (heroDir === undefined || typeof hero.filename !== 'string') return false
    const name = path.basename(hero.filename)
    return name !== '' && existsSync(path.join(heroDir, name))
  }
  const heroLoader: HeroLoader = async (hero, box, where) => {
    heroLoads += 1
    if (real && isReal(hero)) return real(hero, box, where)
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
  heroLoader.readable = async (hero, where) =>
    real && isReal(hero)
      ? (real.readable as NonNullable<HeroLoader['readable']>)(hero, where)
      : !(typeof hero.filename === 'string' && hero.filename.startsWith('missing'))
  heroLoader.hasAlpha = async (hero, where) =>
    real && isReal(hero) ? (real.hasAlpha as NonNullable<HeroLoader['hasAlpha']>)(hero, where) : o.transparentHero?.(hero) === true

  const build = (keepStore: boolean) => {
    state = createState(options, serverUrl)
    if (!keepStore) {
      memoryOnly = memoryStore()
      store = {
        async get(p, v) {
          storeReads += 1
          return memoryOnly.get(p, v)
        },
        stat: (p, v) => memoryOnly.stat(p, v), // a stat is not a read: an audit must not move `storeReads`
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
