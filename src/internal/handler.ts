import type { ReactElement } from 'react'
import type { StaticCard, Target, Template, TemplateContext } from '../template.js'
import { drawElement, templateContext } from './draw.js'
import { type LoadedFont, type Stacks, stripMissing } from './fonts.js'
import { createGate, type Gate, ShedError } from './gate.js'
import type { Memo } from './memo.js'

import {
  buildKindIndex,
  type GeneratedCard,
  getPath,
  MAX_SLUG,
  ogMode,
  type ResolvedCard,
  type ResolveInput,
  resolveCard,
} from './resolve.js'

import type { CardStore, OnEvent, SiteInfo, Size, Upload } from './types.js'

export type DocSource = {
  /** Published only: never a draft, whatever the request. */
  published(target: string, slug: string): Promise<Record<string, any> | null>
  publishedById(target: string, id: string | number): Promise<Record<string, any> | null>
  /** The draft, or null unless the request carries an authenticated editor. */
  draft(target: string, key: { slug?: string; id?: string | number }, request: Request): Promise<Record<string, any> | null>
  /**
   * Cached when called without a request. With a request (a draft-mode one) it must return draft site data
   * ONLY for an authenticated editor, and the published site data otherwise.
   */
  site(request?: Request): Promise<SiteInfo>
  /**
   * A related document for a target's resolvers: published only and access-respecting; in draft mode for an authenticated
   * editor, the draft. Null when it does not exist or may not be read. Never a draft for anyone else.
   */
  related(collection: string, id: string | number, ctx: { previewing: boolean; request?: Request }): Promise<Record<string, any> | null>
}
export type HeroLoader = {
  (hero: Upload, box: Size, o?: { collection?: string }): Promise<string | null>
  /**
   * Whether the hero has a see-through pixel. Asked only while the site has set no `heroBackground`, to give such a card a
   * new URL (its bytes changed in 0.4.1). A loader without it (a test seam) reports none.
   */
  hasAlpha?: (hero: Upload, o?: { collection?: string }) => Promise<boolean>
}
export type Renderer = { render(el: ReactElement, o: { width: number; height: number; fonts: LoadedFont[] }): Promise<Uint8Array> }
export type HandlerDeps = {
  targets: Record<string, Target>
  statics: Record<string, StaticCard>
  templates: Map<string, Template<any>>
  fonts: () => Promise<{ fonts: LoadedFont[]; digest: string }>
  stacks: Stacks
  /** Normalised hero background when not the default white: part of the version of a card with a hero. */
  heroBackground?: string
  /** True when the site set `heroBackground` (white included): a transparent hero is then flattened, as before 0.4.1. */
  heroFlattened?: boolean
  /** Effective palette tags when not the default: part of the version (the card's of every card, the hero's of a card with a hero). */
  cardPalette?: string
  heroPalette?: string
  serverUrl: string
  source: DocSource
  store: CardStore
  renderer: Renderer
  heroLoader: HeroLoader
  gate: Gate
  memo: Memo
  events: { emit: OnEvent }
  /** True for a draft-mode request. A rejection is treated as true: when unsure, never cache. */
  isDraftRequest(r: Request): Promise<boolean>
  fixedTarget?: string
  seoImage?: ResolveInput['seoImage']
  fallback: Template<{ site: string }>
  /** Handed to a static card's `props`. */
  payload?: () => Promise<unknown>
  /** Bounds the work done before a card is looked up in the memo or store (database reads, resolution). Default 16 + 128. */
  admission?: Gate
}
export type RouteContext = { params: Promise<Record<string, string | undefined>> }

export const CACHE = {
  immutable: 'public, max-age=31536000, immutable, no-transform',
  short: 'public, max-age=3600, no-transform',
  degraded: 'public, max-age=300, no-transform',
  none: 'no-store',
} as const

/** A hero that could not be prepared: the card is drawn without it, served briefly, never stored or memoised. */
class Downgraded extends Error {
  constructor(readonly bytes: Uint8Array) {
    super('downgraded')
  }
}

const errMessage = (e: unknown) => String((e as Error)?.message ?? e)

/** Does an If-None-Match header (a list, possibly weak or `*`) name this version's ETag? */
function etagMatches(header: string | null, v: string): boolean {
  if (!header) return false
  return header.split(',').some((t) => {
    const tag = t.trim()
    return tag === '*' || tag === `"${v}"` || tag === `W/"${v}"`
  })
}

