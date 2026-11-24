/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a path without a key makes every document share one card URL.
 * - template.ts:89  accept a query/fragment in the path -> "a target path with a query or a fragment throws" RED
 * - template.ts:92  drop the :slug/:id check -> "a target path without :slug or :id throws" RED
 * - template.ts:95  drop the kind check -> same test (its kind assertions) RED
 * - template.ts:61  skip the size validation -> "an invalid size or a blank id throws" RED
 * - template.ts:57  drop the `extends PropsModel` constraint (or make Normalized<Date> a Date) -> `pnpm typecheck` goes RED (unused @ts-expect-error / type error), "props typing" */
import { describe, expect, it } from 'vitest'
import { defineTarget, defineTemplate, type Normalized } from '../src/template.js'

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
  it('a target path with a query or a fragment throws (the card URL appends ?v=)', () => {
    expect(() => defineTarget({ path: '/og/:slug.png?x=1', template: 'post', props })).toThrow(/pathname only/)
    expect(() => defineTarget({ path: '/og/:slug.png#frag', template: 'post', props })).toThrow(/pathname only/)
    expect(() => defineTarget({ path: '/og/#/:slug.png', template: 'post', props })).toThrow(/pathname only/)
  })
  it('a target path without :slug or :id throws', () => {
    expect(() => defineTarget({ path: '/og/card.png', template: 'post', props })).toThrow(/no :slug or :id/)
    expect(() => defineTarget({ path: '/og/:slug.png', kind: '..', template: 'post', props })).toThrow(/URL-safe path segment/)
    expect(() => defineTarget({ path: '/og/:slug.png', kind: 'a/b', template: 'post', props })).toThrow(/URL-safe path segment/)
    expect(defineTarget({ path: '/og/:slug.png', kind: 'blog-post_2', template: 'post', props }).kind).toBe('blog-post_2')
    expect(() => defineTarget({ path: 'og/:slug.png', template: 'post', props })).toThrow(/must start with "\/"/)
  })
})

describe('props typing (checked by `pnpm typecheck`, not at run time)', () => {
  it('a Date-typed template prop does not type-check; its normalized form does', () => {
    // @ts-expect-error a Date is not plain JSON: the template would receive a string
    defineTemplate<{ when: Date }>({ id: 'd', revision: '1', render })
    const t = defineTemplate<Normalized<{ when: Date; tags: string[]; nested: { at: Date } }>>({ id: 'n', revision: '1', render })
    expect(t.id).toBe('n')
    const ok: Normalized<{ when: Date; list: Date[] }> = { when: '2026-01-01T00:00:00.000Z', list: ['x'] }
    // @ts-expect-error the normalized shape holds a string, not a Date
    const bad: Normalized<{ when: Date }> = { when: new Date() }
    // @ts-expect-error a Map is rejected at run time, so it is `never` here
    const map: Normalized<{ m: Map<string, number> }> = { m: new Map() }
    expect([ok, bad, map]).toHaveLength(3)
  })
})
