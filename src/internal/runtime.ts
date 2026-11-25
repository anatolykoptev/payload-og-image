import { getPayload, type Payload, type SanitizedConfig } from 'payload'
import { DEFAULT_HERO_BACKGROUND, normaliseHeroBackground } from '../internal/colour.js'
import { cardPaletteOf, heroColoursOf, paletteTags } from '../internal/palette.js'
import type { OgImagePluginOptions } from '../plugin/index.js'
import { payloadSource } from '../plugin/payloadSource.js'
import { createFallbackTemplate, fallbackTemplate } from '../render/fallback.js'
import { payloadHeroLoader } from '../render/hero.js'
import { nextOgRenderer } from '../render/nextOg.js'
import { type CardHandler, createCardHandler, type DocSource, type HeroLoader, type Renderer, type RouteContext } from './handler.js'
import type { ResolvedCard } from './resolve.js'
import { cachedSite } from './site.js'
import { CUSTOM_KEY, type OgState } from './state.js'
import type { CardStore } from './types.js'

export type OgRuntime = {
  handler(fixedTarget?: string): { GET(r: Request, c: RouteContext): Promise<Response> }
  resolveForMetadata(a: { target: string; id: string | number } | { static: string }, request?: Request): Promise<ResolvedCard>
  /** An editor's live preview of a document being typed (see `CardHandler.preview`). */
  preview: CardHandler['preview']
  emit: OgState['events']['emit']
}

/** What a test substitutes for the real collaborators; everything else is wired exactly as in production. */
export type RuntimeOverrides = {
  source?: DocSource
  store?: CardStore
  renderer?: Renderer
  heroLoader?: HeroLoader
  isDraftRequest?: (r: Request) => Promise<boolean>
  /** A request carrying the page's headers, for draft-mode metadata (default: from `next/headers`). */
  requestForPage?: () => Promise<Request>
}

const BOTS = /(facebookexternalhit|linkedinbot|twitterbot|slackbot|telegrambot|whatsapp|discordbot|googlebot|bingbot)/i

/**
 * A fraction `sample` (0 < sample <= 1) of requests becomes a `crawler` event naming the bot family, the method, the
 * status and the cache source, never the raw user agent. Deterministic: every `1/sample`-th request.
 */
function withCrawlerEvents(h: CardHandler, state: OgState, sample: number): CardHandler['GET'] {
  let n = 0
  return async (r, c) => {
    const res = await h.GET(r, c)
    n += 1
    if (Math.floor(n * sample) > Math.floor((n - 1) * sample)) {
      const ua_family = (BOTS.exec(r.headers.get('user-agent') ?? '')?.[1] ?? 'other').toLowerCase()
      state.events.emit({
        name: 'crawler',
        detail: { ua_family, method: r.method, status: res.status, cache: res.headers.get('x-og-cache') ?? '' },
      })
    }
    return res
  }
}

const disabledHandler = {
  async GET() {
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
  },
}

/** The normalised hero background when it is not the default white (the only case the version must mention). */
const heroBackgroundOf = (o: Pick<OgImagePluginOptions, 'heroBackground'>) => {
  if (o.heroBackground === undefined) return undefined
  const c = normaliseHeroBackground(o.heroBackground)
  return c === DEFAULT_HERO_BACKGROUND ? undefined : c
}

/** The production hero loader: reads only the hero's own upload collection (`Target.heroCollection`), or the one upload collection there is. */
export function heroLoaderFor(payload: Payload, o: Pick<OgImagePluginOptions, 'allowedImageHosts' | 'heroBackground' | 'palette'>) {
  return payloadHeroLoader({
    staticDirs: async (collection) => {
      const uploads = Object.entries(payload.collections).flatMap(([slug, c]) => {
        const up = c.config.upload
        return up && typeof up === 'object' && typeof up.staticDir === 'string' ? [{ slug, dir: up.staticDir }] : []
      })
      const own = collection === undefined ? (uploads.length === 1 ? uploads : []) : uploads.filter((u) => u.slug === collection)
      return own.map((u) => u.dir)
    },
    allowedHosts: o.allowedImageHosts,
    background: o.heroBackground === undefined ? undefined : normaliseHeroBackground(o.heroBackground),
    colours: heroColoursOf(o.palette),
  })
}