/** What an editor's preview says about the card, beyond the picture. */
export type PreviewWarnings = {
  /** Characters no font in the stack draws (they are left out of the card). */
  missing: string[]
  overBudget: boolean
  /** Mode `custom`, but the editor's image cannot be shared (an SVG, or no size on record): a generated card is shown. */
  customIneligible: boolean
  /** The shared image is smaller than 600x315. */
  customTooSmall: boolean
  /** The page shares an image (the editor's, or one the target offers) instead of the generated card: a new nonce cannot change its URL. */
  sharesImage: boolean
  /** Mode `off`: the page advertises no card of its own; the picture is what `generated` would show. */
  modeOff: boolean
}
export type PreviewResult = { kind: 'none' } | { kind: 'png'; bytes: Uint8Array; warnings: PreviewWarnings }
/** A card over this many bytes is flagged in a preview. */
export const PREVIEW_BUDGET_BYTES = 300 * 1024

export type CardHandler = {
  /**
   * The generated card for a document an editor is typing (`doc` already authorised and assembled by the caller), drawn
   * through the render gate and returned, never kept: the memo and the store are not touched. Whatever the document's mode,
   * the card shown is the one `generated` would draw. Throws `ShedError` when the gate is full.
   */
  preview(a: { target: string; doc: Record<string, any>; request: Request }): Promise<PreviewResult>
  GET(r: Request, c: RouteContext): Promise<Response>
  /**
   * What a page should advertise for a document or a static card: the same resolution the route runs, so the
   * `v` in the page's og:image is the route's etag. `target` names a target (its `doc` already read), `staticKey`
   * is `<kind>/<slug>`.
   */
  resolve(
    a: { target: string; doc: Record<string, any> } | { staticKey: string },
    o: { previewing: boolean; request?: Request },
  ): Promise<ResolvedCard>
}

