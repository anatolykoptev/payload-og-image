/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a stale card URL gives no error in prod.
 * - version.ts `cardPalette` or `heroPalette` dropped from the hash -> "a card palette or a hero palette moves the version only when set" RED
 * - version.ts `imageTail` appended for an empty or absent `images`, or left out when set -> "named images move the version only when present" RED
 * - version.ts `imageTail` hashing only the first upload's collection of a name -> "named images move the version ..." RED (two uploads that differ only in a later one's collection)
 * - version.ts:75  drop `i.props` from the hashed array                  -> "changes with title" / "site datum" RED
 * - version.ts:75  drop `i.host`                                         -> "changes with host (domain move)" RED
 * - version.ts:75  drop `i.fontsDigest`                                  -> "changes with fonts (a face file swapped)" RED
 * - version.ts:75  hash other constants than '', 'og', 0                 -> "hashes the 0.2 slots as constants" RED
 * - version.ts:93  nonce slot `(i.nonce ?? 0) + 1` (default no longer the 0.1 value) -> "golden value pins the format", "hashes the 0.2 slots ...", "nonce 0 or absent hashes exactly as 0.1" RED
 * - version.ts:93 `heroTransparent` dropped from the hash -> "a transparent hero without a ground moves the version; nothing else does" RED
 * - version.ts `i.variant ?? 'og'` -> `'og'` (the variant slot ignored) -> "the variant slot: a JPEG or WebP card is a new version, PNG hashes as ever" RED
 * - version.ts:70  heroTag uses only updatedAt (no id)                   -> "a different upload with the same updatedAt" RED
 * - version.ts:19  canonicalJson stops sorting keys                      -> "independent of key order" RED
 * - version.ts:14  drop the toJSON branch                                -> "does not collapse Date props" RED
 * - version.ts:14  toJSON called with '' instead of the property key     -> "calls toJSON once, with the property key" RED
 * - version.ts:14  toJSON applied twice (a hook returning itself loops)  -> "calls toJSON once, with the property key" RED
 * - version.ts:16  array holes via map (skipped)                         -> "keeps array holes as null" RED
 * - version.ts:18  drop only `undefined` members (keep functions)        -> "calls toJSON once ... survives a toJSON that returns itself" RED
 * - version.ts:78  pageId drops the \u0000 separator                     -> "separates kind and slug unambiguously" RED
 * - version.ts:56  accept non-plain objects (Map/Set/class) -> "normalizeProps > rejects a Map/Set/class instance, naming the path" and "two different Maps would have hashed alike" RED
 * - version.ts:43  accept NaN/Infinity -> "rejects NaN" / "rejects Infinity nested in an array" RED
 * - version.ts:46  Date not converted -> "passes plain JSON through ... Date into its ISO string" RED
 * - version.ts:51  no cycle check -> "rejects a cycle" RED
 * - version.ts:50  accept function/bigint -> "rejects a function" / "rejects a bigint" RED
 * - version.ts:66  assign instead of defineProperty (an own __proto__ key swaps the prototype) -> "an own \"__proto__\" key stays data" RED
 * - version.ts:64  path not extended per member -> every "naming the path" test RED */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { variantOf } from '../../src/internal/format.js'
