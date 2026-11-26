/** The design numbers of docs/share-image-spec.md are written from src/presets/spec.ts by `pnpm docs:spec`. A stale block would tell agents a zone the presets no longer keep, and nothing else would notice.
 * Mutation table (production line -> the test that goes RED):
 * - spec.ts ZONE.y0 changed without `pnpm docs:spec`   -> "every block of the document is what the spec renders now" RED
 * - a marker removed or duplicated in the document     -> "refuses a document whose marker is missing or doubled" RED
 * - share-image-spec.mjs:  fit test dropped (always yes) -> "a crop that reaches into the zone is marked" RED */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as spec from '../../src/presets/spec.js'

const { applyBlocks, cropOf, renderBlocks } = (await import(new URL('../../scripts/share-image-spec.mjs', import.meta.url).href)) as {
  applyBlocks(doc: string, rendered: Record<string, string>): string
  cropOf(s: Pick<typeof spec, 'CARD' | 'ZONE'>, ratio: [number, number]): { sides: number; ends: number; fits: boolean }
  renderBlocks(s: typeof spec): Record<string, string>
}

const doc = readFileSync(new URL('../../docs/share-image-spec.md', import.meta.url), 'utf8')

describe('docs/share-image-spec.md', () => {
  it('every block of the document is what the spec renders now', () => {
    const rendered = renderBlocks(spec)
    expect(Object.keys(rendered).length).toBeGreaterThan(0)
    // Missing markers throw inside applyBlocks; a stale block shows as a diff. Run `pnpm docs:spec` to fix either.
    expect(applyBlocks(doc, rendered)).toBe(doc)
  })

  it('states the card size the platform table is written for', () => {
    expect(spec.CARD).toEqual({ width: 1200, height: 630 })
    expect(doc).toContain('1200 x 630')
  })

  it('refuses a document whose marker is missing or doubled', () => {
    const rendered = renderBlocks(spec)
    expect(() => applyBlocks(doc.replace('<!-- spec:safe-zone -->', ''), rendered)).toThrow(/markers/)
    expect(() => applyBlocks(`${doc}\n<!-- /spec:design -->`, rendered)).toThrow(/markers/)
  })

  it('a crop that reaches into the zone is marked', () => {
    const s = { CARD: spec.CARD, ZONE: spec.ZONE }
    expect(cropOf(s, [1, 1]).fits).toBe(false)
    expect(cropOf(s, [2, 1])).toEqual({ sides: 0, ends: 15, fits: true })
    expect(cropOf(s, [510, 228]).ends).toBeGreaterThan(40)
  })
})
