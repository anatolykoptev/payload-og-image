/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a path without a key makes every document share one card URL.
 * - template.ts:67  drop the :slug/:id check in defineTarget -> "a target path without :slug or :id throws" RED
 * - template.ts:70  drop the kind check -> same test (its kind assertions) RED
 * - template.ts:39  skip the size validation -> "an invalid size or a blank id throws" RED */
import { describe, expect, it } from 'vitest'
import { defineTarget, defineTemplate } from '../src/template.js'

const render = () => null as never
const props = () => ({})

describe('defineTemplate', () => {
  it('defaults the size to 1200x630 and keeps what it was given', () => {
    expect(defineTemplate({ id: 'a', revision: '1', render }).size).toEqual({ width: 1200, height: 630 })
    expect(defineTemplate({ id: 'a', revision: '1', size: { width: 800, height: 400 }, render }).size).toEqual({ width: 800, height: 400 })
  })
  it('an invalid size or a blank id throws', () => {
    expect(() => defineTemplate({ id: 'a', revision: '1', size: { width: 0, height: 630 }, render })).toThrow(/invalid size/)
    expect(() => defineTemplate({ id: ' ', revision: '1', render })).toThrow(/non-empty id/)
  })
})

describe('defineTarget', () => {
  it('returns a valid target as given', () => {
    const t = { path: '/og/:kind/:slug/card.png', template: 'post', props }
    expect(defineTarget(t)).toBe(t)
    expect(defineTarget({ path: '/cards/:id.png', template: 'post', props }).path).toBe('/cards/:id.png')
  })
  it('a target path without :slug or :id throws', () => {
    expect(() => defineTarget({ path: '/og/card.png', template: 'post', props })).toThrow(/no :slug or :id/)
    expect(() => defineTarget({ path: '/og/:slug.png', kind: '..', template: 'post', props })).toThrow(/URL-safe path segment/)
    expect(() => defineTarget({ path: '/og/:slug.png', kind: 'a/b', template: 'post', props })).toThrow(/URL-safe path segment/)
    expect(defineTarget({ path: '/og/:slug.png', kind: 'blog-post_2', template: 'post', props }).kind).toBe('blog-post_2')
    expect(() => defineTarget({ path: 'og/:slug.png', template: 'post', props })).toThrow(/must start with "\/"/)
  })
})
