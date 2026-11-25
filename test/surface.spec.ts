import { describe, expect, it } from 'vitest'
import * as main from '../src/exports/index.js'
import * as mcp from '../src/exports/mcp.js'
import * as mcpV3 from '../src/exports/mcp-v3.js'
import * as next from '../src/exports/next.js'
import * as testing from '../src/exports/testing.js'

// S§D1: the runtime surface, exactly.
describe('public surface (S§D1)', () => {
  it('exports exactly the agreed runtime names', () => {
    expect(Object.keys(main).sort()).toEqual(['defineTarget', 'defineTemplate', 'ogFields', 'ogImagePlugin'])
    expect(Object.keys(next).sort()).toEqual(['OG_SITE_TAG', 'createOgRoute', 'ogMetadata', 'ogTag', 'withHead'])
    expect(Object.keys(testing).sort()).toEqual(['installTestRuntime', 'ogKit'])
    expect(Object.keys(mcp).sort()).toEqual(['ogImageMcpToolMap'])
    expect(Object.keys(mcpV3).sort()).toEqual(['ogImageMcpTools'])
  })
})
