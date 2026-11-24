import path from 'node:path'
import type { Config, Payload } from 'payload'
import { type FontSpec, missingGlyphs, type Stacks } from '../internal/fonts.js'
import { createGate } from '../internal/gate.js'
import { assertInt } from '../internal/limits.js'
import { buildKindIndex } from '../internal/resolve.js'
import { CUSTOM_KEY, createState } from '../internal/state.js'
import type { OnEvent, SiteInfo } from '../internal/types.js'
import type { StaticCard, Target, Template } from '../template.js'

export type OgImagePluginOptions = {
  /** The site data cards draw (its name, say). Published values unless `draft` is true (an authenticated editor in draft mode). */
  site(a: { payload: Payload; draft?: boolean }): Promise<SiteInfo> | SiteInfo
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
  memo?: { maxBytes?: number }
  seoImage?: { path: string; isDeliberate?: (image: unknown) => boolean }
  /** Hosts a hero image may be fetched from (exact hostnames, https). Default none: nothing is fetched at render time. */
  allowedImageHosts?: string[]
  /** Characters every stack must draw, checked at start-up. Default `Aa’‘“”–—…`. */
  requiredSample?: string
  onEvent?: OnEvent
  /** Emit a `crawler` event for one request in `sample` (default off). */
  crawlerEvents?: { sample: number }
  brand?: { ink?: string; paper?: string }
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
  const serverUrl = config.serverURL
  try {
    const u = new URL(serverUrl ?? '')
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol')
  } catch {
    fail('the Payload config needs an absolute `serverURL` (card URLs are absolute)')
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
    if (t.depth !== undefined) assertInt(`target "${name}" depth`, t.depth, 0, 10)
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
    if (Object.hasOwn(kinds, card.kind)) fail(`static card "${key}" kind "${card.kind}" collides with a target kind`)
    const id = `${card.kind}/${card.slug}`
    if (seen.has(id)) fail(`two static cards share "${id}"`)
    seen.add(id)
  }
  for (const g of o.siteGlobals ?? [])
    if (!(config.globals ?? []).some((x) => x.slug === g)) fail(`siteGlobals names the global "${g}", which does not exist`)

  const store = o.store as { dir?: string; memory?: true; maxFiles?: number; maxBytes?: number } | undefined
  if (!store || (store.dir === undefined) === (store.memory === undefined))
    fail('options.store needs exactly one of { dir } or { memory: true }')
  if (store?.dir !== undefined && (typeof store.dir !== 'string' || !path.isAbsolute(store.dir)))
    fail('options.store.dir must be an absolute path (there is no working-directory default)')
  createGate(o.gate) // validates concurrency and queue
  if (o.crawlerEvents) assertInt('crawlerEvents.sample', o.crawlerEvents.sample, 1)
  for (const host of o.allowedImageHosts ?? [])
    if (typeof host !== 'string' || host === '' || /[/:@\s]/.test(host))
      fail(`allowedImageHosts entry "${String(host)}" must be a bare hostname`)
  for (const [k, v] of Object.entries(o.brand ?? {}))
    if (typeof v !== 'string' || !COLOUR.test(v)) fail(`brand.${k} must be a hex colour or a colour name`)
  if (o.requiredSample !== undefined && typeof o.requiredSample !== 'string') fail('requiredSample must be a string')
  return serverUrl as string
}

/**
 * The Payload plugin. Schema-neutral: it adds no fields, endpoints or jobs. It stores its state in
 * `config.custom`, hooks `afterChange` on the site globals, and checks fonts and the store when Payload starts.
 */
export function ogImagePlugin(o: OgImagePluginOptions): (config: Config) => Config {
  return (config) => {
    const serverUrl = validate(o, config)
    const state = createState(o, serverUrl)
    const globals = (config.globals ?? []).map((g) => {
      if (!(o.siteGlobals ?? []).includes(g.slug)) return g
      return { ...g, hooks: { ...g.hooks, afterChange: [...(g.hooks?.afterChange ?? []), () => state.invalidateSite()] } }
    })
    const previousOnInit = config.onInit
    return {
      ...config,
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

/** Faces load (WOFF2 fails here), every stack draws the required sample, and the store opens. Throws except in production, where it logs. */
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
  } catch (error) {
    problems.push(String((error as Error)?.message ?? error))
  }
  if (problems.length === 0) return
  const message = `payload-og-image start-up check failed: ${problems.join('; ')}`
  if (process.env.NODE_ENV === 'production') state.events.emit({ name: 'render_error', detail: { message } })
  else throw new Error(message)
}
