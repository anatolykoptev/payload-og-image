import type { Config, Endpoint, PayloadRequest } from 'payload'
import { ShedError } from '../internal/gate.js'
import type { OgState } from '../internal/state.js'
import { OG_EVENT_NAMES } from '../internal/types.js'
import type { Target } from '../template.js'
import { populateUploads } from './payloadSource.js'

export const PREVIEW_PATH = '/payload-og-image/preview'
export const STATS_PATH = '/payload-og-image/stats'
/** A preview body larger than this (bytes of JSON text) is refused before any parsing work. */
const MAX_BODY_CHARS = 256 * 1024
const MAX_DEPTH = 24

const NO_STORE = { 'cache-control': 'no-store' }
const text = (status: number, message: string, extra: Record<string, string> = {}) =>
  new Response(message, { status, headers: { 'content-type': 'text/plain', ...NO_STORE, ...extra } })

/** At most this many unlisted characters travel in the header; `missingCount` carries the real number. */
const MAX_MISSING_LISTED = 50

/** Reads the body as text, refusing more than `max` bytes even when the length is not declared (a chunked body). */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return await req.text()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** JSON for a header: every non-ASCII character escaped, so an emoji in `missing` cannot make the header invalid. */
const asciiJson = (v: unknown) => JSON.stringify(v).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

/** A stored file carries more than an id and a url: size, dates or sizes. An ordinary `{ id, url, label }` row is not one. */
const hasUploadField = (o: Record<string, unknown>) => ['width', 'height', 'filesize', 'sizes', 'updatedAt'].some((k) => o[k] !== undefined)

class BadBody extends Error {}

/**
 * Copies the body's `doc`, and turns anything that looks like a populated upload (an object with a `filename`) back into its
 * id: an upload is always read afresh with the caller's own access, never taken from the request. Refuses deep nesting.
 */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new BadBody('too deeply nested')
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1))
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>
    // Upload-shaped (a stored file's own fields): never trusted, whatever it holds. It becomes its id only when that is a plain
    // id, else nothing; an upload is read afresh with the caller's access, never taken from the request.
    if (
      typeof o.filename === 'string' ||
      (typeof o.url === 'string' && (typeof o.mimeType === 'string' || (o.id !== undefined && hasUploadField(o))))
    )
      return typeof o.id === 'string' || (typeof o.id === 'number' && Number.isFinite(o.id)) ? o.id : undefined
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, scrub(v, depth + 1)]))
  }
  return value
}

const isKey = (v: unknown): v is string | number =>
  (typeof v === 'string' && v !== '' && v.length <= 256) || (typeof v === 'number' && Number.isFinite(v))

/**
 * `POST /api/payload-og-image/preview`: the card an editor would get for the document they are typing, as a PNG.
 *
 * Access is ported from plugin-seo's generate endpoint (which does not export it): a user is required and must be an editor
 * (a user of the admin collection or of `options.editors`); the collection must be one of the plugin's targets; with an `id`
 * the document must be readable by that user as a draft (`overrideAccess: false`); without one the collection's
 * `access.create` must pass. Only after all of that is the body's `doc` merged over the saved draft. Nothing is written to
 * the memo or the store, and every answer is `no-store`.
 */
