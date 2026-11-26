/** Mutation table (production line -> the test that goes RED). The `payload-beta` CI matrix installs what this picks; a wrong pick would test nothing and say nothing.
 * - latest-payload-beta.mjs:20  drop the cooldown test -> "skips a beta younger than the release-age cooldown" RED
 * - latest-payload-beta.mjs:20  check only the first package's time -> "needs every package past the cooldown, not only payload" RED
 * - latest-payload-beta.mjs:22  match `beta` unanchored (not the whole version) -> "takes only real betas" RED
 * - latest-payload-beta.mjs:23  sort as text -> "orders by number, not by text" RED
 * - latest-payload-beta.mjs:28  take the first `||` part -> "reads the beta floor from the peer range" RED
 * - latest-payload-beta.mjs:43  guard with `file://${argv[1]}` -> "runs from a path a file URL encodes" RED */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const { pickBeta, floorBeta, payloadPackages } = (await import(new URL('../../scripts/latest-payload-beta.mjs', import.meta.url).href)) as {
  pickBeta(times: Record<string, string>[], now?: number, minAgeMinutes?: number): string | undefined
  floorBeta(peerRange: string): string | undefined
  payloadPackages(devDependencies: Record<string, string>): string[]
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
    expect(pickBeta([time], now)).toBe('4.0.0-beta.2')
  })
  it('skips a beta younger than the release-age cooldown', () => {
    expect(pickBeta([{ '4.0.0-beta.11': day(4), '4.0.0-beta.12': new Date(now - 7 * 3_600_000).toISOString() }], now)).toBe('4.0.0-beta.11')
  })
  it('needs every package past the cooldown, not only payload', () => {
    const payload = { '4.0.0-beta.11': day(4), '4.0.0-beta.12': day(3) }
    const sibling = { '4.0.0-beta.11': day(4), '4.0.0-beta.12': new Date(now - 7 * 3_600_000).toISOString() }
    expect(pickBeta([payload, sibling], now)).toBe('4.0.0-beta.11')
  })
  it('skips a version a sibling never published', () => {
    expect(pickBeta([{ '4.0.0-beta.11': day(4), '4.0.0-beta.12': day(3) }, { '4.0.0-beta.11': day(4) }], now)).toBe('4.0.0-beta.11')
  })
  it('orders by number, not by text', () => {
    expect(pickBeta([{ '4.0.0-beta.9': day(9), '4.0.0-beta.10': day(8), '4.0.0-beta.2': day(20) }], now)).toBe('4.0.0-beta.10')
    expect(pickBeta([{ '4.1.0-beta.1': day(9), '4.0.0-beta.12': day(8) }], now)).toBe('4.1.0-beta.1')
  })
  it('is undefined when no beta is old enough', () => {
    expect(pickBeta([{ '4.0.0-beta.1': day(0) }], now)).toBeUndefined()
    expect(pickBeta([{}], now)).toBeUndefined()
    expect(pickBeta([], now)).toBeUndefined()
  })
})

describe('floorBeta', () => {
  it('reads the beta floor from the peer range', () => {
    expect(floorBeta('^3.93.0 || ^4.0.0-beta.12')).toBe('4.0.0-beta.12')
    expect(floorBeta('^4.0.0-beta.9')).toBe('4.0.0-beta.9')
  })
  it('is undefined when the range names no beta', () => {
    expect(floorBeta('^3.93.0 || ^4.0.0')).toBeUndefined()
  })
})

describe('payloadPackages', () => {
  it('is payload plus every @payloadcms/* devDependency', () => {
    expect(payloadPackages({ vitest: '1', '@payloadcms/ui': '3', '@payloadcms/next': '3', '@types/node': '1' })).toEqual([
      'payload',
      '@payloadcms/ui',
      '@payloadcms/next',
    ])
  })
})

describe('CLI entry guard', () => {
  it('runs from a path a file URL encodes (a space)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'og beta '))
    mkdirSync(join(dir, 'scripts'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { '@payloadcms/ui': '1' } }))
    const copy = join(dir, 'scripts', 'latest-payload-beta.mjs')
    copyFileSync(new URL('../../scripts/latest-payload-beta.mjs', import.meta.url), copy)
    expect(execFileSync(process.execPath, [copy, 'specs', '4.0.0-beta.12'], { encoding: 'utf8' })).toMatch(
      /^payload@4\.0\.0-beta\.12 @payloadcms\/ui@4\.0\.0-beta\.12/,
    )
  })
})
