/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a stale card URL gives no error in prod.
 * - version.ts:35  drop `i.props` from the hashed array                  -> "changes with title" / "site datum" RED
 * - version.ts:35  drop `i.host`                                         -> "changes with host (domain move)" RED
 * - version.ts:35  drop `i.fontsDigest`                                  -> "changes with fonts (a face file swapped)" RED
 * - version.ts:35  hash other constants than '', 'og', 0                 -> "hashes the 0.2 slots as constants" RED
 * - version.ts:30  heroTag uses only updatedAt (no id)                   -> "a different upload with the same updatedAt" RED
 * - version.ts:19  canonicalJson stops sorting keys                      -> "independent of key order" RED
 * - version.ts:14  drop the toJSON branch                                -> "does not collapse Date props" RED
 * - version.ts:14  toJSON called with '' instead of the property key     -> "calls toJSON once, with the property key" RED
 * - version.ts:14  toJSON applied twice (a hook returning itself loops)  -> "calls toJSON once, with the property key" RED
 * - version.ts:16  array holes via map (skipped)                         -> "keeps array holes as null" RED
 * - version.ts:18  drop only `undefined` members (keep functions)        -> "calls toJSON once ... survives a toJSON that returns itself" RED
 * - version.ts:38  pageId drops the \u0000 separator                     -> "separates kind and slug unambiguously" RED */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJson, cardVersion, pageId } from '../../src/internal/version.js'

const base = {
  templateId: 'post',
  templateRevision: '7',
  props: { title: 'A', label: 'Blog', site: 'S' },
  heroes: [],
  fontsDigest: 'f1',
  host: 'example.com',
}

describe('cardVersion', () => {
  it('is 12 hex and independent of key order', () => {
    expect(cardVersion(base)).toMatch(/^[0-9a-f]{12}$/)
    expect(cardVersion({ ...base, props: { site: 'S', label: 'Blog', title: 'A' } })).toBe(cardVersion(base))
  })
  it.each([
    ['title', { ...base, props: { ...base.props, title: 'B' } }],
    ['a site datum the template draws (global edit)', { ...base, props: { ...base.props, site: 'S2' } }],
    ['template revision', { ...base, templateRevision: '8' }],
    ['template id', { ...base, templateId: 'page' }],
    ['host (domain move)', { ...base, host: 'new.example.com' }],
    ['fonts (a face file swapped)', { ...base, fontsDigest: 'f2' }],
    ['hero added', { ...base, heroes: [{ id: 5, updatedAt: 'u1' }] }],
  ])('changes with %s', (_, changed) => expect(cardVersion(changed)).not.toBe(cardVersion(base)))
  it('changes when a hero is replaced or deleted', () => {
    const withHero = { ...base, heroes: [{ id: 5, updatedAt: 'u1' }] }
    expect(cardVersion({ ...base, heroes: [{ id: 5, updatedAt: 'u2' }] })).not.toBe(cardVersion(withHero))
    expect(cardVersion(base)).not.toBe(cardVersion(withHero))
  })
  it('changes when a different upload with the same updatedAt replaces the hero', () => {
    const a = { ...base, heroes: [{ id: 5, updatedAt: 'u1' }] }
    expect(cardVersion({ ...base, heroes: [{ id: 6, updatedAt: 'u1' }] })).not.toBe(cardVersion(a))
  })
  it('does not collapse Date props', () => {
    const at = (d: string) => ({ ...base, props: { ...base.props, when: new Date(d) } })
    expect(cardVersion(at('2026-01-01T00:00:00Z'))).not.toBe(cardVersion(at('2026-06-01T00:00:00Z')))
  })
  it('hashes the 0.2 slots as constants, so wiring them later with defaults changes no URL', () => {
    // The exact array 0.2 will hash when locale/variant/nonce are wired with their defaults:
    const expected = createHash('sha256')
      .update(canonicalJson([1, 'post', '7', base.props, [], 'f1', 'example.com', '', 'og', 0]))
      .digest('hex')
      .slice(0, 12)
    expect(cardVersion(base)).toBe(expected)
  })
  it('golden value pins the format', () => expect(cardVersion(base)).toMatchInlineSnapshot(`"db1903285d83"`))
})

describe('canonicalJson / pageId', () => {
  it('sorts keys deeply and drops undefined', () =>
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[2,{"y":2,"z":1}]},"b":1}'))
  it('keeps array holes as null and never throws on them', () => {
    const holey = new Array(3)
    holey[0] = 1
    holey[2] = 3
    expect(canonicalJson(holey)).toBe('[1,null,3]')
    expect(JSON.parse(canonicalJson(holey))).toEqual([1, null, 3])
    expect(canonicalJson(new Array(1))).not.toBe(canonicalJson([]))
  })
  it('calls toJSON once, with the property key, and survives a toJSON that returns itself', () => {
    const keys: string[] = []
    const probe = {
      toJSON: (k: string) => {
        keys.push(k)
        return { seen: k }
      },
    }
    expect(canonicalJson({ a: probe, b: [probe] })).toBe('{"a":{"seen":"a"},"b":[{"seen":"0"}]}')
    expect(keys).toEqual(['a', '0'])
    const selfish = {
      x: 1,
      toJSON() {
        return this
      },
    }
    expect(canonicalJson(selfish)).toBe('{"x":1}')
  })
  it('separates kind and slug unambiguously', () => {
    expect(pageId({ kind: 'a', slug: 'b/c' })).not.toBe(pageId({ kind: 'a/b', slug: 'c' }))
    // Same concatenation, different split: only the separator tells these apart.
    expect(pageId({ kind: 'a', slug: 'bc' })).not.toBe(pageId({ kind: 'ab', slug: 'c' }))
  })
})
