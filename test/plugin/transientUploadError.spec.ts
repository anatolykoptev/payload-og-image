/** A failed upload read is not an absent upload. Silent-failure surface: a hero read that fails would otherwise draw a hero-less card under a NEW `v`,
 * which a page advertises and the route serves immutable for a year.
 * Mutation table (production line -> the test that goes RED):
 * - uploads.ts `orAbsent` returning `absent` for every error (the old catch-all) -> "a failed upload read answers 503, stores nothing, advertises no v, and the next request draws the hero" RED
 * - payloadSource.ts `readRelated` without `orAbsent`, or `readMany` swallowing errors -> "a related document that fails to read is an error, not null" RED */
import { describe, expect, it } from 'vitest'
import { CACHE } from '../../src/internal/handler.js'
import { orAbsent } from '../../src/internal/uploads.js'
import { readRelated } from '../../src/plugin/payloadSource.js'
import { setup } from './uploadHarness.js'

const forbidden = Object.assign(new Error('You are not allowed to perform this action.'), { name: 'Forbidden', status: 403 })

describe('a failed upload read is not an absent upload', () => {
  it('a failed upload read answers 503, stores nothing, advertises no v, and the next request draws the hero', async () => {
    const events: Array<{ name: string }> = []
    const HERO = 'data:image/jpeg;base64,AAAA'
    // The first byte says whether the hero was drawn.
    const renderer = { render: async (el: unknown) => new Uint8Array([JSON.stringify(el).includes('AAAA') ? 1 : 0, 7]) }
    const { handler, store, payload, resolve } = setup({ collections: ['posts'] }, undefined, {
      deps: { heroLoader: async () => HERO, renderer, events: { emit: (e: { name: string }) => events.push(e) } },
    })
    const real = payload.find.bind(payload)
    let mode: 'ok' | 'empty' | 'error' = 'ok'
    ;(payload as unknown as { find: unknown }).find = async (a: Record<string, any>) => {
      if (a.collection === 'media' && mode === 'error') throw new Error('connection terminated')
      if (a.collection === 'media' && mode === 'empty') return { docs: [], totalDocs: 0 }
      return real(a as never)
    }
    const req = (v?: string) => new Request(`https://www.example.test/og/posts/a/card.jpg${v ? `?v=${v}` : ''}`)
    const ctx = { params: Promise.resolve({ kind: 'posts', slug: 'a' }) }
    const generated = async () => {
      const c = await resolve('a')
      if (c.kind !== 'generated') throw new Error('not generated')
      return c
    }

    mode = 'empty' // a definite answer: the upload is not there. This IS the hero-less card.
    const bare = await generated()
    expect(bare.hero).toBeNull()
    mode = 'ok'
    const drawn = await generated()
    expect(drawn.hero).not.toBeNull()
    expect(drawn.v).not.toBe(bare.v)
    expect(drawn.pageId).toBe(bare.pageId)

    mode = 'error' // the same read, failing once
    await expect(resolve('a')).rejects.toThrow('connection terminated') // no v is computed: metadata gets an error, never the hero-less card's v
    const failed = await handler.GET(req(bare.v), ctx) // even a crawler holding the hero-less v
    expect([failed.status, failed.headers.get('cache-control')]).toEqual([503, CACHE.none])
    expect(failed.headers.get('etag')).toBeNull()
    expect(events.map((e) => e.name)).toContain('render_error')
    expect(await store.get(bare.pageId, bare.v, 'jpeg')).toBeNull()
    expect(await store.get(drawn.pageId, drawn.v, 'jpeg')).toBeNull()

    mode = 'ok' // the database recovers
    const next = await handler.GET(req(drawn.v), ctx)
    expect([next.status, next.headers.get('cache-control'), next.headers.get('x-og-cache')]).toEqual([200, CACHE.immutable, 'render'])
    expect(next.headers.get('etag')).toBe(`"${drawn.v}"`)
    expect((await next.arrayBuffer()).byteLength).toBe(2)
    expect((await store.get(drawn.pageId, drawn.v, 'jpeg'))?.[0]).toBe(1) // the hero was drawn, and that is what was stored
    expect(await store.get(bare.pageId, bare.v, 'jpeg')).toBeNull()
  })

  it('only a definite answer is no upload: Forbidden and NotFound are, anything else is not', async () => {
    expect(await orAbsent(async () => Promise.reject(forbidden), 'none')).toBe('none')
    expect(await orAbsent(async () => Promise.reject(Object.assign(new Error('x'), { name: 'NotFound' })), 'none')).toBe('none')
    expect(await orAbsent(async () => Promise.reject(Object.assign(new Error('x'), { status: 404 })), 'none')).toBe('none')
    await expect(orAbsent(async () => Promise.reject(new Error('timeout')), 'none')).rejects.toThrow('timeout')
    await expect(orAbsent(async () => Promise.reject(Object.assign(new Error('boom'), { status: 500 })), 'none')).rejects.toThrow('boom')
  })

  it('a related document that fails to read is an error, not null; a forbidden one is null', async () => {
    const { payload } = setup({ collections: ['posts'] })
    ;(payload as unknown as { find: unknown }).find = async () => {
      throw forbidden
    }
    expect(await readRelated(payload, 'posts', 10)).toBeNull()
    ;(payload as unknown as { find: unknown }).find = async () => {
      throw new Error('connection terminated')
    }
    await expect(readRelated(payload, 'posts', 10)).rejects.toThrow('connection terminated')
  })
})
