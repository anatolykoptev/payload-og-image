/** Mutation table (production line -> the test that goes RED). The `payload-beta` CI job installs what this picks; a wrong pick would test nothing and say nothing.
 * - latest-payload-beta.mjs:12  drop the cooldown filter -> "skips a beta younger than the release-age cooldown" RED
 * - latest-payload-beta.mjs:7  match `beta` unanchored (not the whole version) -> "takes only real betas" RED
 * - latest-payload-beta.mjs:14  sort as text -> "orders by number, not by text" RED */
import { describe, expect, it } from 'vitest'

const { pickBeta } = (await import(new URL('../../scripts/latest-payload-beta.mjs', import.meta.url).href)) as {
  pickBeta(time: Record<string, string>, now?: number, minAgeMinutes?: number): string | undefined
}

const now = Date.parse('2026-11-25T00:00:00Z')
const day = (n: number) => new Date(now - n * 86_400_000).toISOString()

describe('pickBeta', () => {
  it('takes only real betas: not internal, canary or release versions', () => {
    const time = {
      created: day(900),
      '3.94.2': day(2),
      '4.0.0-canary.20261120': day(3),
      '4.0.0-internal.d90eddd': day(3),
      '4.0.0-beta.3-internal.1': day(3),
      '4.0.0-beta.2': day(10),
    }
    expect(pickBeta(time, now)).toBe('4.0.0-beta.2')
  })
  it('skips a beta younger than the release-age cooldown', () => {
    expect(pickBeta({ '4.0.0-beta.11': day(4), '4.0.0-beta.12': new Date(now - 7 * 3_600_000).toISOString() }, now)).toBe('4.0.0-beta.11')
  })
  it('orders by number, not by text', () => {
    expect(pickBeta({ '4.0.0-beta.9': day(9), '4.0.0-beta.10': day(8), '4.0.0-beta.2': day(20) }, now)).toBe('4.0.0-beta.10')
    expect(pickBeta({ '4.1.0-beta.1': day(9), '4.0.0-beta.12': day(8) }, now)).toBe('4.1.0-beta.1')
  })
  it('is undefined when no beta is old enough', () => {
    expect(pickBeta({ '4.0.0-beta.1': day(0) }, now)).toBeUndefined()
    expect(pickBeta({}, now)).toBeUndefined()
  })
})
