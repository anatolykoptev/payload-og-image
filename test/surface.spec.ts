import { describe, expect, it } from 'vitest'
import * as main from '../src/exports/index.js'
import * as next from '../src/exports/next.js'
import * as testing from '../src/exports/testing.js'

// S§D1: the runtime surface, exactly.
describe('public surface (S§D1)', () => {
  it('exports exactly the agreed runtime names', () => {
    expect(Object.keys(main).sort()).toEqual(['defineTarget', 'defineTemplate', 'ogImagePlugin'])
    expect(Object.keys(next).sort()).toEqual(['createOgRoute', 'ogMetadata', 'withHead'])
    expect(Object.keys(testing).sort()).toEqual(['installTestRuntime', 'ogKit'])
  })
})
