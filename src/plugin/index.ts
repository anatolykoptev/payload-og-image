import path from 'node:path'
import type { Config, Payload } from 'payload'
import { normaliseHeroBackground } from '../internal/colour.js'
import { type FontSpec, missingGlyphs, type Stacks } from '../internal/fonts.js'
import {
  assertFormatOption,
  type CardFormat,
  encodingOf,
  formatOf,
  groundOf,
  type JpegOptions,
  pathProblem,
  type WebpOptions,
} from '../internal/format.js'
import { createGate } from '../internal/gate.js'
import { assertPaletteOption } from '../internal/palette.js'
import { buildKindIndex } from '../internal/resolve.js'
import { CUSTOM_KEY, createState } from '../internal/state.js'
import type { OnEvent, SiteInfo } from '../internal/types.js'
import { withVariants } from '../internal/variants.js'
import type { StaticCard, Target, Template } from '../template.js'
import { withEndpoints } from './endpoints.js'
import { type OgFieldsOption, targetsCarryOg, withOgFields } from './fields.js'

export { type OgDocFields, type OgFieldsOption, ogFields } from './fields.js'

export type OgImagePluginOptions = {
  /** The site data cards draw (its name, say). Published values unless `draft` is true: then `user` is the authenticated editor. */
  site(a: { payload: Payload; draft?: boolean; user?: unknown }): Promise<SiteInfo> | SiteInfo
  /** Globals `site()` reads: saving one drops the cached `site()` result. */
  siteGlobals?: string[]
  /** TTF, OTF or WOFF faces (WOFF2 is refused). */
  fonts: FontSpec[]
  /** Font stacks by name. `default` is required: the fallback card and any text field without a stack of its own use it. */
  stacks: Stacks
  templates: Template<any>[]
  targets: Record<string, Target>
  static?: Record<string, StaticCard>
  /** Where finished cards are kept. `dir` must be an absolute path to a volume only the app writes. */
  store: { dir: string; maxFiles?: number; maxBytes?: number } | { memory: true; maxBytes?: number }
  gate?: { concurrency?: number; queue?: number }
  /** Bounds the work done before a card is found in the memo or store (database reads). Default 16 concurrent, 128 queued. */
  admission?: { concurrency?: number; queue?: number }
  /**
   * Auth collections whose users count as editors: they may see draft text in draft mode. Default: the admin user collection
   * (`admin.user`, normally `users`). A user from any other auth collection (customers, say) never gets a draft.
   */
  editors?: string[]
  memo?: { maxBytes?: number }
  seoImage?: { path: string; isDeliberate?: (image: unknown) => boolean }
  /** Hosts a hero image may be fetched from (exact hostnames, https). Default none: nothing is fetched at render time. */
  allowedImageHosts?: string[]
  /**
   * The absolute origin card URLs are built on. Default: the Payload config's `serverURL`. Pass it when setting the config's own `serverURL` would
   * change more than you want (it also makes Payload store absolute upload URLs).
   */
  serverURL?: string
  /** The colour a transparent hero is flattened onto: `#rgb` or `#rrggbb`. Unset: the hero keeps its transparency and the card shows through. It is part of the version of a card with a hero. */
  heroBackground?: string
  /**
   * How a card and a hero are palette-encoded. `card`: the renderer keeps the smaller of the truecolour PNG and a palette re-encoding
   * (default 128 colours); `hero`: the hero is cut to a palette PNG (default 256 colours). Each is `false` (truecolour, larger files,
   * no banding) or a colour count from 2 to 256. A value other than the default is part of the card version, so changing it gives new URLs.
   */
  palette?: { card?: false | number; hero?: false | number }
  /**
   * How cards are encoded: `'png'` (default), `'jpeg'` or `'webp'`. A target's own `format` wins. JPEG and WebP suit a photo-first card (a PNG of a full-bleed
   * photograph is a megabyte or more); both are opaque, so anything see-through is flattened onto `heroBackground` (white by default). Not every link-preview crawler reads WebP: see docs/crawlers.md. The format is part of the card
   * version, so switching gives new URLs. A card path whose extension names another format is refused: a JPEG target uses `.jpg`, a WebP one `.webp`.
   */
  format?: CardFormat
  /** JPEG settings: `quality` from 1 to 100 (default 82, mozjpeg). A target's own `jpeg` wins. */
  jpeg?: JpegOptions
  /** WebP settings: `quality` from 1 to 100 (default 80, libwebp). A target's own `webp` wins. */
  webp?: WebpOptions
  /** Characters every stack must draw, checked at start-up. Default `Aa’‘“”–—…`. */
  requiredSample?: string
  onEvent?: OnEvent
  /** Emit a `crawler` event for this fraction of card requests (0 < sample <= 1, e.g. 0.1). Default off. */
  crawlerEvents?: { sample: number }
  brand?: { ink?: string; paper?: string }
  /**
   * Adds the per-document `og` group (mode, headline, subtitle) to each target's collection. Off by default: the schema
   * is then exactly what it was without the option. Enabling it changes the database schema, so run `payload migrate:create`
   * in the site. `position` is `sidebar` (default) or `tab` (a "Share card" tab). To place the group yourself, use `ogFields()` (top level, named `og`).
   */
  fields?: OgFieldsOption
  /** Every card route answers 404 and no metadata is produced. */
  disabled?: boolean
}

