/** Mutation table (production line -> the test that goes RED). Silent-failure surface: Next ignores a cache tag over 256 characters, so a page tagged with one is never revalidated and nothing says so.
 * - revalidate.ts:4  raise MAX_TAG_LENGTH above Next's own limit (300) -> "a tag one character over Next's limit is shortened" RED
 * - revalidate.ts:18  never shorten (`return tag`) -> that test, "a 240-character slug ..." and "a long collection name" RED
 * - revalidate.ts:18  `<=` -> `<` (a tag of exactly 256 is shortened) -> "is og:<collection>:<key> for any tag Next accepts" RED
 * - revalidate.ts:19  hash the key without the collection -> "two long collection names with the same key do not share a tag" RED */
import { NEXT_CACHE_TAG_MAX_LENGTH } from 'next/dist/lib/constants.js'
import { describe, expect, it } from 'vitest'
import { OG_SITE_TAG, ogTag } from '../../src/next/revalidate.js'

/** A key that makes `og:posts:<key>` exactly `length` characters long. */
const keyFor = (length: number, filler = 'a') => filler.repeat(length - 'og:posts:'.length)

describe('ogTag', () => {
  it('is og:<collection>:<key> for any tag Next accepts, so tags already in use do not move', () => {
    expect(ogTag('posts', 'hello')).toBe('og:posts:hello')
    expect(ogTag('posts', 42)).toBe('og:posts:42')
    for (const n of [NEXT_CACHE_TAG_MAX_LENGTH - 1, NEXT_CACHE_TAG_MAX_LENGTH]) {
      const tag = ogTag('posts', keyFor(n))
      expect(tag).toHaveLength(n)
      expect(tag).toBe(`og:posts:${keyFor(n)}`)
    }
  })
  it("a tag one character over Next's limit is shortened, and stays the same tag every time", () => {
    const key = keyFor(NEXT_CACHE_TAG_MAX_LENGTH + 1)
    const tag = ogTag('posts', key)
    expect(tag.length).toBeLessThanOrEqual(NEXT_CACHE_TAG_MAX_LENGTH)
    expect(tag).toMatch(/^og:posts:~[0-9a-f]{32}$/)
    expect(ogTag('posts', key)).toBe(tag)
  })
  it('a 240-character slug fits as it is; slugs that differ only at the end keep different tags when shortened', () => {
    expect(ogTag('posts', 's'.repeat(240))).toBe(`og:posts:${'s'.repeat(240)}`)
    const a = ogTag('posts', `${'s'.repeat(300)}a`)
    const b = ogTag('posts', `${'s'.repeat(300)}b`)
    expect(a).not.toBe(b)
    expect(a.length).toBeLessThanOrEqual(NEXT_CACHE_TAG_MAX_LENGTH)
  })
  it('two collections with the same long key do not share a tag', () => {
    const key = 'k'.repeat(300)
    expect(ogTag('posts', key)).not.toBe(ogTag('pages', key))
  })
  it('two long collection names with the same key do not share a tag', () => {
    expect(ogTag(`${'c'.repeat(300)}1`, 'x')).not.toBe(ogTag(`${'c'.repeat(300)}2`, 'x'))
  })
  it('a long collection name is shortened too', () => {
    const tag = ogTag('c'.repeat(300), 'x')
    expect(tag.length).toBeLessThanOrEqual(NEXT_CACHE_TAG_MAX_LENGTH)
    expect(tag).toMatch(/^og:~[0-9a-f]{32}$/)
  })
  it('the site tag is a short fixed name', () => {
    expect(OG_SITE_TAG).toBe('og:site')
  })
})
