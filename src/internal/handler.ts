import type { ReactElement } from 'react'
import type { ImageLists, ImageShape, StaticCard, Target, Template, TemplateContext } from '../template.js'
import { drawElement, templateContext } from './draw.js'
import { type LoadedFont, type Stacks, stripMissing } from './fonts.js'
import { encodingKey, type JpegOptions, type WebpOptions } from './format.js'
import { createGate, type Gate, isShedError } from './gate.js'
import type { Memo } from './memo.js'
import { type PhotoCut, type PhotoName, photoNameOfFile } from './photo.js'
import { pooled } from './pool.js'
import {
  buildKindIndex,
  cardFile,
  type GeneratedCard,
  getPath,
  MAX_SLUG,
  ogMode,
  photosEnabled,
  type ResolvedCard,
  type ResolvedPhotos,
  type ResolveInput,
  resolveCard,
  resolvePhotos,
} from './resolve.js'
import { isWholeCard } from './store/validate.js'
import type { CardEncoding, CardFormat, CardMime, CardStore, OnEvent, SiteInfo, Size, Upload } from './types.js'
import { collectionOf, createUploadReader, type UploadField, type UploadReader, type VerifiedUpload } from './uploads.js'
import { isVariantName } from './variants.js'

export type DocSource = {
  /** Published only: never a draft, whatever the request. */
  published(target: string, slug: string): Promise<Record<string, any> | null>
  publishedById(target: string, id: string | number): Promise<Record<string, any> | null>
  /**
   * One page of a target's published documents, by id: the same published-only, access-respecting read as `published`, with
   * the uploads populated. `alsoSelect` names fields a caller needs beyond what the target reads (when the target restricts it).
   */
  listPublished?(
    target: string,
    a: { page: number; limit: number; alsoSelect?: string[] },
  ): Promise<{ docs: Record<string, any>[]; totalDocs: number }>
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
  /**
   * The uploads of one collection by id, in ONE read, with the same rule as `related`: published only and access-respecting; an editor previewing
   * sees the draft. Only the ones found are in the answer. The request's upload reader is the only caller.
   */
  uploads(
    collection: string,
    ids: string[],
    ctx: { previewing: boolean; request?: Request },
  ): Promise<ReadonlyMap<string, Record<string, any>>>
}
export type HeroLoader = {
  (
    hero: VerifiedUpload,
    box: Size,
    /** `keepAlpha`: flatten onto no ground at all, not even the plugin's `heroBackground` (a named image: a logo stays transparent). `shape`: prepare a named image by its `ImageShape` (the answer `''` is an image the shape declines, which is not a failure). `colours`: the template's own hero palette. */
    o?: { background?: string; keepAlpha?: boolean; shape?: ImageShape; colours?: false | number },
  ): Promise<string | null>
  /**
   * Whether the hero has a see-through pixel. Asked only while the site has set no `heroBackground`, to give such a card a
   * new URL (its bytes changed in 0.5.0). A loader without it (a test seam) reports none.
   */
  hasAlpha?: (hero: VerifiedUpload) => Promise<boolean>
  /** Whether the hero's file can be read at all (a read, no decode): false is why a card would be drawn without it. */
  readable?: (hero: VerifiedUpload) => Promise<boolean>
  /**
   * One size of the photo set cut from the upload's file (see `cutPhoto`): a clean crop, never drawn on. A loader without it (a test seam) serves no photo set:
   * a page then advertises none.
   */
  photo?: (hero: VerifiedUpload, a: { name: PhotoName; quality: number; ground: string }) => Promise<PhotoCut>
  /**
   * Whether this upload can be cut at all, asked of its record (no file is read): false advertises no set for it. The hero loader answers from the photo size limits it cuts with,
   * so a page never lists a photo whose URL could only fail; a test seam may refuse the uploads it has no file for (the kit's stand-in heroes). Default: every upload.
   */
  canPhoto?: (hero: VerifiedUpload) => boolean
}
/** `encoding` absent is PNG. */
export type Renderer = {
  render(el: ReactElement, o: { width: number; height: number; fonts: LoadedFont[]; encoding?: CardEncoding }): Promise<Uint8Array>
}
export type HandlerDeps = {
  targets: Record<string, Target>
  statics: Record<string, StaticCard>
  templates: Map<string, Template<any>>
  fonts: () => Promise<{ fonts: LoadedFont[]; digest: string }>
  stacks: Stacks
  /** Normalised hero background when not the default white: part of the version of a card with a hero. */
  heroBackground?: string
  /** True when the site set `heroBackground` (white included): a transparent hero is then flattened, as before 0.5.0. */
  heroFlattened?: boolean
  /** Effective palette tags when not the default: part of the version (the card's of every card, the hero's of a card with a hero). */
  cardPalette?: string
  heroPalette?: string
  /** The same for a JPEG or WebP card: an unset `palette.hero` is truecolour there (`heroColoursLossy`, drawn; `heroPaletteLossy`, its version tag). */
  heroPaletteLossy?: string
  heroColoursLossy?: false | number
  /** The plugin's card format and JPEG settings (a target's own win). Unset: PNG. */
  format?: CardFormat
  jpeg?: JpegOptions
  webp?: WebpOptions
  serverUrl: string
  source: DocSource
  store: CardStore
  renderer: Renderer
  heroLoader: HeroLoader
  /** The site's only upload collection, when it has exactly one (see `ResolveInput.uploadCollection`). */
  uploadCollection?: string
  /** The upload fields of a collection, from the schema (see `uploadFieldsOf`). Unset: no document field is filled in. */
  uploadFields?: (collection: string) => readonly UploadField[]
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

/** The upload's file could not be read or decoded: a 503, never a substitute. */
class PhotoUnreadable extends Error {}
/** The file has no such size (it is no raster image, or smaller than the record said): a 404. */
class PhotoAbsent extends Error {}

/** The last path segment, percent-decoded; undefined when it is malformed. */
const lastSegment = (pathname: string): string | undefined => {
  try {
    return decodeURIComponent(pathname.split('/').pop() as string)
  } catch {
    return undefined
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
/** `kind: 'png'` names any card image (as before 0.6); `type` is its media type. */
export type PreviewResult = { kind: 'none' } | { kind: 'png'; bytes: Uint8Array; type: CardMime; warnings: PreviewWarnings }
/** A card over this many bytes is flagged: in an editor's preview, and as an `over_budget` event when a card is served. */
export const CARD_BUDGET_BYTES = 300 * 1024

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
    o: { previewing: boolean; request?: Request; uploads?: UploadReader },
  ): Promise<ResolvedCard>
  /**
   * The photo set of a document: clean crops of its hero photograph (see `resolvePhotos`), resolved the way the route resolves them, so the URL and the `v` a page
   * lists are the route's own. Null when the target has no set or the document has no usable photograph. Reads the upload only.
   */
  photos(
    a: { target: string; doc: Record<string, any> },
    o: { previewing: boolean; request?: Request; uploads?: UploadReader },
  ): Promise<ResolvedPhotos | null>
  /** A reader for one request's uploads: callers resolving several cards of one document (the sizes of a page) share it, so each upload is read once. */
  uploads(o: { previewing: boolean; request?: Request }): UploadReader
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

  const ctxFor = (fonts: LoadedFont[], hero: string | null, images?: ImageLists): TemplateContext =>
    templateContext({ host, fonts, stacks: d.stacks, hero, images })

  /** The plugin's hero colours for a JPEG or WebP card; `undefined` (the loader's own default) for a PNG one. */
  const lossyColours = (card: GeneratedCard) => (card.encoding.format === 'png' ? undefined : d.heroColoursLossy)

  /**
   * The card's named images, prepared at the template's box for each name and never flattened (a logo stays transparent), each from its own
   * upload collection's folder. An upload whose file cannot be prepared is left out of its list and counted in `failed`.
   */
  async function loadImages(card: GeneratedCard): Promise<{ images: ImageLists; failed: number }> {
    const jobs = card.images.flatMap(({ name, uploads }) =>
      uploads.map((upload) => ({
        name,
        upload,
        box: (card.template.imageBoxes as Record<string, Size>)[name] as Size,
      })),
    )
    const loaded = await pooled(jobs, 4, (j) =>
      d.heroLoader(j.upload, j.box, {
        keepAlpha: true,
        shape: card.template.imageShapes?.[j.name],
        colours: lossyColours(card),
      }),
    )
    const images: Record<string, string[]> = Object.create(null)
    let failed = 0
    jobs.forEach((j, n) => {
      const url = loaded[n]
      if (url === null || url === undefined) failed += 1
      else if (url === '')
        return // the image's shape declined it (a logo that makes no halftone): nothing to draw, and not a failure
      else images[j.name] = [...(Object.hasOwn(images, j.name) ? (images[j.name] as string[]) : []), url]
    })
    return { images: images as unknown as ImageLists, failed }
  }

  function staticTarget(card: StaticCard): Target {
    return {
      path: card.path,
      kind: card.kind,
      template: card.template,
      format: card.format,
      jpeg: card.jpeg,
      webp: card.webp,
      props: async ({ site }) => card.props({ payload: await d.payload?.(), site }),
      alt:
        card.alt === undefined
          ? undefined
          : typeof card.alt === 'string'
            ? () => card.alt as string
            : ({ props, site }) =>
                (card.alt as (a: { props: never; site: SiteInfo }) => string | null | undefined)({ props: props as never, site }),
    }
  }

  async function draw(card: GeneratedCard, fonts: LoadedFont[], o: { quiet?: boolean } = {}) {
    const t0 = Date.now()
    // After the store miss and inside the gate: a cache hit pays for none of this.
    const hero = card.hero
      ? await d.heroLoader(card.hero, card.template.heroBox ?? card.size, {
          background: card.heroBackground,
          colours: card.template.heroColours ?? lossyColours(card),
        })
      : null
    const { images, failed } = await loadImages(card)
    const { bytes, dropped } = await drawElement(d.renderer, card.template.render(card.props, ctxFor(fonts, hero, images)), {
      ...card.size,
      fonts,
      encoding: card.encoding,
    })
    // Characters no face draws that came from somewhere other than a `textFields` prop (another prop, a glyph in the template itself).
    if (dropped.length > 0 && !o.quiet)
      d.events.emit({ name: 'glyph_missing', kind: card.key.kind, slug: card.key.slug, detail: { chars: dropped } })
    // A preview draw is not a render of a real card: no `render` event, so the counters stay about served cards.
    if (!o.quiet) {
      d.events.emit({ name: 'render', kind: card.key.kind, slug: card.key.slug, v: card.v, ms: Date.now() - t0, bytes: bytes.byteLength })
      if (bytes.byteLength > CARD_BUDGET_BYTES)
        d.events.emit({ name: 'over_budget', kind: card.key.kind, slug: card.key.slug, v: card.v, bytes: bytes.byteLength })
    }
    return { bytes, dropped, downgraded: (card.hero != null && hero == null) || failed > 0 }
  }

  /** The brand fallback card. A draft-mode request never memoises it (its site name may be draft text). */
  async function fallbackCard(
    site: SiteInfo,
    fonts: LoadedFont[],
    digest: string,
    previewing: boolean,
    encoding: CardEncoding,
  ): Promise<Uint8Array | null> {
    // The fallback draws with the `default` stack: characters it has no glyph for are dropped, as for any card.
    const stack = d.stacks.default
    const stripped = stack && stack.length > 0 ? stripMissing(fonts, stack, site.name) : { text: site.name, missing: [] }
    // Stripping leaves holes ("a 🚀 b" -> "a  b"): close them. A name that lost nothing is left exactly as given.
    const name = stripped.missing.length > 0 ? stripped.text.replace(/\s+/g, ' ').trim() : stripped.text
    const make = () =>
      d.gate.run(
        async () =>
          (await drawElement(d.renderer, d.fallback.render({ site: name }, ctxFor(fonts, null)), { ...d.fallback.size, fonts, encoding }))
            .bytes,
      )
    try {
      return previewing
        ? await make()
        : await d.memo.get(`fallback|${digest}|${d.fallback.revision}|${encodingKey(encoding)}|${name}`, make)
    } catch {
      return null
    }
  }

  const readerFor = (o: { previewing: boolean; request?: Request }) =>
    createUploadReader((collection, ids) => d.source.uploads(collection, ids, o))

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
    uploads: UploadReader
  }) {
    return resolveCard({
      target: a.target,
      targetName: a.targetName,
      variant: isVariantName(d.targets, a.targetName),
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
      heroPaletteLossy: d.heroPaletteLossy,
      format: d.format,
      jpeg: d.jpeg,
      webp: d.webp,
      seoImage: a.isStatic ? undefined : d.seoImage,
      uploadCollection: d.uploadCollection,
      related: (collection, id) => d.source.related(collection, id, { previewing: a.previewing, request: a.request }),
      uploads: a.uploads,
      uploadFields: a.isStatic ? undefined : d.uploadFields?.(a.target.collection ?? a.targetName),
    })
  }

  async function resolve(
    a: { target: string; doc: Record<string, any> } | { staticKey: string },
    o: { previewing: boolean; request?: Request; uploads?: UploadReader },
  ) {
    const uploads = o.uploads ?? readerFor(o)
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
        uploads,
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
      uploads,
    })
  }

  async function photos(
    a: { target: string; doc: Record<string, any> },
    o: { previewing: boolean; request?: Request; uploads?: UploadReader },
  ): Promise<ResolvedPhotos | null> {
    if (!Object.hasOwn(d.targets, a.target)) throw new Error(`payload-og-image: no target "${a.target}"`)
    const target = d.targets[a.target] as Target
    return resolvePhotos({
      target,
      targetName: a.target,
      variant: isVariantName(d.targets, a.target),
      doc: a.doc,
      // Only a resolver's argument: the photo needs no fonts, no template and no card.
      site: await d.source.site(o.previewing ? o.request : undefined),
      serverUrl: d.serverUrl,
      heroBackground: d.heroBackground,
      jpeg: d.jpeg,
      related: (collection, id) => d.source.related(collection, id, { previewing: o.previewing, request: o.request }),
      uploads: o.uploads ?? readerFor(o),
      uploadFields: d.uploadFields?.(target.collection ?? a.target),
      uploadCollection: d.uploadCollection,
      canCut: (upload) => d.heroLoader.photo !== undefined && (d.heroLoader.canPhoto?.(upload) ?? true),
    })
  }

  /**
   * One image of the photo set, served through the card route's own machinery: the memo (single-flight), the store under a page id of its own per size, the etag and the
   * cache headers. Never a card: a missing or unusable photograph is a 404 (the page advertises none), an unreadable file a 503. A size whose produced pixels are not the
   * ones the page advertised (the upload's record disagreed with its file) is served briefly and never stored, so no version ever holds bytes of another size.
   */
  async function servePhoto(
    request: Request,
    a: { target: Target; targetName: string; slug: string; name: PhotoName },
    previewing: boolean,
  ): Promise<Response> {
    const prepared = await admission.run(async () => {
      const doc =
        (previewing ? await d.source.draft(a.targetName, { slug: a.slug }, request) : null) ??
        (await d.source.published(a.targetName, a.slug))
      return doc ? photos({ target: a.targetName, doc }, { previewing, request }) : null
    })
    const image = prepared?.images.find((i) => i.name === a.name)
    if (!prepared || !image) return notFound()
    const { key, upload } = prepared
    const type = { 'content-type': 'image/jpeg', etag: `"${image.v}"` }
    const photo = d.heroLoader.photo as NonNullable<HeroLoader['photo']>
    const cut = async () => {
      const t0 = Date.now()
      const out = await d.gate.run(() => photo(upload, { name: a.name, quality: prepared.quality, ground: prepared.ground }))
      if (out.status === 'unreadable') throw new PhotoUnreadable()
      if (out.status === 'absent') throw new PhotoAbsent()
      if (!(await isWholeCard(out.bytes, 'jpeg'))) throw new PhotoUnreadable()
      if (!previewing)
        d.events.emit({ name: 'render', kind: key.kind, slug: key.slug, v: image.v, ms: Date.now() - t0, bytes: out.bytes.byteLength })
      return out
    }
    try {
      if (previewing) {
        d.events.emit({ name: 'draft', kind: key.kind, slug: key.slug })
        const { bytes } = await cut()
        return respond(200, CACHE.none, { ...type, 'x-og-cache': 'draft' }, bytes)
      }
      const served: { source: 'memo' | 'store' | 'render' | 'downgraded' } = { source: 'memo' }
      const bytes = await d.memo
        .get(`${image.pageId}|${image.v}`, async () => {
          const stored = await d.store.get(image.pageId, image.v, 'jpeg')
          if (stored) {
            served.source = 'store'
            return stored
          }
          const out = await cut()
          if (out.status === 'ok' && (out.width !== image.width || out.height !== image.height)) throw new Downgraded(out.bytes)
          served.source = 'render'
          await d.store.put(image.pageId, image.v, out.bytes, 'jpeg')
          return out.bytes
        })
        .catch((e) => {
          if (e instanceof Downgraded) {
            served.source = 'downgraded'
            return e.bytes
          }
          throw e
        })
      if (served.source === 'downgraded') {
        d.events.emit({
          name: 'downgraded',
          kind: key.kind,
          slug: key.slug,
          v: image.v,
          detail: { reason: 'photo size differs from the upload record' },
        })
        return respond(200, CACHE.degraded, { 'content-type': 'image/jpeg', 'x-og-cache': 'downgraded' }, bytes)
      }
      if (served.source !== 'render')
        d.events.emit({ name: served.source === 'memo' ? 'hit_memo' : 'hit_store', kind: key.kind, slug: key.slug, v: image.v })
      const current = new URL(request.url).searchParams.get('v') === image.v // only picks the cache header, never a key
      const cache = current ? CACHE.immutable : CACHE.short
      if (current && etagMatches(request.headers.get('if-none-match'), image.v))
        return respond(304, cache, { ...type, 'x-og-cache': served.source })
      return respond(200, cache, { ...type, 'x-og-cache': served.source }, bytes)
    } catch (error) {
      if (isShedError(error)) {
        d.events.emit({ name: 'shed', kind: key.kind, slug: key.slug })
        return unavailable()
      }
      if (error instanceof PhotoAbsent) return notFound()
      d.events.emit({ name: 'render_error', kind: key.kind, slug: key.slug, detail: { message: `photo ${a.name}: ${errMessage(error)}` } })
      return unavailable() // never a card in its place: a page that advertised a photograph gets a photograph or an error
    }
  }

  async function preview(a: { target: string; doc: Record<string, any>; request: Request }): Promise<PreviewResult> {
    if (!Object.hasOwn(d.targets, a.target)) throw new Error(`payload-og-image: no target "${a.target}"`)
    const target = d.targets[a.target] as Target
    const uploads = readerFor({ previewing: true, request: a.request })
    const run = (doc: Record<string, any>, fonts: LoadedFont[], digest: string, site: SiteInfo) =>
      cardFor({ target, targetName: a.target, doc, site, fonts, digest, isStatic: false, previewing: true, request: a.request, uploads })
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
      type: forced.type,
      warnings: {
        missing: [...new Set([...forced.missing, ...dropped])],
        overBudget: bytes.byteLength > CARD_BUDGET_BYTES,
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

    // A photo-set image (`photo-16x9.jpg` beside the card) is no card: it is resolved, drawn and answered on its own path, before any card rule (an editor's own
    // share image, a blank title or the card's file name) can turn it away. It exists only where `photosEnabled` says so, the rule the page's helper uses too.
    const asked = lastSegment(new URL(request.url).pathname)
    const photoName = asked === undefined ? undefined : photoNameOfFile(asked)
    if (
      photoName !== undefined &&
      staticCard === undefined &&
      targetName !== undefined &&
      photosEnabled(target, isVariantName(d.targets, targetName))
    )
      return servePhoto(request, { target, targetName, slug, name: photoName }, previewing)

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
        uploads: readerFor({ previewing, request }),
      })
      return { card, fonts, digest, site, doc }
    })
    if (!prepared) return notFound()
    const { card, fonts, digest, site } = prepared
    if (card.kind !== 'generated') return notFound()
    // A card is served under its own file name only (`card.jpg` for a JPEG card) where the route cannot say so itself: a path with `:ext`, or a route with a
    // parameter besides `kind`, `slug` and `id` (a `[file]` catch-all, which would otherwise answer `card.jpg` for a classic PNG). The name is read from the
    // request's pathname, never from a param: a static `card.png` route has none. A fixed route keeps its behaviour (its pathname is its own).
    if (/:ext\b/.test(target.path) || Object.keys(p).some((k) => k !== 'kind' && k !== 'slug' && k !== 'id')) {
      const asked = lastSegment(new URL(request.url).pathname)
      if (asked === undefined || asked !== cardFile(target, targetName ?? (staticCard as StaticCard).kind, slug, card.encoding.format))
        return notFound()
    }
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
          const stored = await d.store.get(card.pageId, card.v, card.encoding.format)
          if (stored) {
            served.source = 'store'
            return stored
          }
          const out = await d.gate.run(() => draw(card, fonts))
          if (out.downgraded) throw new Downgraded(out.bytes) // the memo forgets it; every joiner gets this rejection
          served.source = 'render'
          await d.store.put(card.pageId, card.v, out.bytes, card.encoding.format)
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
      if (isShedError(error)) {
        d.events.emit({ name: 'shed', kind: card.key.kind, slug: card.key.slug })
        return unavailable()
      }
      d.events.emit({ name: 'render_error', kind: card.key.kind, slug: card.key.slug, detail: { message: errMessage(error) } })
      const fb = await fallbackCard(site, fonts, digest, previewing, card.encoding)
      if (!fb) return unavailable()
      return respond(200, previewing ? CACHE.none : CACHE.degraded, { 'content-type': card.type, 'x-og-cache': 'fallback' }, fb)
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
      if (isShedError(error)) {
        d.events.emit({ name: 'shed' })
        return unavailable()
      }
      d.events.emit({ name: 'render_error', detail: { message: errMessage(error) } })
      return unavailable()
    }
  }
  return { GET, resolve, photos, preview, uploads: readerFor }
}
