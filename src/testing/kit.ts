import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'
import sharp from 'sharp'
import { missingGlyphs } from '../internal/fonts.js'
import { CACHE, type RouteContext } from '../internal/handler.js'
import { analyzeRouteSource } from './routeSource.js'
import type { TestRuntime } from './runtime.js'

export type RouteModule = { GET(r: Request, c: RouteContext): Promise<Response>; HEAD?(r: Request, c: RouteContext): Promise<Response> }
export type IndexableRoute = { path: string; metadata: () => Promise<Metadata>; allowShared?: boolean }
export type Params = Record<string, string>

const fail = (check: string, what: string): never => {
  throw new Error(`payload-og-image kit: ${check}: ${what}`)
}
const ctx = (params: Params): RouteContext => ({ params: Promise.resolve(params) })
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])
const bytesOf = async (r: Response) => new Uint8Array(await r.arrayBuffer())

/** One regex per configured card path (`:kind`, `:slug`, `:id` become captures), to turn an advertised URL back into route params. */
function patterns(rt: TestRuntime) {
  const list: Array<{ regex: RegExp; names: string[]; target?: string; fixed?: Params }> = []
  const add = (p: string, target?: string, fixed?: Params) => {
    const names: string[] = []
    const source = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(kind|slug|id)\b/g, (_, n: string) => {
      names.push(n)
      return '([^/]+)'
    })
    const regex = new RegExp(`^${source}$`)
    list.push({ regex, names, target, fixed })
  }
  for (const [name, t] of Object.entries(rt.options.targets)) add(t.path, name)
  for (const s of Object.values(rt.options.static ?? {})) add(s.path, undefined, { kind: s.kind, slug: s.slug })
  return list
}

/** The params the route would receive for an advertised card URL (decoded, as Next hands them over), or null if it is not a card URL. */
function paramsOf(rt: TestRuntime, url: URL): { params: Params; fixedTarget?: string } | null {
  for (const { regex, names, target, fixed } of patterns(rt)) {
    const m = regex.exec(url.pathname)
    if (!m) continue
    // A static card's path is a literal: its kind and slug come from the card, not from the URL.
    const params: Params = { ...fixed }
    names.forEach((n, i) => {
      params[n === 'id' ? 'slug' : n] = decodeURIComponent(m[i + 1] as string)
    })
    return { params, fixedTarget: fixed || names.includes('kind') ? undefined : target }
  }
  return null
}

/** Draws the card at an advertised URL through the runtime's own handler. */
async function fetchCard(rt: TestRuntime, url: string, route?: (url: URL) => { module: RouteModule; params: Params }): Promise<Response> {
  const u = new URL(url)
  if (route) {
    const { module, params } = route(u)
    return module.GET(new Request(url, { headers: rt.requestHeaders() }), ctx(params))
  }
  const found = paramsOf(rt, u)
  if (!found) return fail('fetch', `"${url}" does not match any configured card path`)
  return rt.runtime.handler(found.fixedTarget).GET(new Request(url, { headers: rt.requestHeaders() }), ctx(found.params))
}

const imagesOf = (m: Metadata) => {
  const og = m.openGraph?.images
  const list = Array.isArray(og) ? og : og ? [og] : []
  return list as Array<{ url?: string | URL; width?: number; height?: number; type?: string; alt?: string }>
}

