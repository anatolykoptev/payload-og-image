import type { PayloadRequest } from 'payload'
import { isShedError } from '../internal/gate.js'
import type { AuditPage, CardRef } from '../internal/inspect.js'
import { isToolInputError } from '../internal/inspect.js'

export type OgMcpText = { type: 'text'; text: string }
export type OgMcpImage = { type: 'image'; data: string; mimeType: string }
/** What a tool answers, before it is shaped for a plugin major: text parts, and for a preview an image part. */
export type OgMcpAnswer = { content: Array<OgMcpText | OgMcpImage>; isError?: boolean }

/** A JSON Schema 2020-12 object: the input a Payload 4 tool takes without any schema library. */
export type OgMcpJsonSchema = { type: 'object'; properties: Record<string, object>; additionalProperties: boolean }

/** A tool in the shape `@payloadcms/plugin-mcp` 4 takes under its top-level `tools` map (what `defineTool(...).handler(...)` returns). */
export type OgMcpToolV4 = {
  description: string
  input: OgMcpJsonSchema
  /** Runs while the request is authorized, before the tool is advertised or called. Default: a signed-in MCP user (the plugin's own default). */
  access: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
  handler: (args: { input: Record<string, unknown>; req: PayloadRequest }) => Promise<OgMcpAnswer>
}

export type OgMcpToolsOptions = {
  /** Which tools to offer (default all three). */
  tools?: Array<'card' | 'audit' | 'preview'>
  /** Field path of the SEO description `og_audit` checks on every document (`meta.description`); no check when unset. */
  describedBy?: string
  /**
   * Maps a public page path (`/blog/hello`) to the card it advertises. The plugin knows its own card paths only; where a
   * site's pages live is the site's. Return null for a path that is not a page.
   */
  locate?: (pathname: string) => CardRef | null | undefined
  /** Largest card `og_preview` returns as an image (default 1.5 MiB); a bigger one is described, not sent. */
  maxPreviewBytes?: number
  /** Payload 4 only: who may use the tools (default: any signed-in MCP user, as the plugin's own default). The v3 plugin gates by API-key checkbox instead. */
  access?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
}

const DEFAULT_PREVIEW_BYTES = 1_500_000
export const MAX_LIMIT = 100
const DEFAULT_LIMIT = 25

export const SHAPE = {
  ref: {
    target: { type: 'string', description: 'The target (collection card kind) of the document.' },
    id: { type: ['string', 'number'], description: 'The document id, with `target`.' },
    slug: { type: 'string', description: "The document's slug (the target's slug field), with `target`." },
    static: { type: 'string', description: 'A static card by its key, `<kind>/<slug>`.' },
    path: {
      type: 'string',
      description: 'A card route path or URL (`/og/posts/a/card.png`), or a public page path when the site maps pages.',
    },
  },
  audit: {
    scope: { type: 'string', description: 'A target name, or `static`. Omit to list the scopes.' },
    page: { type: 'integer', minimum: 1, description: 'Page, from 1.' },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_LIMIT,
      description: `Rows per page (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}).`,
    },
    checkHeroes: { type: 'boolean', description: 'Read each hero file to find unreadable ones (slower).' },
  },
} satisfies Record<string, Record<string, object>>

const schema = (properties: Record<string, object>): OgMcpJsonSchema => ({ type: 'object', properties, additionalProperties: false })

const text = (value: unknown, isError = false): OgMcpAnswer => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  ...(isError ? { isError: true } : {}),
})

/**
 * What a tool tells its caller about a failure: its own input errors as they are, a full queue as a retry, and anything else as a
 * fixed sentence. The detail (a path, a query) goes to the server's log, never to the holder of a key.
 */
function failure(e: unknown, req: PayloadRequest, tool: string): OgMcpAnswer {
  if (isToolInputError(e)) return text({ error: e.message }, true)
  if (isShedError(e)) return text({ error: 'busy: too many tool calls at once, retry in a few seconds' }, true)
  try {
    req.payload?.logger?.error({ err: e, msg: `payload-og-image: ${tool} failed` })
  } catch {
    // a logger that throws must not hide the answer
  }
  return text({ error: 'internal_error: the call failed on the server; see its log' }, true)
}

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

function refOf(args: Record<string, unknown>, o: OgMcpToolsOptions, locate: (p: string) => CardRef | null): CardRef | string {
  if (str(args.static)) return { static: args.static as string }
  const path = str(args.path)
  if (path) {
    let pathname: string
    try {
      pathname = new URL(path, 'https://x.invalid').pathname
    } catch {
      return `"${path}" is not a path or a URL`
    }
    const found = locate(pathname) ?? o.locate?.(pathname) ?? null
    return (
      found ??
      `no card route or page is known for "${pathname}"${o.locate ? '' : ' (give `target` and `slug`, or map pages with the `locate` option)'}`
    )
  }
  if (str(args.target)) {
    const id = args.id
    if (typeof id === 'string' || typeof id === 'number') return { target: args.target as string, id }
    if (str(args.slug)) return { target: args.target as string, slug: args.slug as string }
  }
  return 'give `static`, `path`, or `target` with `id` or `slug`'
}

