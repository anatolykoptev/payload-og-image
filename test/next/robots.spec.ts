/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a page that drops its `noindex` while adding a preview size, and is indexed.
 * - next/robots.ts the object branch returning `{ index: true, follow: true, 'max-image-preview': 'large' }` (a fixed answer) -> "a noindex stays a noindex ..." RED
 * - next/robots.ts the string branch returning the preview directive alone -> "a noindex string stays ..." RED
 * - next/robots.ts `robots['max-image-preview'] ?? 'large'` -> `'large'` (overriding the site's choice) -> "a preview size the site chose is its own" RED */
import { describe, expect, it } from 'vitest'
import { withLargeImagePreview } from '../../src/next/robots.js'

describe('withLargeImagePreview', () => {
  it('a noindex stays a noindex, in every shape Next takes', () => {
    expect(withLargeImagePreview({ index: false, follow: false })).toEqual({ index: false, follow: false, 'max-image-preview': 'large' })
    expect(withLargeImagePreview({ index: false })).toMatchObject({ index: false })
    expect(withLargeImagePreview({ index: false, googleBot: { index: false, follow: false } })).toMatchObject({
      index: false,
      googleBot: { index: false, follow: false },
    })
    expect(withLargeImagePreview({ nosnippet: true, noarchive: true, 'max-snippet': 0 })).toMatchObject({
      nosnippet: true,
      noarchive: true,
      'max-snippet': 0,
    })
    expect(withLargeImagePreview({ googleBot: 'noindex' })).toMatchObject({ googleBot: 'noindex' })
  })

  it('a noindex string stays a noindex string', () => {
    expect(withLargeImagePreview('noindex, nofollow')).toBe('noindex, nofollow, max-image-preview:large')
    expect(withLargeImagePreview('noindex')).toContain('noindex')
    expect(withLargeImagePreview('  index,follow ')).toBe('index,follow, max-image-preview:large')
  })

  it('no robots at all is the crawler default plus the preview size', () => {
    expect(withLargeImagePreview()).toEqual({ index: true, follow: true, 'max-image-preview': 'large' })
    expect(withLargeImagePreview(null)).toEqual({ index: true, follow: true, 'max-image-preview': 'large' })
    expect(withLargeImagePreview('')).toBe('index, follow, max-image-preview:large')
  })

  it('a preview size the site chose is its own', () => {
    expect(withLargeImagePreview({ 'max-image-preview': 'none' })).toMatchObject({ 'max-image-preview': 'none' })
    expect(withLargeImagePreview({ 'max-image-preview': 'standard' })).toMatchObject({ 'max-image-preview': 'standard' })
    expect(withLargeImagePreview('noindex, max-image-preview:none')).toBe('noindex, max-image-preview:none')
    expect(withLargeImagePreview('MAX-IMAGE-PREVIEW : standard')).toBe('MAX-IMAGE-PREVIEW : standard')
  })

  it('does not change what it was given, and is idempotent', () => {
    const given = Object.freeze({ index: false, follow: true })
    expect(withLargeImagePreview(given)).not.toBe(given)
    expect(given).toEqual({ index: false, follow: true })
    const once = withLargeImagePreview({ index: false })
    expect(withLargeImagePreview(once)).toEqual(once)
    expect(withLargeImagePreview(withLargeImagePreview('noindex'))).toBe(withLargeImagePreview('noindex'))
  })
})
