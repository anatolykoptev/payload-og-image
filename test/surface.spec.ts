import { describe, expect, it } from 'vitest'
// @ts-expect-error: a plain .mjs module without types, shared with scripts/verify-pack.mjs
import { PUBLIC_SURFACE } from '../scripts/public-surface.mjs'
import * as main from '../src/exports/index.js'
import * as mcp from '../src/exports/mcp.js'
import * as mcpV3 from '../src/exports/mcp-v3.js'
import * as next from '../src/exports/next.js'
import * as testing from '../src/exports/testing.js'

// S§D1: the runtime surface, exactly.
describe('public surface (S§D1)', () => {
  it('exports exactly the agreed runtime names', () => {
    const entries = {
      'payload-og-image': main,
      'payload-og-image/next': next,
      'payload-og-image/testing': testing,
      'payload-og-image/mcp': mcp,
      'payload-og-image/mcp/v3': mcpV3,
    }
    expect(Object.keys(entries).sort()).toEqual(Object.keys(PUBLIC_SURFACE).sort())
    for (const [entry, mod] of Object.entries(entries))
      expect([entry, Object.keys(mod).sort()]).toEqual([entry, [...PUBLIC_SURFACE[entry]].sort()])
  })
})
