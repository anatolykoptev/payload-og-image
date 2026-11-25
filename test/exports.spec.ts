/** Mutation table (production line -> the test that goes RED). Silent-failure surface: the Payload CLI loads `payload.config` outside Next; a `next/*`, sharp or renderer import in the main entry breaks it there.
 * - index.ts:4  import the runtime from the plugin (the main entry then reaches next/*, sharp, the renderer) -> "the main entry reaches no next/*, sharp, payload value import or renderer module" RED
 * - state.ts:2  import sharp from state.ts -> same test RED
 * - endpoints.ts  import the runtime statically (not inside the handler) -> "the one lazy edge ..." and the static test RED
 * - routeSource.ts:1  `import ts from 'typescript'` statically in the testing entry -> "no entry imports the TypeScript compiler" RED
 * - endpoints.ts  a second lazy import -> "the one lazy edge ..." RED */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(import.meta.dirname, '../src')

/** Every module reachable through VALUE imports (type-only imports are erased) from an entry file, with its bare specifiers. */
function graph(entry: string, o: { dynamic?: boolean } = { dynamic: true }) {
  const files = new Set<string>()
  const bare = new Set<string>()
  const walk = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(
      /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?)from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g,
    )) {
      const spec = m[4] ?? m[5]
      const typeOnly = Boolean(m[2]) || (m[5] !== undefined && o.dynamic === false)
      if (!spec || typeOnly) continue
      if (spec.startsWith('.')) {
        const base = path.resolve(path.dirname(file), spec.replace(/\.js$/, ''))
        walk(existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`)
      } else bare.add(spec)
    }
  }
  walk(path.join(SRC, entry))
  return { files: [...files].map((f) => path.relative(SRC, f)), bare: [...bare] }
}

describe('entry points load in the Payload CLI (outside Next)', () => {
  it('the main entry reaches no next/*, sharp, payload value import or renderer module', () => {
    // Static imports only: the preview endpoint loads the runtime on a request (see the next test), never at config load.
    const { files, bare } = graph('exports/index.ts', { dynamic: false })
    expect(bare.filter((b) => /^(next|sharp|payload|react)(\/|$)/.test(b))).toEqual([])
    expect(files.filter((f) => /^(render|next)\//.test(f) || f.endsWith('runtime.ts') || f.endsWith('handler.ts'))).toEqual([])
  })
  it('no entry imports the TypeScript compiler: the testing entry loads it on demand, the others never', () => {
    // `typescript` is an optional peer of payload-og-image/testing only; a static import would break every project without it.
    for (const entry of [
      'exports/index.ts',
      'exports/next.ts',
      'exports/client.ts',
      'exports/testing.ts',
      'exports/mcp.ts',
      'exports/mcp-v3.ts',
    ])
      expect(
        graph(entry).bare.filter((b) => /^(@typescript\/|typescript(\/|$))/.test(b)),
        entry,
      ).toEqual([])
    expect(graph('exports/testing.ts').files).toContain('testing/routeSource.ts')
  })
  it('the mcp entry is loaded by the Payload config: it reaches no next/*, sharp or renderer module until a tool runs', () => {
    const { files, bare } = graph('exports/mcp.ts', { dynamic: false })
    expect(bare.filter((b) => /^(next|sharp|react)(\/|$)/.test(b))).toEqual([])
    expect(files.filter((f) => /^(render|next)\//.test(f) || f.endsWith('runtime.ts') || f.endsWith('handler.ts'))).toEqual([])
    expect(graph('exports/mcp.ts').files).toContain('internal/runtime.ts') // reached lazily, inside a tool's handler
  })
  it('the Payload 4 mcp entry is zod-free by construction; the v3 entry imports zod statically (a bundler and the file tracer must see it)', () => {
    expect(graph('exports/mcp.ts').bare.filter((b) => /^zod(\/|$)/.test(b))).toEqual([])
    expect(graph('exports/mcp-v3.ts', { dynamic: false }).bare).toContain('zod')
    const src = readFileSync(path.join(SRC, 'mcp/v3.ts'), 'utf8')
    expect(src).toMatch(/^import \{ z \} from 'zod'$/m)
    expect(src).not.toMatch(/createRequire|require\(|import\(['"]zod/) // no dynamic load: the file tracer cannot follow it
  })
  it('the one lazy edge from the main entry to the runtime is the preview endpoint handler, inside the request function', () => {
    const lazy: string[] = []
    const all = graph('exports/index.ts')
    const fixed = graph('exports/index.ts', { dynamic: false })
    for (const f of all.files.filter((f) => !fixed.files.includes(f))) lazy.push(f)
    expect(lazy).toEqual(expect.arrayContaining(['internal/handler.ts', 'internal/runtime.ts']))
    expect(fixed.files).not.toContain('internal/runtime.ts')
    const src = readFileSync(path.join(SRC, 'plugin/endpoints.ts'), 'utf8')
    expect(src.match(/import\(['"][^'"]+['"]\)/g)).toEqual(["import('../internal/runtime.js')"])
    expect(src).not.toMatch(/^import[^\n]*runtime/m)
  })
  it('the /next entry is where the renderer, the handler and the runtime live', () => {
    const { files } = graph('exports/next.ts')
    expect(files).toEqual(expect.arrayContaining(['internal/runtime.ts', 'internal/handler.ts', 'render/nextOg.ts', 'render/hero.ts']))
  })
  it('the graph walker sees a value import and ignores a type-only one (it can be trusted)', () => {
    const { bare } = graph('plugin/payloadSource.ts')
    expect(bare).not.toContain('payload') // `import type { Payload } from 'payload'`
    const next = graph('internal/runtime.ts')
    expect(next.bare).toContain('payload') // `import { getPayload } from 'payload'`
  })
})