export function createCardHandler(d: HandlerDeps): CardHandler {
  let serverUrl: URL
  try {
    serverUrl = new URL(d.serverUrl)
  } catch {
    throw new Error(`payload-og-image: serverUrl must be an absolute URL, got "${d.serverUrl}"`)
  }
  if (serverUrl.protocol !== 'https:' && serverUrl.protocol !== 'http:')
    throw new Error(`payload-og-image: serverUrl must be http(s), got "${d.serverUrl}"`)
  const host = serverUrl.host // never taken from a request

  const kindIndex = buildKindIndex(d.targets)
  const statics = new Map<string, StaticCard>()
  for (const card of Object.values(d.statics)) {
    const key = `${card.kind}/${card.slug}`
    if (statics.has(key)) throw new Error(`payload-og-image: two static cards share "${key}"`)
    if (Object.hasOwn(kindIndex, card.kind))
      throw new Error(`payload-og-image: static card kind "${card.kind}" collides with a target kind`)
    statics.set(key, card)
  }

  const admission = d.admission ?? createGate({ concurrency: 16, queue: 128 })
  const respond = (status: number, cache: string, extra: Record<string, string> = {}, body?: Uint8Array) =>
    new Response(body ? new Uint8Array(body) : null, {
      status,
      headers: { 'cache-control': cache, ...extra, ...(body ? { 'content-length': String(body.byteLength) } : {}) },
    })
  const notFound = () => {
    d.events.emit({ name: 'not_found' })
    return respond(404, CACHE.none, { 'content-type': 'text/plain' }, new TextEncoder().encode('Not found'))
  }
  const unavailable = () => respond(503, CACHE.none, { 'retry-after': '5' })

  const ctxFor = (fonts: LoadedFont[], hero: string | null): TemplateContext => templateContext({ host, fonts, stacks: d.stacks, hero })

  function staticTarget(card: StaticCard): Target {
    return {
      path: card.path,
      kind: card.kind,
      template: card.template,
      props: async ({ site }) => card.props({ payload: await d.payload?.(), site }),
    }
  }

  async function draw(card: GeneratedCard, fonts: LoadedFont[], o: { quiet?: boolean } = {}) {
    const t0 = Date.now()
    // After the store miss and inside the gate: a cache hit pays for none of this.
    const hero = card.hero ? await d.heroLoader(card.hero, card.template.heroBox ?? card.size, { collection: card.heroCollection }) : null
    const { bytes, dropped } = await drawElement(d.renderer, card.template.render(card.props, ctxFor(fonts, hero)), { ...card.size, fonts })
    // Characters no face draws that came from somewhere other than a `textFields` prop (another prop, a glyph in the template itself).
    if (dropped.length > 0 && !o.quiet)
      d.events.emit({ name: 'glyph_missing', kind: card.key.kind, slug: card.key.slug, detail: { chars: dropped } })
    // A preview draw is not a render of a real card: no `render` event, so the counters stay about served cards.
    if (!o.quiet)
      d.events.emit({ name: 'render', kind: card.key.kind, slug: card.key.slug, v: card.v, ms: Date.now() - t0, bytes: bytes.byteLength })
    return { bytes, dropped, downgraded: card.hero != null && hero == null }
  }

  /** The brand fallback card. A draft-mode request never memoises it (its site name may be draft text). */
  async function fallbackCard(site: SiteInfo, fonts: LoadedFont[], digest: string, previewing: boolean): Promise<Uint8Array | null> {
    // The fallback draws with the `default` stack: characters it has no glyph for are dropped, as for any card.
    const stack = d.stacks.default
    const stripped = stack && stack.length > 0 ? stripMissing(fonts, stack, site.name) : { text: site.name, missing: [] }
    // Stripping leaves holes ("a 🚀 b" -> "a  b"): close them. A name that lost nothing is left exactly as given.
    const name = stripped.missing.length > 0 ? stripped.text.replace(/\s+/g, ' ').trim() : stripped.text
    const make = () =>
      d.gate.run(
        async () =>
          (await drawElement(d.renderer, d.fallback.render({ site: name }, ctxFor(fonts, null)), { ...d.fallback.size, fonts })).bytes,
      )
    try {
      return previewing ? await make() : await d.memo.get(`fallback|${digest}|${d.fallback.revision}|${name}`, make)
    } catch {
      return null
    }
  }

  function cardFor(a: {
    target: Target
    targetName: string
    doc: Record<string, any>
    site: SiteInfo
    fonts: LoadedFont[]
    digest: string
    isStatic: boolean
    previewing: boolean
    request?: Request
  }) {
    return resolveCard({
      target: a.target,
      targetName: a.targetName,
      doc: a.doc,
      site: a.site,
      host,
      serverUrl: d.serverUrl,
      templates: d.templates,
      fonts: a.fonts,
      fontsDigest: a.digest,
      stacks: d.stacks,
      heroBackground: d.heroBackground,
      heroFlattened: d.heroFlattened,
      heroHasAlpha: d.heroLoader.hasAlpha,
      cardPalette: d.cardPalette,
      heroPalette: d.heroPalette,
      seoImage: a.isStatic ? undefined : d.seoImage,
      related: (collection, id) => d.source.related(collection, id, { previewing: a.previewing, request: a.request }),
    })
  }

  async function resolve(
    a: { target: string; doc: Record<string, any> } | { staticKey: string },
    o: { previewing: boolean; request?: Request },
  ) {
    const [{ fonts, digest }, site] = await Promise.all([d.fonts(), d.source.site(o.previewing ? o.request : undefined)])
    if ('staticKey' in a) {
      const card = statics.get(a.staticKey)
      if (!card) throw new Error(`payload-og-image: no static card "${a.staticKey}"`)
      return cardFor({
        target: staticTarget(card),
        targetName: card.kind,
        doc: { slug: card.slug },
        site,
        fonts,
        digest,
        isStatic: true,
        previewing: o.previewing,
        request: o.request,
      })
    }
    if (!Object.hasOwn(d.targets, a.target)) throw new Error(`payload-og-image: no target "${a.target}"`)
    return cardFor({
      target: d.targets[a.target] as Target,
      targetName: a.target,
      doc: a.doc,
      site,
      fonts,
      digest,
      isStatic: false,
      previewing: o.previewing,
      request: o.request,
    })
  }

  async function preview(a: { target: string; doc: Record<string, any>; request: Request }): Promise<PreviewResult> {
    if (!Object.hasOwn(d.targets, a.target)) throw new Error(`payload-og-image: no target "${a.target}"`)
    const target = d.targets[a.target] as Target
    const run = (doc: Record<string, any>, fonts: LoadedFont[], digest: string, site: SiteInfo) =>
      cardFor({ target, targetName: a.target, doc, site, fonts, digest, isStatic: false, previewing: true, request: a.request })
    const og = a.doc.og !== null && typeof a.doc.og === 'object' && !Array.isArray(a.doc.og) ? a.doc.og : {}
    const mode = ogMode(a.doc)
    // A document not saved yet has no slug: a placeholder lets it be drawn. It is never a URL, a key or a store entry here.
    const slugField = target.slugField ?? 'slug'
    const slug = getPath(a.doc, slugField)
    const usable =
      typeof slug === 'number' ||
      (typeof slug === 'string' && slug.trim() !== '' && slug.length <= MAX_SLUG && slug !== '.' && slug !== '..')
    const doc = usable || slugField.includes('.') ? a.doc : { ...a.doc, [slugField]: '_preview' }
    const { actual, forced, fonts } = await admission.run(async () => {
      const [{ fonts, digest }, site] = await Promise.all([d.fonts(), d.source.site(a.request)])
      const actual = await run(doc, fonts, digest, site)
      // Resolved once: a generated card (or a blank one, which no mode can fix) is already the answer; only an image or
      // `off` needs the generated card resolved as well.
      const forced =
        actual.kind === 'generated' || (actual.kind === 'none' && mode !== 'off')
          ? actual
          : await run({ ...doc, og: { ...og, mode: 'generated' } }, fonts, digest, site)
      return { fonts, actual, forced }
    })
    if (forced.kind !== 'generated') return { kind: 'none' }
    const { bytes, dropped } = await d.gate.run(() => draw(forced, fonts, { quiet: true }))
    return {
      kind: 'png',
      bytes,
      warnings: {
        missing: [...new Set([...forced.missing, ...dropped])],
        overBudget: bytes.byteLength > PREVIEW_BUDGET_BYTES,
        customIneligible: mode === 'custom' && actual.kind === 'generated',
        customTooSmall: actual.kind === 'own' && ((actual.image.width ?? 0) < 600 || (actual.image.height ?? 0) < 315),
        modeOff: mode === 'off',
        sharesImage: actual.kind === 'own',
      },
    }
  }

  async function serve(request: Request, rc: RouteContext, previewing: boolean): Promise<Response> {
    const p = await rc.params // decoded by Next: never decode again
    // `:id` paths carry the key as `params.id`; `:slug` paths as `params.slug`.
    const slug = p.slug ?? p.id
    const urlKind = p.kind
    if (typeof slug !== 'string' || slug === '' || slug.length > MAX_SLUG) return notFound()
    const kind = d.fixedTarget ?? urlKind
    // A route pinned to a target serves that target only: statics are for the unpinned route.
    const staticCard = d.fixedTarget === undefined && typeof kind === 'string' ? statics.get(`${kind}/${slug}`) : undefined
    const targetName = staticCard
      ? undefined
      : (d.fixedTarget ?? (typeof urlKind === 'string' && Object.hasOwn(kindIndex, urlKind) ? kindIndex[urlKind] : undefined))
    const target = staticCard
      ? staticTarget(staticCard)
      : targetName !== undefined && Object.hasOwn(d.targets, targetName)
        ? d.targets[targetName]
        : undefined
    if (!target) return notFound()

    // Pre-admission work (fonts, site, the document lookup, resolution) is bounded by its own small gate, separate from
    // the render gate: a burst of distinct slugs cannot open unbounded database reads before anything is shed.
    const prepared = await admission.run(async () => {
      // Settle BOTH before leaving: a failure in one must not release the admission slot while the other (a database read) keeps running.
      const [fontsResult, siteResult] = await Promise.allSettled([d.fonts(), d.source.site(previewing ? request : undefined)])
      if (fontsResult.status === 'rejected') throw fontsResult.reason
      if (siteResult.status === 'rejected') throw siteResult.reason
      const { fonts, digest } = fontsResult.value
      const site = siteResult.value
      // A draft-mode request must not reach the published-only memo/store paths, even if a lookup below fails.
      const doc = staticCard
        ? { slug }
        : ((previewing ? await d.source.draft(targetName as string, { slug }, request) : null) ??
          (await d.source.published(targetName as string, slug)))
      if (!doc) return null

      const card = await cardFor({
        target,
        targetName: targetName ?? (staticCard as StaticCard).kind,
        doc,
        site,
        fonts,
        digest,
        isStatic: staticCard !== undefined,
        previewing,
        request,
      })
      return { card, fonts, digest, site, doc }
    })
    if (!prepared) return notFound()
    const { card, fonts, digest, site } = prepared
    if (card.kind !== 'generated') return notFound()
    if (card.missing.length)
      d.events.emit({ name: 'glyph_missing', kind: card.key.kind, slug: card.key.slug, detail: { chars: card.missing } })
    const type = { 'content-type': card.type, etag: `"${card.v}"` }

    try {
      if (previewing) {
        d.events.emit({ name: 'draft', kind: card.key.kind, slug: card.key.slug })
        const { bytes } = await d.gate.run(() => draw(card, fonts))
        return respond(200, CACHE.none, { ...type, 'x-og-cache': 'draft' }, bytes)
      }
      const requested = new URL(request.url).searchParams.get('v') // only picks the cache header, never a key
      const current = requested === card.v
      const cache = current ? CACHE.immutable : CACHE.short
      const served: { source: 'memo' | 'store' | 'render' | 'downgraded' } = { source: 'memo' }
      const bytes = await d.memo
        .get(`${card.pageId}|${card.v}`, async () => {
          const stored = await d.store.get(card.pageId, card.v)
          if (stored) {
            served.source = 'store'
            return stored
          }
          const out = await d.gate.run(() => draw(card, fonts))
          if (out.downgraded) throw new Downgraded(out.bytes) // the memo forgets it; every joiner gets this rejection
          served.source = 'render'
          await d.store.put(card.pageId, card.v, out.bytes)
          return out.bytes
        })
        .catch((e) => {
          if (e instanceof Downgraded) {
            served.source = 'downgraded' // decided per request, outside the memo closure
            return e.bytes
          }
          throw e
        })
      if (served.source === 'downgraded') {
        d.events.emit({ name: 'downgraded', kind: card.key.kind, slug: card.key.slug, v: card.v })
        // No etag: a cache must never revalidate this hero-less card into a 304 that pins it as the current version.
        return respond(200, CACHE.degraded, { 'content-type': card.type, 'x-og-cache': 'downgraded' }, bytes)
      }
      // A fresh render was already counted by draw(); only hits are emitted here.
      if (served.source !== 'render') {
        d.events.emit({ name: served.source === 'memo' ? 'hit_memo' : 'hit_store', kind: card.key.kind, slug: card.key.slug, v: card.v })
      }
      // A 304 only now: the current bytes exist (memo, store or a render that just succeeded), so a revalidation can never
      // pin a card that would have been downgraded, replaced by the fallback or shed.
      if (current && etagMatches(request.headers.get('if-none-match'), card.v)) {
        return respond(304, cache, { ...type, 'x-og-cache': served.source })
      }
      return respond(200, cache, { ...type, 'x-og-cache': served.source }, bytes)
    } catch (error) {
      if (error instanceof ShedError) {
        d.events.emit({ name: 'shed', kind: card.key.kind, slug: card.key.slug })
        return unavailable()
      }
      d.events.emit({ name: 'render_error', kind: card.key.kind, slug: card.key.slug, detail: { message: errMessage(error) } })
      const fb = await fallbackCard(site, fonts, digest, previewing)
      if (!fb) return unavailable()
      return respond(200, previewing ? CACHE.none : CACHE.degraded, { 'content-type': 'image/png', 'x-og-cache': 'fallback' }, fb)
    }
  }

  async function GET(request: Request, rc: RouteContext): Promise<Response> {
    // ANY draft-mode request: no memo, no store, no-store. If that cannot be decided, assume it is one.
    let previewing = true
    try {
      previewing = await d.isDraftRequest(request)
    } catch (error) {
      d.events.emit({ name: 'render_error', detail: { message: `draft check failed: ${errMessage(error)}` } })
    }
    try {
      return await serve(request, rc, previewing)
    } catch (error) {
      // Before a card existed (params, fonts, site, lookup, resolve): nothing may escape, nothing is cached.
      if (error instanceof ShedError) {
        d.events.emit({ name: 'shed' })
        return unavailable()
      }
      d.events.emit({ name: 'render_error', detail: { message: errMessage(error) } })
      return unavailable()
    }
  }
  return { GET, resolve, preview }
}
