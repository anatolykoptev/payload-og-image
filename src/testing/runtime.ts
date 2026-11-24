import type { Payload } from 'payload'
import type { DocSource, HeroLoader, Renderer, RouteContext } from '../internal/handler.js'
import { buildRuntime, type OgRuntime, setTestRuntime } from '../internal/runtime.js'
import { createState, type OgState } from '../internal/state.js'
import { memoryStore } from '../internal/store/memory.js'
import type { CardStore } from '../internal/types.js'
import type { OgImagePluginOptions } from '../plugin/index.js'
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
  setGlobal(slug: string, data: Record<string, any>): void
  setDoc(target: string, doc: Record<string, any>): void
  /** Draft mode on or off, and whether the request carries an authenticated editor. */
  draftMode(on: boolean, editor?: boolean): void
  /** How many times the renderer ran since the last reset. */
  renders(): number
  /** How many times a hero was prepared since the last reset. */
  heroLoads(): number
  /** `[pageId, v]` of every card put in the store since the last reset. */
  stored(): Array<{ pageId: string; v: string }>
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

export type TestRuntimeOptions = { renderer?: 'real' | 'stub'; serverUrl?: string }

/**
 * Installs a runtime built exactly like production's (same handler, resolver, gate and memo) over in-memory
 * documents, a memory store and either the real renderer or a stub that draws the props. A hero whose
 * `filename` starts with `missing` cannot be read (that is how a site fixture models a missing upload file).
 */
export function installTestRuntime(options: OgImagePluginOptions, docs: KitDocs, o: TestRuntimeOptions = {}): TestRuntime {
  const serverUrl = o.serverUrl ?? 'https://example.test'
  let state: OgState
  let store: CardStore
  let memoryOnly: CardStore
  let renders = 0
  let heroLoads = 0
  let puts: Array<{ pageId: string; v: string }> = []
  let draft = { on: false, editor: false }
  let hold: Promise<void> | undefined
  let runtime: OgRuntime

  const fakePayload = {
    findGlobal: async ({ slug }: { slug: string }) => structuredClone(docs.globals?.[slug] ?? {}),
    collections: {},
  } as unknown as Payload

  const source: DocSource = {
    published: async (t, slug) =>
      structuredClone(docs.published[t]?.find((d) => d[options.targets[t]?.slugField ?? 'slug'] === slug) ?? null),
    publishedById: async (t, id) => structuredClone(docs.published[t]?.find((d) => String(d.id) === String(id)) ?? null),
    draft: async (t, key) => {
      if (!draft.editor) return null
      const pool = docs.drafts?.[t] ?? []
      const found = key.slug !== undefined ? pool.find((d) => d.slug === key.slug) : pool.find((d) => String(d.id) === String(key.id))
      return structuredClone(found ?? null)
    },
    site: async (request) => options.site({ payload: fakePayload, draft: Boolean(request) && draft.editor }),
  }

  const inner: Renderer =
    o.renderer === 'real'
      ? nextOgRenderer()
      : {
          // The stub draws the element's JSON: any change to what a template would draw changes the bytes.
          render: async (el) =>
            (await import('sharp'))
              .default({ create: { width: 8, height: 8, channels: 3, background: colourOf(JSON.stringify(el)) } })
              .png()
              .toBuffer()
              .then((b) => new Uint8Array(b)),
        }
  const renderer: Renderer = {
    async render(el, a) {
      renders += 1
      await hold
      return inner.render(el, a)
    },
  }
  const heroLoader: HeroLoader = async (hero) => {
    heroLoads += 1
    if (typeof hero.filename === 'string' && hero.filename.startsWith('missing')) return null
    return TINY_PNG
  }

  const build = (keepStore: boolean) => {
    state = createState(options, serverUrl)
    if (!keepStore) {
      memoryOnly = memoryStore()
      store = {
        get: (p, v) => memoryOnly.get(p, v),
        async put(p, v, b) {
          puts.push({ pageId: p, v })
          await memoryOnly.put(p, v, b)
        },
      }
    }
    runtime = buildRuntime(state, fakePayload, {
      source,
      store,
      renderer,
      heroLoader,
      isDraftRequest: async () => draft.on,
      requestForPage: async () => new Request(serverUrl),
    })
    setTestRuntime(runtime)
  }
  build(false)

  const rt: TestRuntime = {
    options,
    docs,
    serverUrl,
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
    renders: () => renders,
    heroLoads: () => heroLoads,
    stored: () => [...puts],
    clearMemo: () => build(true),
    clearCaches: () => build(false),
    reset() {
      renders = 0
      heroLoads = 0
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
  return rt
}

const colourOf = (text: string) => {
  let h = 7
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return { r: h & 255, g: (h >> 8) & 255, b: (h >> 16) & 255 }
}

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=='
