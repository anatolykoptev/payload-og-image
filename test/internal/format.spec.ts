/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a card format or quality that boots and then draws nothing like what was asked.
 * - format.ts `formatOf`: plugin before target -> "a target's setting wins over the plugin's" RED
 * - format.ts `assertFormatOption` skipped -> "refuses an unknown format ..." RED
 * - format.ts `pathProblem` always undefined -> "refuses a path whose extension names another format" RED (here and in plugin.spec's neighbour below)
 * - plugin/index.ts `pathProblem` check dropped for the plugin-level format -> "the plugin refuses a .png path for a JPEG card" RED
 * - template.ts `pathProblem` check in defineTarget dropped -> "defineTarget refuses a path that names the other format" RED */
import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import {
  assertFormatOption,
  DEFAULT_JPEG_QUALITY,
  DEFAULT_WEBP_QUALITY,
  extensionOf,
  formatOf,
  pathProblem,
} from '../../src/internal/format.js'
import { ogImagePlugin } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'

describe('assertFormatOption', () => {
  it('accepts nothing, the three formats and integer qualities from 1 to 100', () => {
    expect(() => assertFormatOption('options', {})).not.toThrow()
    for (const format of ['png', 'jpeg', 'webp']) expect(() => assertFormatOption('options', { format })).not.toThrow()
    for (const quality of [1, 82, 100]) expect(() => assertFormatOption('options', { jpeg: { quality }, webp: { quality } })).not.toThrow()
  })
  it.each([
    [{ format: 'gif' }, /format must be 'png', 'jpeg' or 'webp'/],
    [{ format: 'JPEG' }, /format must be/],
    [{ jpeg: { quality: 0 } }, /jpeg\.quality must be an integer from 1 to 100/],
    [{ jpeg: { quality: 101 } }, /jpeg\.quality/],
    [{ webp: { quality: 80.5 } }, /webp\.quality/],
    [{ webp: { quality: '80' } }, /webp\.quality/],
    [{ jpeg: { quality: Number.NaN } }, /jpeg\.quality/],
    [{ jpeg: { qualty: 80 } }, /jpeg\.qualty is not an option/],
    [{ jpeg: { chromaSubsampling: '4:2:2' } }, /jpeg\.chromaSubsampling must be '4:2:0' or '4:4:4'/],
    [{ jpeg: { chromaSubsampling: 444 } }, /jpeg\.chromaSubsampling/],
    [{ webp: { chromaSubsampling: '4:4:4' } }, /webp\.chromaSubsampling is not an option/],
    [{ jpeg: 80 }, /jpeg must be an object/],
    [{ webp: null }, /webp must be an object/],
  ])('refuses an unknown format or a bad quality: %j', (o, message) => {
    expect(() => assertFormatOption('options', o)).toThrow(message)
  })
})

describe('formatOf', () => {
  it('defaults to PNG, with the default qualities', () => {
    expect(formatOf({}, {})).toMatchObject({ format: 'png' })
    expect(formatOf({ format: 'jpeg' }, {}).quality).toBe(DEFAULT_JPEG_QUALITY)
    expect(formatOf({ format: 'webp' }, {}).quality).toBe(DEFAULT_WEBP_QUALITY)
  })
  it("chromaSubsampling: only a JPEG asked for 4:4:4 carries it; the target's wins; 4:2:0 and PNG/WebP leave it out", () => {
    expect(formatOf({ format: 'jpeg', jpeg: { chromaSubsampling: '4:4:4' } }, {})).toEqual({
      format: 'jpeg',
      quality: 82,
      chromaSubsampling: '4:4:4',
    })
    expect(formatOf({ format: 'jpeg', jpeg: { chromaSubsampling: '4:4:4' } }, { jpeg: { chromaSubsampling: '4:2:0' } })).toEqual({
      format: 'jpeg',
      quality: 82,
    })
    expect(formatOf({ format: 'jpeg' }, { jpeg: { chromaSubsampling: '4:4:4' } }).chromaSubsampling).toBe('4:4:4')
    expect(formatOf({ format: 'jpeg', jpeg: { chromaSubsampling: '4:2:0' } }, {})).toEqual({ format: 'jpeg', quality: 82 })
    expect(formatOf({ format: 'webp', jpeg: { chromaSubsampling: '4:4:4' } }, {}).chromaSubsampling).toBeUndefined()
    expect(formatOf({ jpeg: { chromaSubsampling: '4:4:4' } }, {}).chromaSubsampling).toBeUndefined() // PNG
  })
  it("a target's setting wins over the plugin's, for the format and for the quality of its own format", () => {
    expect(formatOf({ format: 'jpeg' }, { format: 'png' }).format).toBe('png')
    expect(formatOf({ format: 'png' }, { format: 'webp' }).format).toBe('webp')
    expect(formatOf({ format: 'jpeg', jpeg: { quality: 90 } }, { jpeg: { quality: 60 } }).quality).toBe(60)
    expect(formatOf({ webp: { quality: 55 } }, { format: 'webp' }).quality).toBe(55)
    expect(formatOf({ jpeg: { quality: 55 } }, { format: 'webp' }).quality).toBe(DEFAULT_WEBP_QUALITY) // the other format's quality is not borrowed
  })
})

describe('card path and format', () => {
  it('refuses a path whose extension names another format; a path with no image extension is the site’s own', () => {
    expect(pathProblem('/og/:kind/:slug/card.png', 'jpeg')).toMatch(/ends in \.png but the card is a JPEG: use a \.jpg path/)
    expect(pathProblem('/og/:slug.jpg', 'png')).toMatch(/use a \.png path/)
    expect(pathProblem('/og/:slug/card.PNG', 'webp')).toMatch(/use a \.webp path/)
    for (const [path, format] of [
      ['/og/:slug/card.jpg', 'jpeg'],
      ['/og/:slug/card.jpeg', 'jpeg'],
      ['/og/:slug/card.webp', 'webp'],
      ['/og/:slug/card.png', 'png'],
      ['/og/:slug/card', 'jpeg'],
      ['/og/:slug/card.v2', 'webp'], // not an image extension
    ] as const)
      expect(pathProblem(path, format)).toBeUndefined()
    expect(extensionOf('jpeg')).toBe('jpg')
  })
  it('defineTarget refuses a path that names the other format', () => {
    const t = { template: 'post', props: () => ({}) }
    expect(() => defineTarget({ ...t, path: '/og/:slug/card.png', format: 'jpeg' })).toThrow(
      /target path "\/og\/:slug\/card\.png" ends in \.png/,
    )
    expect(() => defineTarget({ ...t, path: '/og/:slug/card.jpg', format: 'jpeg', jpeg: { quality: 70 } })).not.toThrow()
    expect(() => defineTarget({ ...t, path: '/og/:slug/card.jpg', format: 'jpeg', jpeg: { quality: 700 } })).toThrow(/jpeg\.quality/)
    expect(() => defineTarget({ ...t, path: '/og/:slug/card.png' })).not.toThrow() // no format of its own: the plugin's decides
  })
  const post = defineTemplate<{ title: string }>({ id: 'post', revision: '1', render: () => null as never })
  const config = (): Config => ({ serverURL: 'https://x.test', collections: [{ slug: 'posts', fields: [] }] }) as unknown as Config
  const options = (over: object, path = '/og/:kind/:slug/card.png') => ({
    site: () => ({ name: 'Site' }),
    fonts: [{ family: 'Inter', data: async () => new Uint8Array() }],
    stacks: { default: ['Inter'] },
    templates: [post],
    targets: { posts: defineTarget<unknown, unknown>({ path, template: 'post', props: () => ({ title: 't' }) }) },
    store: { memory: true as const },
    ...over,
  })
  it('the plugin refuses a .png path for a JPEG card, and a bad format or quality', () => {
    expect(() => ogImagePlugin(options({ format: 'jpeg' }))(config())).toThrow(
      /target "posts" path "\/og\/:kind\/:slug\/card\.png" ends in \.png/,
    )
    expect(() => ogImagePlugin(options({ format: 'jpeg' }, '/og/:kind/:slug/card.jpg'))(config())).not.toThrow()
    expect(() => ogImagePlugin(options({ format: 'png' }))(config())).not.toThrow()
    expect(() => ogImagePlugin(options({ format: 'avif' }))(config())).toThrow(/options\.format must be/)
    expect(() => ogImagePlugin(options({ webp: { quality: 0 } }))(config())).toThrow(/options\.webp\.quality/)
  })
  it('the plugin refuses a static card whose path names the other format', () => {
    const card = { path: '/og/index/home/card.png', kind: 'index', slug: 'home', template: 'post', props: () => ({}) }
    expect(() => ogImagePlugin(options({ format: 'webp', static: { home: card } }, '/og/:kind/:slug/card.webp'))(config())).toThrow(
      /static card "home" path .* ends in \.png/,
    )
    expect(() => ogImagePlugin(options({ static: { home: { ...card, format: 'webp' } } }))(config())).toThrow(/static card "home"/)
  })
})