export function ogKit(rt: TestRuntime) {
  const urlOf = (p: Params) => `${rt.serverUrl}/og/${encodeURIComponent(p.kind ?? '')}/${encodeURIComponent(p.slug ?? '')}/card.png`
  const call = (
    m: RouteModule,
    p: Params,
    o: { v?: string; headers?: Record<string, string>; method?: string; fn?: 'GET' | 'HEAD' } = {},
  ) => {
    const base = urlOf(p)
    const req = new Request(o.v === undefined ? base : `${base}?v=${encodeURIComponent(o.v)}`, {
      method: o.method ?? 'GET',
      // The editor credential, when the runtime is in editor mode: the production auth path decides what it means.
      headers: { ...rt.requestHeaders(), ...o.headers },
    })
    const fn = o.fn === 'HEAD' ? (m.HEAD ?? m.GET) : m.GET
    return fn(req, ctx(p))
  }
  const etagOf = (r: Response) => (r.headers.get('etag') ?? '').replaceAll('"', '')
  const uploadPrefixes = (a: { uploadPaths?: string[] }) => a.uploadPaths ?? ['/api/media/file/', '/media/']

  return {
    /**
     * Every advertised image is either a recognised card route (fetched: 200, the declared type, immutable, a decodable PNG of
     * the advertised width and height) or an upload the site serves (`uploadPaths`). Anything else fails. The image URL must be
     * `https`, as Facebook, LinkedIn and X document it: `allowHttpImages: true` admits `http` for a site that is only ever served
     * on plain HTTP (a local dev server).
     */
    async everyRouteHasOwnCard(a: {
      routes: IndexableRoute[]
      cardRoute: (url: URL) => { module: RouteModule; params: Params }
      uploadPaths?: string[]
      allowHttpImages?: boolean
    }): Promise<void> {
      const seen = new Map<string, string>()
      for (const route of a.routes) {
        const meta = await route.metadata()
        const image = imagesOf(meta)[0]
        if (!image?.url) fail('everyRouteHasOwnCard', `${route.path} advertises no og:image`)
        const url = String(image?.url)
        if (!/^https?:\/\//.test(url)) fail('everyRouteHasOwnCard', `${route.path}: image url "${url}" is not absolute`)
        if (url.startsWith('http://') && !a.allowHttpImages)
          fail(
            'everyRouteHasOwnCard',
            `${route.path}: image url "${url}" is not https (crawlers expect an https og:image; allowHttpImages: true admits http for a local dev server)`,
          )
        for (const k of ['width', 'height'] as const)
          if (!(Number(image?.[k]) > 0)) fail('everyRouteHasOwnCard', `${route.path}: og:image has no ${k}`)
        if (!image?.type) fail('everyRouteHasOwnCard', `${route.path}: og:image has no type`)
        if (!image?.alt || String(image.alt).trim() === '') fail('everyRouteHasOwnCard', `${route.path}: og:image has no alt text`)
        const twitter = meta.twitter as { card?: string; images?: unknown } | undefined
        const tw = (Array.isArray(twitter?.images) ? twitter?.images[0] : twitter?.images) as { url?: string | URL } | string | undefined
        if (twitter?.card !== 'summary_large_image' || String(typeof tw === 'object' ? tw?.url : tw) !== url) {
          fail('everyRouteHasOwnCard', `${route.path}: twitter card must be summary_large_image with the same image url`)
        }
        const prior = seen.get(url)
        if (prior && !route.allowShared) fail('everyRouteHasOwnCard', `${route.path} shares its card ${url} with ${prior}`)
        seen.set(url, route.path)
        const u = new URL(url)
        if (!paramsOf(rt, u)) {
          // A versioned URL (`?v=<12 hex>`) is a generated card's shape: it must match a configured path, not slip through as an upload.
          if (/[?&]v=[0-9a-f]{12}(&|$)/.test(u.search))
            fail('everyRouteHasOwnCard', `${route.path}: ${url} looks like a generated card but matches no configured card path`)
          if (uploadPrefixes(a).some((prefix) => u.pathname.startsWith(prefix))) continue // an upload the site serves, shared as it is
          fail(
            'everyRouteHasOwnCard',
            `${route.path}: ${url} is neither a configured card route nor an upload path (${uploadPrefixes(a).join(', ')}): a crawler would fetch a URL nothing owns`,
          )
        }
        const { module, params } = a.cardRoute(u)
        const res = await module.GET(new Request(url, { headers: rt.requestHeaders() }), ctx(params))
        if (res.status !== 200) fail('everyRouteHasOwnCard', `${route.path}: ${url} answers ${res.status}`)
        if (res.headers.get('content-type') !== image.type)
          fail('everyRouteHasOwnCard', `${route.path}: ${url} serves ${res.headers.get('content-type')}, declared ${image.type}`)
        if (res.headers.get('cache-control') !== CACHE.immutable) {
          fail(
            'everyRouteHasOwnCard',
            `${route.path}: the advertised ${url} answers ${res.headers.get('cache-control')} (answers 1h, not immutable): the page links a version the route does not serve as current`,
          )
        }
        let decoded: { format?: string; width?: number; height?: number }
        try {
          decoded = await sharp(await bytesOf(res)).metadata()
        } catch {
          return fail('everyRouteHasOwnCard', `${route.path}: ${url} does not serve a decodable image`)
        }
        if (decoded.format !== 'png') fail('everyRouteHasOwnCard', `${route.path}: ${url} serves a ${decoded.format}, not a PNG`)
        // The stub renderer draws 8x8 cards: only the real renderer can honour the advertised size.
        if (rt.rendererKind === 'real' && (decoded.width !== image.width || decoded.height !== image.height)) {
          fail(
            'everyRouteHasOwnCard',
            `${route.path}: ${url} is ${decoded.width}x${decoded.height} but og:image says ${image.width}x${image.height}`,
          )
        }
      }
    },

    /** The route files in `appDir` that export GET and call `createOgRoute` are exactly the configured card paths, parameter names included. */
    async routesMatchPaths(a: { appDir: string }): Promise<void> {
      const files: string[] = []
      const walk = async (dir: string) => {
        for (const e of await readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) await walk(full)
          else if (/^route\.(ts|tsx|js|mjs)$/.test(e.name)) files.push(full)
        }
      }
      await walk(a.appDir)
      const fromFile = (f: string) =>
        `/${path
          .relative(a.appDir, path.dirname(f))
          .split(path.sep)
          .filter((seg) => !/^\(.*\)$/.test(seg))
          .map((seg) => seg.replace(/^\[\.\.\.(.+)\]$/, ':$1').replace(/^\[(.+)\]$/, ':$1'))
          .join('/')}`
      // A card route exports, as GET, the GET of a `createOgRoute()` call imported from payload-og-image/next (parsed, not grepped).
      const isCardRoute = (source: string) => analyzeRouteSource(source).exportsGetFromCreateOgRoute
      const routes = new Map<string, string>()
      for (const f of files) if (isCardRoute(await readFile(f, 'utf8'))) routes.set(fromFile(f), f)
      const configured = new Map<string, string>()
      for (const [n, t] of Object.entries(rt.options.targets)) configured.set(t.path, `target "${n}"`)
      for (const [n, s] of Object.entries(rt.options.static ?? {})) configured.set(s.path, `static card "${n}"`)
      // A route file path may be a template that serves several LITERAL configured paths (any value in a `:param` segment); a
      // configured path that is itself a template must be served by a route with the very same parameter names.
      const asRegex = (route: string) => new RegExp(`^${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]+/g, '[^/]+')}$`)
      const matches = (route: string, configuredPath: string) =>
        route === configuredPath || (!configuredPath.includes(':') && asRegex(route).test(configuredPath))
      const problems: string[] = []
      for (const [p, who] of configured) {
        if (![...routes.keys()].some((r) => matches(r, p)))
          problems.push(
            `${who} declares ${p}, but no route file exporting GET through createOgRoute serves it (route files: ${[...routes.keys()].join(', ') || 'none'})`,
          )
      }
      for (const [p, f] of routes) {
        if (![...configured.keys()].some((c) => matches(p, c)))
          problems.push(
            `the route file ${path.relative(a.appDir, f)} serves ${p}, which no target or static card declares (declared: ${[...configured.keys()].join(', ')})`,
          )
      }
      if (problems.length > 0) fail('routesMatchPaths', problems.join('; '))
    },

    /**
     * A draft-mode request is never cached or stored and never changes the published card: an editor gets the draft's pixels, a
     * draft-mode request without an editor gets the published pixels, and neither touches the memo or the store.
     */
    async draftNeverCached(a: { module: RouteModule; params: Params; target: string; slug: string; draftOnly?: string }): Promise<void> {
      if (!rt.docs.drafts?.[a.target]?.some((d) => d.slug === a.slug)) {
        fail(
          'draftNeverCached',
          `no draft fixture for ${a.target}/${a.slug}: add one to docs.drafts so an editor's card can differ from the published one`,
        )
      }
      rt.reset()
      const warm = await call(a.module, a.params)
      const published = await bytesOf(warm)
      const base = { reads: rt.storeReads(), writes: rt.stored().length, renders: rt.renders() }
      const preview = async (editor: boolean) => {
        rt.draftMode(true, editor)
        const r = await call(a.module, a.params)
        if (r.headers.get('cache-control') !== 'no-store' || r.headers.get('x-og-cache') !== 'draft') {
          fail(
            'draftNeverCached',
            `a draft-mode request (editor: ${editor}) answered cache-control "${r.headers.get('cache-control')}", x-og-cache "${r.headers.get('x-og-cache')}"; expected no-store and draft`,
          )
        }
        return bytesOf(r)
      }
      const editorBody = await preview(true)
      const editorAgain = await preview(true)
      const anonBody = await preview(false)
      if (same(editorBody, published)) fail('draftNeverCached', 'an editor in draft mode got the PUBLISHED card, not the draft')
      if (!same(editorBody, editorAgain)) fail('draftNeverCached', 'two identical editor previews differ')
      if (!same(anonBody, published))
        fail('draftNeverCached', 'a draft-mode request without an editor did not get the published card: draft words reached a visitor')
      if (rt.renders() - base.renders !== 3)
        fail('draftNeverCached', `3 draft-mode requests rendered ${rt.renders() - base.renders} times: one was served from a memo`)
      if (rt.storeReads() !== base.reads) fail('draftNeverCached', 'a draft-mode request read the store')
      if (rt.stored().length !== base.writes) fail('draftNeverCached', 'a draft-mode request put a card in the store')
      if (a.draftOnly !== undefined) {
        if (
          !rt.docs.drafts?.[a.target]?.some((d) => d.slug === a.draftOnly) ||
          rt.docs.published[a.target]?.some((d) => d.slug === a.draftOnly)
        ) {
          fail('draftNeverCached', `draftOnly "${a.draftOnly}" must exist in docs.drafts.${a.target} and NOT in docs.published.${a.target}`)
        }
        const hidden = { ...a.params, slug: a.draftOnly }
        for (const [label, draft, editor] of [
          ['public', false, false],
          ['draft mode without an editor', true, false],
        ] as const) {
          rt.draftMode(draft, editor)
          const r = await call(a.module, hidden)
          if (r.status !== 404)
            fail('draftNeverCached', `a never-published document answered ${r.status} for a ${label} request: its draft reached a visitor`)
        }
        rt.draftMode(true, true)
        const mine = await call(a.module, hidden)
        if (mine.status !== 200 || mine.headers.get('x-og-cache') !== 'draft')
          fail('draftNeverCached', `an editor previewing a never-published document got ${mine.status}, expected its draft card`)
      }
      rt.draftMode(false)
      const after = await call(a.module, a.params)
      if (!same(published, await bytesOf(after)) || etagOf(after) !== etagOf(warm))
        fail('draftNeverCached', 'the published card changed after a draft-mode request: draft words reached the cache')
    },

    /** A card already in the store is served without rendering or preparing its hero again. */
    async storeHitSkipsRender(a: { module: RouteModule; params: Params }): Promise<void> {
      rt.reset()
      const first = await call(a.module, a.params)
      await first.arrayBuffer()
      const renders = rt.renders()
      const heroes = rt.heroLoads()
      rt.clearMemo()
      const second = await call(a.module, a.params, { v: etagOf(first) })
      if (second.headers.get('x-og-cache') !== 'store')
        fail('storeHitSkipsRender', `after a restart the card came from "${second.headers.get('x-og-cache')}", expected "store"`)
      if (rt.renders() !== renders) fail('storeHitSkipsRender', 'a store hit rendered again')
      if (rt.heroLoads() !== heroes)
        fail('storeHitSkipsRender', 'a store hit prepared the hero again (asset work must come after the cache check)')
    },

    /**
     * More cold requests than the gate and its queue hold: exactly the excess is answered 503 with Retry-After, the rest succeed.
     * No sleeps: renders are held until the gate reports itself full and every excess request has been answered.
     */
    async queueSheds(a: { module: RouteModule; paramsFor: (i: number) => Params }): Promise<void> {
      rt.reset()
      const { concurrency = 2, queue = 50 } = rt.options.gate ?? {}
      const total = concurrency + queue + 3
      const expectedShed = total - concurrency - queue
      const release = rt.holdRenders()
      let answered = 0
      const pending = Array.from({ length: total }, (_, i) =>
        call(a.module, a.paramsFor(i)).then((r) => {
          answered += 1
          return r
        }),
      )
      const until = async (cond: () => boolean, what: string) => {
        for (const end = Date.now() + 10_000; !cond(); ) {
          if (Date.now() > end)
            fail('queueSheds', `timed out waiting for ${what} (gate ${JSON.stringify(rt.gateStats())}, ${answered} answered)`)
          await new Promise((r) => setImmediate(r))
        }
      }
      // The gate is full and every excess request has been answered: nothing more can change before the release.
      await until(
        () => rt.gateStats().active === concurrency && rt.gateStats().waiting === queue && answered >= expectedShed,
        'the gate to fill and the excess to be shed',
      )
      release()
      const results = await Promise.all(pending)
      const shed = results.filter((r) => r.status === 503)
      const ok = results.filter((r) => r.status === 200)
      if (shed.length === 0)
        fail('queueSheds', `${total} cold requests (gate ${concurrency}, queue ${queue}) and none was shed: the queue is unbounded`)
      if (shed.length !== expectedShed) {
        fail(
          'queueSheds',
          `${shed.length} of ${total} requests were shed, expected exactly ${expectedShed} (gate ${concurrency}, queue ${queue}): the queue admits the wrong number`,
        )
      }
      if (shed.some((r) => r.headers.get('retry-after') !== '5' || r.headers.get('cache-control') !== 'no-store'))
        fail('queueSheds', 'a shed answer lacks retry-after: 5 or is cacheable')
      if (ok.length < concurrency + queue)
        fail(
          'queueSheds',
          `only ${ok.length} of ${total} succeeded; expected at least ${concurrency + queue} (do paramsFor(i) documents exist?)`,
        )
    },

    /** HEAD answers like GET (the module's own HEAD export, or what Next derives from GET): same status and headers, Content-Length included when present, no body. */
    async headParity(a: { module: RouteModule; params: Params }): Promise<void> {
      rt.reset()
      await (await call(a.module, a.params)).arrayBuffer() // warm: the cache state is then the same for both
      const get = await call(a.module, a.params)
      const head = await call(a.module, a.params, { method: 'HEAD', fn: 'HEAD' })
      await head.body?.cancel()
      await get.body?.cancel()
      if (head.status !== get.status)
        fail('headParity', `HEAD answers ${head.status}, GET ${get.status}: link-preview crawlers HEAD an og:image first`)
      const names = new Set([...get.headers.keys(), ...head.headers.keys()])
      names.delete('date')
      if (!head.headers.has('content-length')) names.delete('content-length') // a HEAD answer may omit it; when present it must equal GET's
      for (const n of names) {
        if (get.headers.get(n) !== head.headers.get(n))
          fail('headParity', `header "${n}" differs: GET "${get.headers.get(n)}", HEAD "${head.headers.get(n)}"`)
      }
    },

    /** A version that is not current is served for an hour, never as immutable, with the current bytes. */
    async staleVersionShort(a: { module: RouteModule; params: Params }): Promise<void> {
      rt.reset()
      const current = await call(a.module, a.params)
      const v = etagOf(current)
      const currentBytes = await bytesOf(current)
      const stale = await call(a.module, a.params, { v: 'stale00stale' })
      if (stale.headers.get('cache-control') !== CACHE.short)
        fail('staleVersionShort', `a stale ?v answered "${stale.headers.get('cache-control')}", expected "${CACHE.short}"`)
      if (!same(currentBytes, await bytesOf(stale))) fail('staleVersionShort', 'a stale ?v got other bytes than the current card')
      const ok = await call(a.module, a.params, { v })
      if (ok.headers.get('cache-control') !== CACHE.immutable)
        fail('staleVersionShort', `the current ?v answered "${ok.headers.get('cache-control')}", expected immutable`)
      await ok.arrayBuffer()
    },

    /** The version the request names is never a store key: only server-derived versions are written. */
    async requestVersionNeverStored(a: { module: RouteModule; params: Params }): Promise<void> {
      rt.reset()
      const current = etagOf(await call(a.module, a.params))
      let probesThatWrote = 0
      // Every probe starts cold: only a render that happens WITH a client-chosen ?v can store under it.
      for (const v of ['abcdef012345', '0123456789ab', 'attacker0000', '../../etc']) {
        rt.reset()
        await (await call(a.module, a.params, { v })).arrayBuffer()
        const written = rt.stored()
        if (written.length > 0) probesThatWrote += 1
        const bad = written.filter((s) => s.v !== current)
        if (bad.length > 0)
          fail(
            'requestVersionNeverStored',
            `?v=${v} made the store hold version(s) ${bad.map((b) => b.v).join(', ')} that the server never derived (current is ${current})`,
          )
      }
      if (probesThatWrote === 0)
        fail('requestVersionNeverStored', 'no probe caused a store write, so nothing was checked (does the card render at all?)')
    },

    /** Whatever changes the card's bytes also changes the advertised URL. With `cardRoute` the card is fetched through the site's route module. */
    async versionCoversEverythingDrawn(a: {
      metadata: () => Promise<Metadata>
      mutate: Array<() => void>
      cardRoute?: (url: URL) => { module: RouteModule; params: Params }
    }): Promise<void> {
      rt.reset()
      const snapshot = async () => {
        const url = String(imagesOf(await a.metadata())[0]?.url ?? '')
        if (!url) return fail('versionCoversEverythingDrawn', 'the page advertises no image')
        rt.clearCaches() // a cold render of the CURRENT documents, not a cached one
        const res = await fetchCard(rt, url, a.cardRoute)
        if (res.status !== 200) return fail('versionCoversEverythingDrawn', `${url} answered ${res.status}, not a card`)
        const source = res.headers.get('x-og-cache')
        if (source === 'fallback' || source === 'downgraded')
          return fail('versionCoversEverythingDrawn', `${url} was answered as "${source}", not as a card`)
        return { url, bytes: await bytesOf(res) }
      }
      let before = await snapshot()
      for (const [i, change] of a.mutate.entries()) {
        change()
        const after = await snapshot()
        if (after.url === before.url && !same(after.bytes, before.bytes)) {
          fail(
            'versionCoversEverythingDrawn',
            `mutation #${i + 1} changed the rendered bytes but not the URL (${after.url}): a stale card would be served immutable. Pass everything a template draws through props.`,
          )
        }
        before = after
      }
    },

    /** A card drawn without its hero (an unreadable file) is served briefly, flagged, with no etag, and never stored or remembered. */
    async downgradeNotStored(a: { module: RouteModule; params: Params }): Promise<void> {
      rt.reset()
      const current = etagOf(await call(a.module, a.params))
      rt.reset()
      const pair = await Promise.all([call(a.module, a.params, { v: current }), call(a.module, a.params, { v: current })])
      for (const r of pair) {
        if (r.headers.get('x-og-cache') !== 'downgraded' || r.headers.get('cache-control') !== CACHE.degraded) {
          fail(
            'downgradeNotStored',
            `a card without its hero answered x-og-cache "${r.headers.get('x-og-cache')}", cache-control "${r.headers.get('cache-control')}"; expected downgraded and "${CACHE.degraded}" (does the document's hero filename start with "missing"?)`,
          )
        }
        if (r.headers.has('etag'))
          fail(
            'downgradeNotStored',
            'a downgraded card carries an etag: a cache could revalidate it into a 304 that pins it as the current card',
          )
        await r.arrayBuffer()
      }
      if (rt.stored().length > 0) fail('downgradeNotStored', 'a downgraded card was put in the store')
      const loads = rt.heroLoads()
      await (await call(a.module, a.params)).arrayBuffer()
      if (rt.heroLoads() === loads)
        fail('downgradeNotStored', 'a downgraded card was remembered in memory: the next request did not try the hero again')
    },

    /** Every stack draws every sample string. */
    async glyphCoverage(a: { samples: string[] }): Promise<void> {
      const { fonts } = await loadFonts(rt)
      for (const [name, stack] of Object.entries(rt.options.stacks)) {
        for (const sample of a.samples) {
          const missing = missingGlyphs(fonts, stack, sample)
          if (missing.length > 0) fail('glyphCoverage', `stack "${name}" cannot draw ${JSON.stringify(missing.join(''))} of "${sample}"`)
        }
      }
    },

    /** Cards stay within a byte budget (measured on real cards: not the stub renderer, not an error or fallback body). */
    async sizeBudget(a: { module: RouteModule; params: Params[]; maxBytes: number }): Promise<void> {
      rt.reset()
      for (const p of a.params) {
        if (rt.rendererKind === 'stub')
          fail(
            'sizeBudget',
            'the test runtime uses the stub renderer, whose cards are 8x8 pixels: install it with { renderer: "real" } to measure real sizes',
          )
        const res = await call(a.module, p)
        if (res.status !== 200) fail('sizeBudget', `${JSON.stringify(p)} answered ${res.status}, not a card`)
        const source = res.headers.get('x-og-cache')
        if (source === 'fallback' || source === 'downgraded')
          fail('sizeBudget', `${JSON.stringify(p)} was answered as "${source}", not as a card: its size says nothing about the real card`)
        const size = (await bytesOf(res)).byteLength
        if (size > a.maxBytes) fail('sizeBudget', `${JSON.stringify(p)} is ${size} bytes, over the budget of ${a.maxBytes}`)
      }
    },
  }
}

async function loadFonts(rt: TestRuntime) {
  const { loadFonts: load } = await import('../internal/fonts.js')
  return load(rt.options.fonts)
}