const DEFAULT_SAMPLE = 'Aa’‘“”–—…'
const SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/
const COLOUR = /^(#[0-9a-fA-F]{3,8}|[A-Za-z]{3,20})$/
const fail = (msg: string): never => {
  throw new Error(`payload-og-image: ${msg}`)
}

function validate(o: OgImagePluginOptions, config: Config): string {
  if (typeof o.site !== 'function') fail('options.site must be a function')
  if (!Array.isArray(o.fonts) || o.fonts.length === 0) fail('options.fonts must list at least one font face')
  if (!o.stacks || typeof o.stacks !== 'object') fail('options.stacks must be an object of font stacks')
  for (const [name, stack] of Object.entries(o.stacks)) {
    if (!Array.isArray(stack) || stack.length === 0 || stack.some((f) => typeof f !== 'string'))
      fail(`stack "${name}" must be a non-empty list of family names`)
    for (const family of stack)
      if (!o.fonts.some((f) => f.family === family)) fail(`stack "${name}" names the family "${family}", which no registered font provides`)
  }
  if (!Object.hasOwn(o.stacks, 'default')) fail('options.stacks needs a "default" stack: the fallback card and unmapped text fields use it')
  let serverUrl = config.serverURL
  try {
    const u = new URL(o.serverURL ?? serverUrl ?? '')
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol')
    if (o.serverURL !== undefined) {
      // The option is an ORIGIN: card paths are appended to it, so anything more would build wrong or leaky URLs.
      if (u.username !== '' || u.password !== '') throw new Error('credentials')
      if (u.pathname !== '/' || u.search !== '' || u.hash !== '') throw new Error('not an origin')
      serverUrl = u.origin
    }
  } catch {
    fail(
      o.serverURL !== undefined
        ? `options.serverURL must be an http(s) origin such as "https://example.com" (no credentials, path, query or fragment), got ${JSON.stringify(o.serverURL)}`
        : 'the Payload config (or the `serverURL` option) needs an absolute `serverURL` (card URLs are absolute)',
    )
  }

  const templates = new Map<string, Template<any>>()
  for (const t of o.templates ?? []) {
    if (templates.has(t.id)) fail(`two templates share the id "${t.id}"`)
    templates.set(t.id, t)
  }
  const collections = new Set((config.collections ?? []).map((c) => c.slug))
  for (const [name, t] of Object.entries(o.targets ?? {})) {
    if (!SEGMENT.test(name)) fail(`target name "${name}" must be one URL-safe segment`)
    const collection = t.collection ?? name
    if (!collections.has(collection)) fail(`target "${name}" names the collection "${collection}", which does not exist`)
    if (typeof t.template === 'string' && !templates.has(t.template)) fail(`target "${name}" names the unknown template "${t.template}"`)
  }
  const kinds = buildKindIndex(o.targets ?? {}) // throws on a duplicate kind
  const seen = new Set<string>()
  for (const [key, card] of Object.entries(o.static ?? {})) {
    if (!SEGMENT.test(card.kind)) fail(`static card "${key}" kind "${card.kind}" must be one URL-safe segment`)
    if (typeof card.slug !== 'string' || card.slug === '' || card.slug.length > 256 || card.slug === '.' || card.slug === '..')
      fail(`static card "${key}" has an unusable slug`)
    if (typeof card.path !== 'string' || !card.path.startsWith('/') || /[?#]/.test(card.path))
      fail(`static card "${key}" path must be a pathname starting with "/"`)
    if (!templates.has(card.template)) fail(`static card "${key}" names the unknown template "${card.template}"`)
    if (card.alt !== undefined && typeof card.alt !== 'string' && typeof card.alt !== 'function')
      fail(`static card "${key}" alt must be a string or a function`)
    if (Object.hasOwn(kinds, card.kind)) fail(`static card "${key}" kind "${card.kind}" collides with a target kind`)
    const id = `${card.kind}/${card.slug}`
    if (seen.has(id)) fail(`two static cards share "${id}"`)
    seen.add(id)
  }
  for (const g of o.siteGlobals ?? [])
    if (!(config.globals ?? []).some((x) => x.slug === g)) fail(`siteGlobals names the global "${g}", which does not exist`)

  if (o.fields !== undefined) {
    if (!o.fields || typeof o.fields !== 'object' || typeof o.fields.enabled !== 'boolean')
      fail('options.fields must be { enabled: boolean, position?: "sidebar" | "tab" }; fields.enabled must be a boolean')
    if (o.fields.position !== undefined && o.fields.position !== 'sidebar' && o.fields.position !== 'tab')
      fail(`fields.position must be "sidebar" or "tab", got ${JSON.stringify(o.fields.position)}`)
  }

  const store = o.store as { dir?: string; memory?: true; maxFiles?: number; maxBytes?: number } | undefined
  if (!store || (store.dir === undefined) === (store.memory === undefined))
    fail('options.store needs exactly one of { dir } or { memory: true }')
  if (store?.dir !== undefined && (typeof store.dir !== 'string' || !path.isAbsolute(store.dir)))
    fail('options.store.dir must be an absolute path (there is no working-directory default)')
  createGate(o.gate) // validates concurrency and queue
  createGate(o.admission ?? { concurrency: 16, queue: 128 })
  for (const e of o.editors ?? []) {
    const c = (config.collections ?? []).find((x) => x.slug === e)
    if (!c?.auth) fail(`editors names "${e}", which is not an auth collection`)
  }
  if (o.crawlerEvents) {
    const sample = o.crawlerEvents.sample
    if (typeof sample !== 'number' || !(sample > 0 && sample <= 1))
      fail(`crawlerEvents.sample must be a fraction above 0 and at most 1, got ${String(sample)}`)
  }
  for (const host of o.allowedImageHosts ?? [])
    if (typeof host !== 'string' || host === '' || /[/:@\s]/.test(host))
      fail(`allowedImageHosts entry "${String(host)}" must be a bare hostname`)
  for (const [k, v] of Object.entries(o.brand ?? {}))
    if (typeof v !== 'string' || !COLOUR.test(v)) fail(`brand.${k} must be a hex colour or a colour name`)
  if (o.heroBackground !== undefined) normaliseHeroBackground(o.heroBackground) // throws a named error at start-up
  assertPaletteOption(o.palette)
  assertFormatOption('options', o)
  for (const [name, t] of Object.entries(o.targets ?? {})) {
    assertFormatOption(`target "${name}"`, t)
    const problem = pathProblem(t.path, t.format ?? o.format ?? 'png')
    if (problem) fail(`target "${name}" ${problem}`)
  }
  for (const [key, card] of Object.entries(o.static ?? {})) {
    assertFormatOption(`static card "${key}"`, card)
    const problem = pathProblem(card.path, card.format ?? o.format ?? 'png')
    if (problem) fail(`static card "${key}" ${problem}`)
  }
  if (o.requiredSample !== undefined && typeof o.requiredSample !== 'string') fail('requiredSample must be a string')
  return serverUrl as string
}

/**
 * The Payload plugin. Schema-neutral unless `fields.enabled`: it then adds the `og` group and nothing else (no collections or jobs).
 * It adds up to two endpoints (none when `disabled`): the admin-only `GET /payload-og-image/stats` always, and
 * `POST /payload-og-image/preview` when a target collection carries the `og` group. It stores its state in `config.custom`, hooks `afterChange` on the site globals, and checks fonts and the store when Payload starts.
 */
export function ogImagePlugin(options: OgImagePluginOptions): (config: Config) => Config {
  return (config) => {
    // Variants become hidden sibling targets before anything reads `targets`: validation, the kind index, the fields and the runtime all see them.
    const o = withVariants({ ...options, targets: options.targets ?? {} })
    const serverUrl = validate(o, config)
    const state = createState(o, serverUrl)
    const globals = (config.globals ?? []).map((g) => {
      if (!(o.siteGlobals ?? []).includes(g.slug)) return g
      return { ...g, hooks: { ...g.hooks, afterChange: [...(g.hooks?.afterChange ?? []), () => state.invalidateSite()] } }
    })
    const previousOnInit = config.onInit
    const withFields = withOgFields(config, o.targets, o.fields)
    // The preview endpoint rides with the `og` group: wherever a target collection carries it, however it got there.
    const withEndpoint = withEndpoints(withFields, state, targetsCarryOg(withFields, o.targets))
    return {
      ...withEndpoint,
      ...(config.globals ? { globals } : {}),
      custom: { ...config.custom, [CUSTOM_KEY]: state },
      onInit: async (payload) => {
        await previousOnInit?.(payload)
        if (o.disabled) return
        await selfTest(state)
      },
    }
  }
}

/**
 * Faces load (WOFF2 fails here), every stack draws the required sample, the store opens, and the fallback card is drawn once:
 * a template needs a document to be drawn, the fallback does not, so a card that cannot be drawn at all (fonts, renderer) shows
 * here and not at the first crawler request. Throws except in production, where it logs.
 */
async function selfTest(state: ReturnType<typeof createState>): Promise<void> {
  const o = state.options
  const problems: string[] = []
  try {
    const { fonts } = await state.fonts()
    const sample = o.requiredSample ?? DEFAULT_SAMPLE
    for (const [name, stack] of Object.entries(o.stacks)) {
      const missing = missingGlyphs(fonts, stack, sample)
      if (missing.length > 0) problems.push(`stack "${name}" cannot draw ${JSON.stringify(missing.join(''))}`)
    }
    await state.store().get('0'.repeat(16), '0'.repeat(12)) // boots the store: its checks emit events
    try {
      const { drawFallbackCard } = await import('../render/selfTest.js') // lazy: it loads next/og and sharp
      // The fallback is served in the format of the card that failed: draw it in every format a card can have.
      const formats = new Set<CardFormat>([
        o.format ?? 'png',
        ...Object.values(o.targets).map((t) => t.format ?? o.format ?? 'png'),
        ...Object.values(o.static ?? {}).map((c) => c.format ?? o.format ?? 'png'),
      ])
      for (const format of formats) {
        const encoding = encodingOf(format, formatOf(o, { format }).quality, groundOf(undefined, undefined))
        await drawFallbackCard({ brand: o.brand, fonts, stacks: o.stacks, host: new URL(state.serverUrl).host, siteName: sample, encoding })
      }
    } catch (error) {
      problems.push(`the fallback card cannot be drawn: ${String((error as Error)?.message ?? error)}`)
    }
  } catch (error) {
    problems.push(String((error as Error)?.message ?? error))
  }
  if (problems.length === 0) return
  const message = `payload-og-image start-up check failed: ${problems.join('; ')}`
  if (process.env.NODE_ENV === 'production') state.events.emit({ name: 'render_error', detail: { message } })
  else throw new Error(message)
}
