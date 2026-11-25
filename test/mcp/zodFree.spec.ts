/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a Payload 4 site that needs zod, found in production.
 * - core.ts imports `zod` (or the v3 module) -> "building the Payload 4 map never touches zod" RED */
import { describe, expect, it, vi } from 'vitest'

// Any load of zod in this file throws: a module that reaches it, however deep, fails the test.
vi.mock('zod', () => {
  throw new Error('zod was loaded')
})

describe('the Payload 4 entry', () => {
  it('building the Payload 4 map never touches zod', async () => {
    const { ogImageMcpToolMap } = await import('../../src/exports/mcp.js')
    const map = ogImageMcpToolMap({ describedBy: 'meta.description' })
    expect(Object.keys(map)).toEqual(['og_card', 'og_audit', 'og_preview'])
    expect(map.og_audit?.input.properties).toHaveProperty('scope')
  })
  it('the Payload 3 entry is the one that needs it', async () => {
    await expect(import('../../src/exports/mcp-v3.js')).rejects.toThrow()
  })
})
