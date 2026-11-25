import type { PayloadRequest } from 'payload'
import { z } from 'zod'
import { chosen, MAX_LIMIT, type OgMcpToolsOptions, SHAPE } from './core.js'

/** A tool in the shape `@payloadcms/plugin-mcp` 3 takes under `mcp.tools`. */
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

/** The same argument shapes as zod values: plugin 3's MCP SDK takes zod. A static import, so a bundler and the file tracer see it. */
const REF: z.ZodRawShape = {
  target: z.string().optional().describe(SHAPE.ref.target.description),
  id: z.union([z.string(), z.number()]).optional().describe(SHAPE.ref.id.description),
  slug: z.string().optional().describe(SHAPE.ref.slug.description),
  static: z.string().optional().describe(SHAPE.ref.static.description),
  path: z.string().optional().describe(SHAPE.ref.path.description),
}
const AUDIT: z.ZodRawShape = {
  scope: z.string().optional().describe(SHAPE.audit.scope.description),
  page: z.number().int().min(1).optional().describe(SHAPE.audit.page.description),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(SHAPE.audit.limit.description),
  checkHeroes: z.boolean().optional().describe(SHAPE.audit.checkHeroes.description),
}

/**
 * Read-only tools for an existing `@payloadcms/plugin-mcp` 3: `mcp: { tools: [...ogImageMcpTools()] }`. Every read is published
 * only, with no editor and no draft mode, like the card route; nothing is drawn except by `og_preview`, which goes through the
 * route's own gate, memo and versioned store key. Enable each tool for an API key in the admin, as for any custom tool.
 * Imports `zod` (the plugin's own dependency, `^3.25.50`). For plugin 4 use `ogImageMcpToolMap` from `payload-og-image/mcp`.
 */
export function ogImageMcpTools(o: OgMcpToolsOptions = {}): OgMcpTool[] {
  return chosen(o).map((s) => ({
    name: s.name,
    description: s.description,
    parameters: s.properties === SHAPE.audit ? AUDIT : REF,
    // The plugin 3 types a result as text; the MCP SDK it hands the result to also takes the image part a preview returns.
    handler: (async (args: Record<string, unknown>, req: PayloadRequest) => s.run(args, req, o)) as unknown as OgMcpTool['handler'],
  }))
}