import { canonicalJson, cardVersion, normalizeProps, pageId } from '../../src/internal/version.js'
import { verifiedUpload } from '../helpers.js'

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
    ['hero added', { ...base, heroes: [verifiedUpload({ id: 5, updatedAt: 'u1' })] }],
  ])('changes with %s', (_, changed) => expect(cardVersion(changed)).not.toBe(cardVersion(base)))
  it('changes when a hero is replaced or deleted', () => {
    const withHero = { ...base, heroes: [verifiedUpload({ id: 5, updatedAt: 'u1' })] }
    expect(cardVersion({ ...base, heroes: [verifiedUpload({ id: 5, updatedAt: 'u2' })] })).not.toBe(cardVersion(withHero))
    expect(cardVersion(base)).not.toBe(cardVersion(withHero))
  })
  it('changes when a different upload with the same updatedAt replaces the hero', () => {
    const a = { ...base, heroes: [verifiedUpload({ id: 5, updatedAt: 'u1' })] }
    expect(cardVersion({ ...base, heroes: [verifiedUpload({ id: 6, updatedAt: 'u1' })] })).not.toBe(cardVersion(a))
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
  it('nonce 0 or absent hashes exactly as 0.1; any other nonce is a new version', () => {
    expect(cardVersion({ ...base, nonce: 0 })).toBe(cardVersion(base))
    expect(cardVersion({ ...base, nonce: 0 })).toMatchInlineSnapshot(`"db1903285d83"`) // the 0.1 golden value, unchanged
    expect(cardVersion({ ...base, nonce: 1 })).not.toBe(cardVersion(base))
    expect(cardVersion({ ...base, nonce: 1 })).not.toBe(cardVersion({ ...base, nonce: 2 }))
  })
  it('named images move the version only when present: absent or empty hashes exactly as before, the order of names does not matter, the upload tag and its collection do', () => {
    const img = (id: number, updatedAt = 'u1') => ({ id, updatedAt })
    const im = (name: string, uploads: Array<{ id: number; updatedAt: string }>, collection = 'media') => ({
      name,
      uploads: uploads.map((u) => verifiedUpload(u, collection)),
    })
    expect(cardVersion({ ...base, images: [] })).toBe(cardVersion(base))
    expect(cardVersion({ ...base, images: [im('stack', [])] })).toBe(cardVersion(base))
    const one = cardVersion({ ...base, images: [im('stack', [img(1)])] })
    expect(one).not.toBe(cardVersion(base))
    expect(cardVersion({ ...base, images: [im('stack', [img(1, 'u2')])] })).not.toBe(one)
    expect(cardVersion({ ...base, images: [im('logo', [img(1)])] })).not.toBe(one)
    const ab = cardVersion({
      ...base,
      images: [im('a', [img(1)]), im('b', [img(2)])],
    })
    expect(
      cardVersion({
        ...base,
        images: [im('b', [img(2)]), im('a', [img(1)])],
      }),
    ).toBe(ab)
    // ids are unique within a collection only: the same id and updatedAt in another collection is another image
    expect(cardVersion({ ...base, images: [im('stack', [img(1)], 'logos')] })).not.toBe(one)
    // one name can mix collections: two images that differ only in a later upload's collection are two cards
    const mixed = (second: string) => ({
      name: 'stack',
      uploads: [verifiedUpload(img(1), 'media'), verifiedUpload(img(2), second)],
    })
    expect(cardVersion({ ...base, images: [mixed('logos')] })).not.toBe(cardVersion({ ...base, images: [mixed('media')] }))
    // The hero palette cuts them; the plugin's heroBackground does not touch them.
    expect(cardVersion({ ...base, images: [im('stack', [img(1)])], heroPalette: '64' })).not.toBe(one)
    expect(cardVersion({ ...base, images: [im('stack', [img(1)])], heroBackground: '#336699' })).toBe(one)
  })
  it('a card palette or a hero palette moves the version only when set; unset hashes exactly as before the option', () => {
    const hero = verifiedUpload({ id: 9, updatedAt: 'u1' })
    // Pinned from 0.3.0 (before the option existed).
    expect(cardVersion({ ...base, heroes: [hero] })).toBe('d8e5879ff956')
    expect(cardVersion({ ...base, heroes: [hero], heroBackground: '#f1f3ef' })).toBe('90a77b446d60')
    expect(cardVersion({ ...base, cardPalette: undefined, heroPalette: undefined })).toBe(cardVersion(base))
    expect(cardVersion({ ...base, cardPalette: 'false' })).not.toBe(cardVersion(base))
    expect(cardVersion({ ...base, cardPalette: '16' })).not.toBe(cardVersion({ ...base, cardPalette: 'false' }))
    // The hero palette belongs to the hero: a card without one does not move.
    expect(cardVersion({ ...base, heroPalette: 'false' })).toBe(cardVersion(base))
    expect(cardVersion({ ...base, heroes: [hero], heroPalette: 'false' })).not.toBe(cardVersion({ ...base, heroes: [hero] }))
  })
  it('a transparent hero without a ground moves the version; nothing else does', () => {
    const hero = verifiedUpload({ id: 9, updatedAt: 'u1' })
    // 0.4.0 values stay: an opaque hero, a card without a hero, and a flattened hero hash exactly as before.
    expect(cardVersion({ ...base, heroes: [hero], heroTransparent: false })).toBe('d8e5879ff956')
    expect(cardVersion({ ...base, heroes: [hero], heroTransparent: undefined })).toBe('d8e5879ff956')
    expect(cardVersion({ ...base, heroTransparent: true })).toBe(cardVersion(base)) // no hero: nothing to revise
    expect(cardVersion({ ...base, heroes: [hero], heroTransparent: true })).not.toBe('d8e5879ff956')
    expect(cardVersion({ ...base, heroes: [hero], heroTransparent: true })).toMatchInlineSnapshot(`"57e9860b46e0"`)
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

describe('normalizeProps', () => {
  it('passes plain JSON through, drops undefined members, nulls holes, and turns a Date into its ISO string', () => {
    const holey = new Array(2)
    holey[1] = 'x'
    expect(
      normalizeProps({ a: 1, b: [true, null, 'x'], c: { d: undefined, e: 0 }, f: new Date('2026-01-01T00:00:00Z'), g: holey }),
    ).toEqual({
      a: 1,
      b: [true, null, 'x'],
      c: { e: 0 },
      f: '2026-01-01T00:00:00.000Z',
      g: [null, 'x'],
    })
  })
  it.each([
    ['a Map', { m: new Map([['a', 1]]) }, /props\.m is a Map/],
    ['a Set', { s: new Set([1]) }, /props\.s is a Set/],
    ['a class instance', { c: new (class Money {})() }, /props\.c is a Money/],
    ['a function', { f: () => 1 }, /props\.f is a function/],
    ['a bigint', { n: 1n }, /props\.n is a bigint/],
    ['NaN', { n: Number.NaN }, /props\.n is NaN/],
    ['Infinity nested in an array', { a: [{ n: Number.POSITIVE_INFINITY }] }, /props\.a\[0\]\.n is Infinity/],
    ['an invalid Date', { d: new Date('x') }, /props\.d is an invalid Date/],
  ])('rejects %s, naming the path', (_, props, message) => expect(() => normalizeProps(props)).toThrow(message))
  it('an own "__proto__" key stays data: same object hashed and rendered, prototype untouched', () => {
    const given = JSON.parse('{"title":"A","__proto__":{"polluted":true}}')
    const n = normalizeProps(given) as Record<string, unknown>
    expect(Object.getPrototypeOf(n)).toBe(Object.prototype)
    expect((n as { polluted?: unknown }).polluted).toBeUndefined()
    expect(Object.keys(n)).toEqual(['title', '__proto__'])
    expect(JSON.stringify(n)).toBe(JSON.stringify(given))
    const other = normalizeProps(JSON.parse('{"title":"A","__proto__":{"polluted":false}}'))
    expect(cardVersion({ ...base, props: n })).not.toBe(cardVersion({ ...base, props: other }))
  })
  it('rejects a cycle', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => normalizeProps(a)).toThrow(/circular/)
  })
  it('two different Maps would have hashed alike; now neither is accepted', () => {
    const v = (m: Map<string, number>) => () => cardVersion({ ...base, props: normalizeProps({ title: 'A', m }) })
    expect(v(new Map([['a', 1]]))).toThrow(/Map/)
    expect(v(new Map([['b', 2]]))).toThrow(/Map/)
  })
  it('the variant slot: a JPEG or WebP card is a new version, PNG hashes as ever', () => {
    const jpeg = cardVersion({ ...base, variant: variantOf({ format: 'jpeg', quality: 82, ground: '#ffffff' }) })
    const webp = cardVersion({ ...base, variant: variantOf({ format: 'webp', quality: 82, ground: '#ffffff' }) })
    expect(variantOf({ format: 'png' })).toBeUndefined()
    expect(cardVersion({ ...base, variant: undefined })).toBe('db1903285d83') // the golden value: PNG moves nothing
    expect(new Set([cardVersion(base), jpeg, webp]).size).toBe(3)
    // quality and ground change the bytes of the same drawing, so they change the URL
    expect(cardVersion({ ...base, variant: variantOf({ format: 'jpeg', quality: 70, ground: '#ffffff' }) })).not.toBe(jpeg)
    expect(cardVersion({ ...base, variant: variantOf({ format: 'jpeg', quality: 82, ground: '#000000' }) })).not.toBe(jpeg)
  })
})
