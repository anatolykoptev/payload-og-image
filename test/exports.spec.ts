/** Mutation table (production line -> the test that goes RED). Silent-failure surface: the Payload CLI loads `payload.config` outside Next; a `next/*`, sharp or renderer import in the main entry breaks it there.
 * - index.ts:4  import the runtime from the plugin (the main entry then reaches next/*, sharp, the renderer) -> "the main entry reaches no next/*, sharp, payload value import or renderer module" RED
 * - state.ts:2  import sharp from state.ts -> same test RED */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(import.meta.dirname, '../src')

/** Every module reachable through VALUE imports (type-only imports are erased) from an entry file, with its bare specifiers. */
function graph(entry: string) {
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
      const typeOnly = Boolean(m[2])
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
    const { files, bare } = graph('exports/index.ts')
    expect(bare.filter((b) => /^(next|sharp|payload|react)(\/|$)/.test(b))).toEqual([])
    expect(files.filter((f) => /^(render|next)\//.test(f) || f.endsWith('runtime.ts') || f.endsWith('handler.ts'))).toEqual([])
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