export function buildRuntime(state: OgState, payload: Payload, over: RuntimeOverrides = {}): OgRuntime {
  const o = state.options
  if (o.disabled) {
    return {
      handler: () => disabledHandler,
      resolveForMetadata: async () => ({ kind: 'none' }),
      preview: async () => ({ kind: 'none' }),
      emit: state.events.emit,
    }
  }
  state.siteCache ??= cachedSite(async () => o.site({ payload, draft: false }))
  const siteCache = state.siteCache
  const source = over.source ?? payloadSource(payload, state, () => siteCache.get())
  const renderer = over.renderer ?? nextOgRenderer({ palette: cardPaletteOf(o.palette) })
  const heroLoader = over.heroLoader ?? heroLoaderFor(payload, o)
  const isDraftRequest =
    over.isDraftRequest ??
    (async () => {
      const { draftMode } = await import('next/headers.js')
      return (await draftMode()).isEnabled
    })
  const fallback = o.brand ? createFallbackTemplate(o.brand) : fallbackTemplate
  const make = (fixedTarget?: string) => {
    if (fixedTarget !== undefined && !Object.hasOwn(o.targets, fixedTarget))
      throw new Error(`payload-og-image: createOgRoute target "${fixedTarget}" is not a configured target`)
    return createCardHandler({
      targets: o.targets,
      statics: o.static ?? {},
      templates: new Map(o.templates.map((t) => [t.id, t])),
      fonts: state.fonts,
      stacks: o.stacks,
      heroBackground: heroBackgroundOf(o),
      cardPalette: paletteTags(o.palette).card,
      heroPalette: paletteTags(o.palette).hero,
      serverUrl: state.serverUrl,
      source,
      store: over.store ?? state.store(),
      renderer,
      heroLoader,
      gate: state.gate,
      admission: state.admission,
      memo: state.memo,
      events: state.events,
      isDraftRequest,
      fixedTarget,
      seoImage: o.seoImage,
      fallback,
      payload: async () => payload,
    })
  }
  const handlers = new Map<string, CardHandler>()
  const routes = new Map<string, { GET: CardHandler['GET'] }>()
  const handlerFor = (fixed?: string) => {
    const key = fixed ?? ''
    let h = handlers.get(key)
    if (!h) {
      h = make(fixed)
      handlers.set(key, h)
    }
    return h
  }
  const requestForPage =
    over.requestForPage ??
    (async () => {
      const { headers } = await import('next/headers.js')
      return new Request(state.serverUrl, { headers: await headers() })
    })

  return {
    emit: state.events.emit,
    preview: (a) => handlerFor().preview(a),
    handler(fixedTarget) {
      const key = fixedTarget ?? ''
      let route = routes.get(key)
      if (!route) {
        // Built once per target: the sampling counter lives in the wrapper, so a new wrapper per request would never sample.
        const h = handlerFor(fixedTarget)
        route = { GET: o.crawlerEvents ? withCrawlerEvents(h, state, o.crawlerEvents.sample) : h.GET }
        routes.set(key, route)
      }
      return route
    },
    async resolveForMetadata(a, request) {
      const base = handlerFor()
      let previewing = true // when the draft check itself fails, behave as a draft
      try {
        previewing = await isDraftRequest(request ?? new Request(state.serverUrl))
      } catch {
        // stays true
      }
      const req = previewing ? (request ?? (await requestForPage())) : undefined
      if ('static' in a) {
        const card = Object.hasOwn(o.static ?? {}, a.static)
          ? (o.static as Record<string, { kind: string; slug: string }>)[a.static]
          : undefined
        if (!card) throw new Error(`payload-og-image: no static card "${a.static}"`)
        return base.resolve({ staticKey: `${card.kind}/${card.slug}` }, { previewing, request: req })
      }
      const doc =
        (previewing && req ? await source.draft(a.target, { id: a.id }, req) : null) ?? (await source.publishedById(a.target, a.id))
      if (!doc) return { kind: 'none' }
      return base.resolve({ target: a.target, doc }, { previewing, request: req })
    },
  }
}

/** Test registry first (`installTestRuntime`), else the runtime built from `config.custom` on first use. */
let testRuntime: OgRuntime | null = null
export const setTestRuntime = (rt: OgRuntime | null) => {
  testRuntime = rt
}

const built = new WeakMap<object, Promise<OgRuntime>>()
export async function getRuntime(config: Promise<SanitizedConfig> | SanitizedConfig): Promise<OgRuntime> {
  if (testRuntime) return testRuntime
  const resolved = await config
  let rt = built.get(resolved)
  if (!rt) {
    rt = (async () => {
      const payload = await getPayload({ config: resolved })
      const state = payload.config.custom?.[CUSTOM_KEY] as OgState | undefined
      if (!state) throw new Error('payload-og-image: the plugin is not in this Payload config (add ogImagePlugin to `plugins`)')
      return buildRuntime(state, payload)
    })()
    built.set(resolved, rt)
    rt.catch(() => built.delete(resolved))
  }
  return rt
}
