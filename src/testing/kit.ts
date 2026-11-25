import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'
import sharp from 'sharp'
import { drawElement, templateContext } from '../internal/draw.js'
import { missingGlyphs } from '../internal/fonts.js'
import { CACHE, type RouteContext } from '../internal/handler.js'
import { cardPaletteOf } from '../internal/palette.js'
import { nextOgRenderer } from '../render/nextOg.js'
import { analyzeRouteSource } from './routeSource.js'
import type { TestRuntime } from './runtime.js'

export type RouteModule = { GET(r: Request, c: RouteContext): Promise<Response>; HEAD?(r: Request, c: RouteContext): Promise<Response> }
/** A Payload REST route module (`app/(payload)/api/[...slug]/route.ts`): the catch-all's `slug` is the path under the API route. */
export type RestRouteModule = {
  GET(r: Request, c: { params: Promise<{ slug: string[] }> }): Promise<Response> | Response
  HEAD?(r: Request, c: { params: Promise<{ slug: string[] }> }): Promise<Response> | Response
}
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

/** Every url in the twitter card's `images` (strings, URLs or descriptors). */
const twitterUrlsOf = (m: Metadata) => {
  const t = (m.twitter as { images?: unknown } | null | undefined)?.images
  const list = Array.isArray(t) ? t : t ? [t] : []
  return list.map((i) => ({
    list: 'twitter image',
    url: String(typeof i === 'object' && i !== null && !(i instanceof URL) ? (i as { url?: unknown }).url : i),
  }))
}

/** A HEAD answer is the GET's twin: same status, same headers (Content-Length only when present), no body is read. */
async function sameHeadAndGet(check: string, get: Response, head: Response): Promise<void> {
  await head.body?.cancel()
  await get.body?.cancel()
  if (head.status !== get.status)
    fail(check, `HEAD answers ${head.status}, GET ${get.status}: link-preview crawlers HEAD an og:image first`)
  const names = new Set([...get.headers.keys(), ...head.headers.keys()])
  names.delete('date')
  if (!head.headers.has('content-length')) names.delete('content-length') // a HEAD answer may omit it; when present it must equal GET's
  for (const n of names) {
    if (get.headers.get(n) !== head.headers.get(n))
      fail(check, `header "${n}" differs: GET "${get.headers.get(n)}", HEAD "${head.headers.get(n)}"`)
  }
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
        // The scheme rule holds for every image in both lists: a crawler may pick any of them, not only the first.
        for (const u of [...imagesOf(meta).map((i) => ({ list: 'image', url: String(i.url) })), ...twitterUrlsOf(meta)]) {
          if (!/^https?:\/\//.test(u.url)) fail('everyRouteHasOwnCard', `${route.path}: ${u.list} url "${u.url}" is not absolute`)
          if (u.url.startsWith('http://') && !a.allowHttpImages)
            fail(
              'everyRouteHasOwnCard',
              `${route.path}: ${u.list} url "${u.url}" is not https (crawlers expect an https og:image; allowHttpImages: true admits http for a local dev server)`,
            )
        }
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
      const isCardRoute = (source: string, file: string) => analyzeRouteSource(source, file).exportsGetFromCreateOgRoute
      const routes = new Map<string, string>()
      for (const f of files) if (isCardRoute(await readFile(f, 'utf8'), f)) routes.set(fromFile(f), f)
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
      await sameHeadAndGet('headParity', get, head)
    },

    /**
     * Payload's REST router looks endpoints up by method, so a HEAD to an uploaded file (`/api/media/file/...`) answers 404 unless
     * the route wraps its GET (payload#16754, `withHead`), and LinkedIn drops an editor-chosen image whose HEAD is 404. Calls the
     * REST route module with a GET and a HEAD for `url` (an upload that exists, absolute, under `apiRoute`, default `/api`): the
     * GET must succeed, and the HEAD must answer the same status and headers. A module with no `HEAD` export is called as Next calls it:
     * its `GET`, with the request's method set to HEAD.
     */
    async restHeadParity(a: { module: RestRouteModule; url: string; apiRoute?: string }): Promise<void> {
      const u = new URL(a.url)
      const base = (a.apiRoute ?? '/api').replace(/\/+$/, '')
      if (!u.pathname.startsWith(`${base}/`))
        fail('restHeadParity', `"${a.url}" is not under the API route "${base}" (pass apiRoute if the site serves Payload elsewhere)`)
      const slug = u.pathname
        .slice(base.length + 1)
        .split('/')
        .map(decodeURIComponent)
      const send = (method: 'GET' | 'HEAD') => {
        const fn = method === 'HEAD' ? (a.module.HEAD ?? a.module.GET) : a.module.GET
        return fn(new Request(a.url, { method }), { params: Promise.resolve({ slug }) })
      }
      const get = await send('GET')
      if (!get.ok)
        fail('restHeadParity', `GET ${a.url} answers ${get.status}: give the check an upload that exists and that the public may read`)
      const head = await send('HEAD')
      await sameHeadAndGet('restHeadParity', get, head)
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

    /**
     * Every registered template is drawn once with the real renderer, from the props given for its id, and must give a PNG of its
     * declared size. A template bug that only the renderer sees (a `div` with several children and no `display: flex`, a style
     * satori refuses) fails here, in CI, and not as a `render_error` and a five-minute fallback card at the first crawler request.
     * The hero is absent (`ctx.hero` is null); the props are used as given.
     */
    async templatesRender(a: { props: Record<string, Record<string, unknown>> }): Promise<void> {
      const { fonts } = await loadFonts(rt)
      const renderer = nextOgRenderer({ palette: cardPaletteOf(rt.options.palette) })
      for (const template of rt.options.templates) {
        if (!Object.hasOwn(a.props, template.id))
          fail('templatesRender', `no props given for template "${template.id}" (give an entry for every template id)`)
        try {
          const el = template.render(
            a.props[template.id] as never,
            templateContext({ host: new URL(rt.serverUrl).host, fonts, stacks: rt.options.stacks, hero: null }),
          )
          const { bytes } = await drawElement(renderer, el, { ...template.size, fonts })
          const m = await sharp(bytes).metadata()
          if (m.format !== 'png' || m.width !== template.size.width || m.height !== template.size.height)
            throw new Error(`drew a ${m.format} of ${m.width}x${m.height}, not a PNG of ${template.size.width}x${template.size.height}`)
        } catch (error) {
          fail('templatesRender', `template "${template.id}" cannot be drawn: ${String((error as Error)?.message ?? error)}`)
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