export function previewEndpoint(state: OgState): Endpoint {
  const o = state.options
  return {
    path: PREVIEW_PATH,
    method: 'post',
    handler: async (req: PayloadRequest) => {
      try {
        const user = req.user as ({ collection?: string } & Record<string, unknown>) | null | undefined
        if (!user) return text(401, 'Unauthorized')
        const editors = new Set(o.editors ?? [req.payload.config?.admin?.user ?? 'users'])
        if (typeof user.collection !== 'string' || !editors.has(user.collection)) return text(403, 'Forbidden')

        let body: unknown
        try {
          if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_CHARS) return text(413, 'Too large')
          const raw = await readCapped(req as unknown as Request, MAX_BODY_CHARS)
          if (raw === null) return text(413, 'Too large')
          body = JSON.parse(raw)
        } catch {
          return text(400, 'Bad request')
        }
        const b = body as { collection?: unknown; id?: unknown; doc?: unknown } | null
        if (!b || typeof b !== 'object' || typeof b.collection !== 'string') return text(400, 'Bad request')
        if (b.id !== undefined && !isKey(b.id)) return text(400, 'Bad request')
        if (b.doc === null || typeof b.doc !== 'object' || Array.isArray(b.doc)) return text(400, 'Bad request')
        if (JSON.stringify(b.doc).length > MAX_BODY_CHARS) return text(413, 'Too large')

        // Only the collections the plugin draws cards for: the endpoint cannot be pointed at any other.
        const found = Object.entries(o.targets).find(([name, t]: [string, Target]) => (t.collection ?? name) === b.collection)
        if (!found) return text(404, 'Not found')
        const [targetName] = found
        const collection = b.collection

        let saved: Record<string, any> = {}
        if (b.id !== undefined) {
          const doc = await req.payload
            .findByID({
              collection: collection as never,
              id: b.id,
              depth: 0,
              draft: true,
              overrideAccess: false,
              user,
              disableErrors: true,
            } as never)
            .catch(() => null)
          if (!doc) return text(403, 'Forbidden')
          saved = doc as Record<string, any>
        } else {
          const known = req.payload.collections as unknown as Record<string, { config?: { access?: { create?: unknown } } } | undefined>
          const access = known[collection]?.config?.access?.create
          // An access function that throws is a refusal, not a server error.
          const allowed =
            typeof access === 'function' ? await (async () => (access as (a: unknown) => unknown)({ req }))().catch(() => false) : false
          if (allowed !== true) return text(403, 'Forbidden')
        }

        // Authorised: only now is the editor's text allowed anywhere near a card.
        let merged: Record<string, any>
        try {
          merged = { ...saved, ...(scrub(b.doc) as Record<string, any>) }
        } catch (e) {
          if (e instanceof BadBody) return text(400, 'Bad request')
          throw e
        }
        await populateUploads(req.payload, collection, merged, user)

        const { getRuntime } = await import('../internal/runtime.js')
        const rt = await getRuntime(req.payload.config)
        const result = await rt.preview({ target: targetName as string, doc: merged, request: req as unknown as Request })
        if (result.kind === 'none') return text(404, 'No card for this document')
        return new Response(new Uint8Array(result.bytes), {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': String(result.bytes.byteLength),
            'x-og-warnings': asciiJson({
              ...result.warnings,
              missing: result.warnings.missing.slice(0, MAX_MISSING_LISTED),
              missingCount: result.warnings.missing.length,
            }),
            'x-content-type-options': 'nosniff',
            ...NO_STORE,
          },
        })
      } catch (error) {
        if (error instanceof ShedError) return text(503, 'Busy', { 'retry-after': '5' })
        state.events.emit({ name: 'render_error', detail: { message: `preview failed: ${String((error as Error)?.message ?? error)}` } })
        return text(500, 'Preview failed')
      }
    },
  }
}

/**
 * `GET /api/payload-og-image/stats`: how the plugin is running, for an admin. Only a user of the admin user collection whose
 * collection's `access.admin` passes (an anonymous request included) gets it; everyone else 403. The answer is these four
 * parts and nothing more: the event counters (one number per event), the render gate, the memo, and the store's kind, whether
 * it is enabled and, for a disk store, its `dir`. No config value, key or file name.
 */
export function statsEndpoint(state: OgState): Endpoint {
  return {
    path: STATS_PATH,
    method: 'get',
    handler: async (req: PayloadRequest) => {
      try {
        const user = req.user as ({ collection?: string } & Record<string, unknown>) | null | undefined
        const adminCollection = req.payload.config?.admin?.user ?? 'users'
        if (!user || user.collection !== adminCollection) return text(403, 'Forbidden')
        const known = req.payload.collections as unknown as Record<string, { config?: { access?: { admin?: unknown } } } | undefined>
        const admin = known[adminCollection]?.config?.access?.admin
        const allowed =
          typeof admin === 'function' ? await (async () => (admin as (a: unknown) => unknown)({ req }))().catch(() => false) : false
        if (allowed !== true) return text(403, 'Forbidden')

        const seen = state.events.counters()
        const counters = Object.fromEntries(OG_EVENT_NAMES.map((n) => [n, seen[n] ?? 0]))
        const store = state.store() as { enabled?: boolean; dir?: string }
        const disk = 'dir' in state.options.store
        return new Response(
          JSON.stringify({
            counters,
            gate: state.gate.stats(),
            memo: { size: state.memo.size, bytes: state.memo.bytes },
            store: disk ? { kind: 'disk', enabled: store.enabled !== false, dir: store.dir } : { kind: 'memory', enabled: true },
          }),
          { status: 200, headers: { 'content-type': 'application/json', ...NO_STORE } },
        )
      } catch (error) {
        state.events.emit({ name: 'render_error', detail: { message: `stats failed: ${String((error as Error)?.message ?? error)}` } })
        return text(500, 'Stats failed')
      }
    },
  }
}

/** The config with the plugin's endpoints added (none when it is disabled): `/stats` always, the preview when a target collection carries the `og` group. */
export function withEndpoints(config: Config, state: OgState, hasGroup: boolean): Config {
  if (state.options.disabled) return config
  const ours = [statsEndpoint(state), ...(hasGroup ? [previewEndpoint(state)] : [])]
  return { ...config, endpoints: [...(config.endpoints ?? []), ...ours] }
}
