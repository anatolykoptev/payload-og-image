/** Mutation table (production line -> the test that goes RED). Silent-failure surface: an unshareable image advertised to crawlers gives no error.
 * - eligible.ts:8    add image/svg+xml to SHAREABLE                    -> "an SVG, even sized, is not shared" RED
 * - eligible.ts:13   drop the width/height check                       -> "an upload without its size on record is not shared" RED
 * - eligible.ts:30     test only the original file, never `sizes.og`      -> "uses the og rendition when it is eligible" RED
 * - eligible.ts:30  take the og rendition without the eligibility test-> "an og rendition without its size / with an unshareable type falls back to the original file" RED
 * - eligible.ts:17    always prefix serverUrl (even an absolute url)     -> "keeps an absolute URL as it is" RED */
import { describe, expect, it } from 'vitest'
import { firstShareImage, shareImageOf } from '../../src/internal/eligible.js'

const SITE = 'https://x.test'
const sized = (name: string, extra: Record<string, unknown> = {}) => ({
  id: 1,
  alt: `Alt of ${name}`,
  url: `/media/${name}.jpg`,
  width: 2400,
  height: 1260,
  mimeType: 'image/jpeg',
  sizes: { og: { url: `/media/${name}-1200x630.jpg`, width: 1200, height: 630, mimeType: 'image/jpeg' } },
  ...extra,
})

describe('shareImageOf', () => {
  it('uses the og rendition when it is eligible, with the editor alt', () => {
    expect(shareImageOf(sized('hero'), SITE)).toEqual({
      alt: 'Alt of hero',
      url: 'https://x.test/media/hero-1200x630.jpg',
      width: 1200,
      height: 630,
      type: 'image/jpeg',
    })
  })
  it.each([
    ['without its size', { url: '/media/bench-1200x630.jpg', mimeType: 'image/jpeg' }],
    ['with an unshareable type', { url: '/media/bench-1200x630.svg', width: 1200, height: 630, mimeType: 'image/svg+xml' }],
  ])('an og rendition %s falls back to the original file', (_, og) => {
    expect(shareImageOf(sized('bench', { sizes: { og } }), SITE)).toMatchObject({
      url: 'https://x.test/media/bench.jpg',
      width: 2400,
      height: 1260,
      type: 'image/jpeg',
    })
  })
  it('an upload without its size on record is not shared', () => {
    expect(shareImageOf({ id: 3, sizes: {}, url: '/media/unsized.jpg' }, SITE)).toBeUndefined()
    expect(shareImageOf(sized('x', { width: 0 }), SITE)?.width).toBe(1200) // the rendition still qualifies
    expect(shareImageOf({ id: 3, url: '/m.jpg', width: 0, height: 630, mimeType: 'image/jpeg' }, SITE)).toBeUndefined()
  })
  it('an SVG, even sized, is not shared: X takes no SVG in a large card', () => {
    expect(
      shareImageOf({ id: 4, url: '/media/d.svg', width: 1200, height: 630, mimeType: 'image/svg+xml', sizes: {} }, SITE),
    ).toBeUndefined()
    expect(shareImageOf({ id: 4, url: '/media/d.png', width: 1200, height: 630, mimeType: 'IMAGE/PNG' }, SITE)?.type).toBe('IMAGE/PNG')
  })
  it('is not fooled by an unpopulated id, null, a string or an empty url', () => {
    for (const v of [7, '7', null, undefined, {}, { id: 1, url: '  ', width: 1, height: 1, mimeType: 'image/png' }]) {
      expect(shareImageOf(v, SITE)).toBeUndefined()
    }
  })
  it('keeps an absolute URL as it is, and resolves protocol-relative and bare paths', () => {
    const f = (url: string) => shareImageOf({ id: 1, url, width: 1, height: 1, mimeType: 'image/png' }, 'https://x.test/')?.url
    expect(f('https://cdn.test/a.png')).toBe('https://cdn.test/a.png')
    expect(f('//cdn.test/a.png')).toBe('https://cdn.test/a.png')
    expect(f('/a.png')).toBe('https://x.test/a.png')
    expect(f('a.png')).toBe('https://x.test/a.png')
  })
  it('omits alt when the editor gave none', () => {
    expect(shareImageOf({ id: 1, url: '/a.png', width: 1, height: 1, mimeType: 'image/png', alt: '  ' }, SITE)).not.toHaveProperty('alt')
  })
})

describe('firstShareImage', () => {
  it('skips empty, unpopulated and unsized candidates and returns the first usable one', () => {
    const got = firstShareImage([undefined, 5, { id: 2, url: '/u.jpg' }, sized('second'), sized('third')], SITE)
    expect(got?.url).toBe('https://x.test/media/second-1200x630.jpg')
    expect(firstShareImage([undefined, null], SITE)).toBeUndefined()
  })
})
