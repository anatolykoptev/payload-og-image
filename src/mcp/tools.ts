import type { PayloadRequest } from 'payload'
import { z } from 'zod'
import { ShedError } from '../internal/gate.js'
import type { AuditPage, CardRef } from '../internal/inspect.js'
import { ToolInputError } from '../internal/inspect.js'

/** A tool in the shape `@payloadcms/plugin-mcp` takes under `mcp.tools`. */
export type OgMcpTool = {
  name: string
  description: string
  parameters: z.ZodRawShape
  handler: (
    args: Record<string, unknown>,
    req: PayloadRequest,
    extra: unknown,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }>; role?: string }>
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
}

const DEFAULT_PREVIEW_BYTES = 1_500_000
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 25

const ref = {
  target: z.string().optional().describe('The target (collection card kind) of the document.'),
  id: z.union([z.string(), z.number()]).optional().describe('The document id, with `target`.'),
  slug: z.string().optional().describe("The document's slug (the target's slug field), with `target`."),
  static: z.string().optional().describe('A static card by its key, `<kind>/<slug>`.'),
  path: z
    .string()
    .optional()
    .describe('A card route path or URL (`/og/posts/a/card.png`), or a public page path when the site maps pages.'),
}

type Out = { content: Array<{ type: 'text'; text: string }>; role?: string }
const text = (value: unknown, isError = false): Out =>
  ({ content: [{ type: 'text', text: JSON.stringify(value, null, 1) }], ...(isError ? { isError: true } : {}) }) as Out

/**
 * What a tool tells its caller about a failure: its own input errors as they are, a full queue as a retry, and anything else as a
 * fixed sentence. The detail (a path, a query) goes to the server's log, never to the holder of a key.
 */
function failure(e: unknown, req: PayloadRequest, tool: string): Out {
  if (e instanceof ToolInputError) return text({ error: e.message }, true)
  if (e instanceof ShedError) return text({ error: 'busy: too many tool calls at once, retry in a few seconds' }, true)
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

/**
 * Read-only tools for an existing `@payloadcms/plugin-mcp`: `mcp: { tools: [...ogImageMcpTools()] }`. Every read is published only,
 * with no editor and no draft mode, like the card route; nothing is drawn except by `og_preview`, which goes through the route's
 * own gate, memo and versioned store key. Enable each tool for an API key in the admin, as for any custom tool.
 */
export function ogImageMcpTools(o: OgMcpToolsOptions = {}): OgMcpTool[] {
  const want = new Set(o.tools ?? ['card', 'audit', 'preview'])
  const maxPreview = o.maxPreviewBytes ?? DEFAULT_PREVIEW_BYTES
  const tools: OgMcpTool[] = []

  if (want.has('card'))
    tools.push({
      name: 'og_card',
      description:
        'What card a page advertises: its URL with the version, which target or static card, whether it is stored (a store lookup, nothing is drawn) and its size, the hero (whether it is transparent, the ground it is flattened onto, whether its file can be read) and why there is no card or why it is not stored. Published documents only.',
      parameters: ref,
      handler: async (args, req) => {
        try {
          const i = await inspectorOf(req)
          const r = refOf(args, o, (p) => i.locate(p))
          if (typeof r === 'string') return text({ found: false, reason: r }, true)
          return text(await i.card(r))
        } catch (e) {
          return failure(e, req, 'og_card')
        }
      },
    })

  if (want.has('audit'))
    tools.push({
      name: 'og_audit',
      description:
        'Cards across the site, no renders: with no `scope`, the scopes (each target and `static`) and how many documents each has; with a `scope`, one page of rows (published documents only) with the card URL, whether it is stored and its size, and, when the server is set up for it, whether the document has a meta description. `checkHeroes` also reads each hero file to report cards that would be drawn without it.',
      parameters: {
        scope: z.string().optional().describe('A target name, or `static`. Omit to list the scopes.'),
        page: z.number().int().min(1).optional().describe('Page, from 1.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(`Rows per page (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}).`),
        checkHeroes: z.boolean().optional().describe('Read each hero file to find unreadable ones (slower).'),
      },
      handler: async (args, req) => {
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
    })

  if (want.has('preview'))
    tools.push({
      name: 'og_preview',
      description:
        "The card PNG for a published page, as an image. A stored card is read from the store; otherwise it is drawn through the render queue (it may be refused when the queue is full) and stored under its versioned key, exactly as a crawler's request would. Drafts are never shown.",
      parameters: ref,
      handler: async (args, req) => {
        try {
          const i = await inspectorOf(req)
          const r = refOf(args, o, (p) => i.locate(p))
          if (typeof r === 'string') return text({ ok: false, reason: r }, true)
          const s = await i.serve(r)
          if (s.status !== 'png') return text(s, s.status !== 'shed')
          const info = { status: 'png', url: s.url, v: s.v, source: s.source, bytes: s.bytes.byteLength, wasStored: s.stored }
          if (s.bytes.byteLength > maxPreview) return text({ ...info, image: `not sent: over ${maxPreview} bytes` })
          // The plugin types a tool result as text; the MCP SDK it hands the result to also takes an image part.
          return {
            content: [
              { type: 'image', data: Buffer.from(s.bytes).toString('base64'), mimeType: 'image/png' },
              { type: 'text', text: JSON.stringify(info) },
            ],
          } as unknown as Out
        } catch (e) {
          return failure(e, req, 'og_preview')
        }
      },
    })

  return tools
}