async function inspectorOf(req: PayloadRequest) {
  // On a request, never at config load: the Payload CLI loads the config (and this entry) outside Next, where the renderer must not be imported.
  const { getRuntime } = await import('../internal/runtime.js')
  return (await getRuntime(req.payload.config)).inspect
}

export type Spec = {
  name: string
  kind: 'card' | 'audit' | 'preview'
  description: string
  properties: Record<string, object>
  run: (args: Record<string, unknown>, req: PayloadRequest, o: OgMcpToolsOptions) => Promise<OgMcpAnswer>
}

const SPECS: Spec[] = [
  {
    name: 'og_card',
    kind: 'card',
    description:
      'What card a page advertises: its URL with the version, which target or static card, whether it is stored (a store lookup, nothing is drawn) and its size, the hero (whether it is transparent, the ground it is flattened onto, whether its file can be read) and why there is no card or why it is not stored. Published documents only.',
    properties: SHAPE.ref,
    async run(args, req, o) {
      try {
        const i = await inspectorOf(req)
        const r = refOf(args, o, (p) => i.locate(p))
        if (typeof r === 'string') return text({ found: false, reason: r }, true)
        return text(await i.card(r))
      } catch (e) {
        return failure(e, req, 'og_card')
      }
    },
  },
  {
    name: 'og_audit',
    kind: 'audit',
    description:
      "Cards across the site, no renders: with no `scope`, the scopes (each target and `static`) and how many documents each has; with a `scope`, one page of rows (published documents only) with the card URL, whether it is stored and its size, and, when the server is set up for it, whether the document has a meta description. `checkHeroes` also reads each hero file to report cards that would be drawn without it. Each row also has a `discover` object: the page's photo set for structured data and Google Discover (ratios and sizes, or why there is none) and whether its 16:9 image is at least 1200 px wide; `max-image-preview` is a tag of the page, which this tool cannot check.",
    properties: SHAPE.audit,
    async run(args, req, o) {
      try {
        const i = await inspectorOf(req)
        const scope = str(args.scope)
        if (!scope) return text({ scopes: await i.scopes(), next: 'call again with a scope' })
        const page: AuditPage = await i.audit({
          scope,
          page: Math.max(1, Math.trunc(Number(args.page ?? 1)) || 1),
          limit: Math.min(MAX_LIMIT, Math.max(1, Math.trunc(Number(args.limit ?? DEFAULT_LIMIT)) || DEFAULT_LIMIT)),
          describedBy: o.describedBy,
          checkHeroes: args.checkHeroes === true,
        })
        return text(page)
      } catch (e) {
        return failure(e, req, 'og_audit')
      }
    },
  },
  {
    name: 'og_preview',
    kind: 'preview',
    description:
      "The card image (PNG, JPEG or WebP, as the card is configured) for a published page. A stored card is read from the store; otherwise it is drawn through the render queue (it may be refused when the queue is full) and stored under its versioned key, exactly as a crawler's request would. Drafts are never shown.",
    properties: SHAPE.ref,
    async run(args, req, o) {
      try {
        const i = await inspectorOf(req)
        const r = refOf(args, o, (p) => i.locate(p))
        if (typeof r === 'string') return text({ ok: false, reason: r }, true)
        const s = await i.serve(r)
        if (s.status !== 'png') return text(s, s.status !== 'shed')
        const info = { status: 'png', type: s.type, url: s.url, v: s.v, source: s.source, bytes: s.bytes.byteLength, wasStored: s.stored }
        if (s.bytes.byteLength > (o.maxPreviewBytes ?? DEFAULT_PREVIEW_BYTES))
          return text({ ...info, image: `not sent: over ${o.maxPreviewBytes ?? DEFAULT_PREVIEW_BYTES} bytes` })
        return {
          content: [
            { type: 'image', data: Buffer.from(s.bytes).toString('base64'), mimeType: s.type },
            { type: 'text', text: JSON.stringify(info) },
          ],
        }
      } catch (e) {
        return failure(e, req, 'og_preview')
      }
    },
  },
]

export const chosen = (o: OgMcpToolsOptions) => {
  const want = new Set(o.tools ?? ['card', 'audit', 'preview'])
  return SPECS.filter((s) => want.has(s.kind))
}

/**
 * The same tools for `@payloadcms/plugin-mcp` 4: `tools: { ...ogImageMcpToolMap() }` on the plugin config. Inputs are JSON Schema, so
 * no schema library is needed. `access` (default: a signed-in MCP user) decides who sees them, as the plugin's own default does.
 */
export function ogImageMcpToolMap(o: OgMcpToolsOptions = {}): Record<string, OgMcpToolV4> {
  const access = o.access ?? (({ req }: { req: PayloadRequest }) => Boolean(req.user))
  return Object.fromEntries(
    chosen(o).map((s) => [
      s.name,
      {
        description: s.description,
        input: schema(s.properties),
        access,
        handler: ({ input, req }) => s.run(input ?? {}, req, o),
      } satisfies OgMcpToolV4,
    ]),
  )
}
