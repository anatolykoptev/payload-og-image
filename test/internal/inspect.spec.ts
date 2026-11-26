/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a tool that lets a caller open unbounded reads, or names the wrong document.
 * - inspect.ts the `scopes`/`card`/`audit` wrappers around `d.gate.run` dropped -> "concurrent audits are bounded: two run, two wait, the rest are shed" RED
 * - inspect.ts serve(): `d.gate.run(() => resolveRef(a))` -> `resolveRef(a)` -> "serve lookups are bounded: two are held, the third is shed before it reads" RED
 * - inspect.ts `heroReport(card, card.heroCollection, ...)` -> the target's `heroCollection` -> "reports the hero against the collection the route resolved" RED
 * - inspect.ts `locate` maps `:id` to `{ id }` -> "a card path with :id is looked up by its slug, as the route does" (tools.spec) RED
 * - inspect.ts the audit row slug read from `doc.slug` -> "an audit row's slug follows the target's slugField" (tools.spec) RED */
import { describe, expect, it } from 'vitest'
import { createGate, isShedError, ShedError } from '../../src/internal/gate.js'
import type { CardHandler, DocSource } from '../../src/internal/handler.js'
import { createInspector } from '../../src/internal/inspect.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { collectionOf, type VerifiedUpload } from '../../src/internal/uploads.js'
import { verifiedUpload } from '../helpers.js'

describe('createInspector: the hero collection', () => {
  it('reports the hero against the collection the route resolved (a populated hero, several upload collections, no heroCollection)', async () => {
    const asked: Array<string | undefined> = []
    const hero = verifiedUpload({ id: 9, url: '/m/h.jpg', filename: 'h.jpg' }, 'photos') // the collection the reader verified it from
    const card = {
      kind: 'generated',
      key: { kind: 'posts', slug: 'a' },
      pageId: 'a'.repeat(16),
      v: 'b'.repeat(12),
      url: 'https://x.test/og/posts/a/card.png?v=bbbbbbbbbbbb',
      template: { id: 'post' },
      alt: 'A',
      size: { width: 1200, height: 630 },
      type: 'image/png',
      encoding: { format: 'png' },
      hero,
      heroTransparent: false,
      heroGround: undefined,
    }
    const inspector = createInspector({
      gate: createGate({ concurrency: 2, queue: 2 }),
      targets: { posts: { path: '/og/:kind/:slug/card.png' } },
      statics: {},
      source: { publishedById: async () => ({ id: 1, slug: 'a' }) } as unknown as DocSource,
      store: memoryStore(),
      heroLoader: { readable: async (h: VerifiedUpload) => (asked.push(collectionOf(h)), true) } as never,
      handler: { resolve: async () => card } as unknown as CardHandler,
    })
    const r = await inspector.card({ target: 'posts', id: 1 })
    expect(asked).toEqual(['photos'])
    expect(r).toMatchObject({ found: true, hero: { id: 9, readable: true } })
  })
})

describe('createInspector', () => {
  it('concurrent audits are bounded: two run, two wait, the rest are shed', async () => {
    let active = 0
    let peak = 0
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const source = {
      listPublished: async () => {
        active += 1
        peak = Math.max(peak, active)
        await held
        active -= 1
        return { docs: [], totalDocs: 0 }
      },
    } as unknown as DocSource
    const inspector = createInspector({
      gate: createGate({ concurrency: 2, queue: 2 }),
      targets: { posts: { path: '/og/:kind/:slug/card.png' } },
      statics: {},
      source,
      store: memoryStore(),
      heroLoader: (async () => null) as never,
      handler: { resolve: async () => ({ kind: 'none' }) } as unknown as CardHandler,
    })
    const calls = Array.from({ length: 6 }, () =>
      inspector.audit({ scope: 'posts', page: 1, limit: 10 }).then(
        () => 'ok',
        (e) => e,
      ),
    )
    await new Promise((r) => setImmediate(r))
    expect(peak).toBe(2) // the third and fourth wait for a slot
    release()
    const results = await Promise.all(calls)
    expect(results.filter((r) => r === 'ok')).toHaveLength(4)
    expect(results.filter((r) => r instanceof ShedError)).toHaveLength(2) // the fifth and sixth found the queue full
    expect(peak).toBe(2)
  })

  it('serve lookups are bounded: two are held, the third is shed before it reads', async () => {
    let started = 0
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const source = {
      published: async () => {
        started += 1
        await held
        return null // no such document: serve answers not_found without drawing
      },
    } as unknown as DocSource
    const inspector = createInspector({
      gate: createGate({ concurrency: 2, queue: 0 }),
      targets: { posts: { path: '/og/:kind/:slug/card.png' } },
      statics: {},
      source,
      store: memoryStore(),
      heroLoader: (async () => null) as never,
      handler: { resolve: async () => ({ kind: 'none' }) } as unknown as CardHandler,
    })
    const call = (slug: string) =>
      inspector.serve({ target: 'posts', slug }).then(
        (r) => r,
        (e) => e,
      )
    const first = [call('a'), call('b')]
    try {
      await new Promise((r) => setImmediate(r))
      expect(started).toBe(2) // both lookups are inside the gate, held
      const third = call('c')
      await new Promise((r) => setImmediate(r))
      expect(started).toBe(2) // the third never reached the source: it was shed (an ungated one would be waiting on the latch)
      expect(isShedError(await third)).toBe(true)
    } finally {
      release()
    }
    expect(await Promise.all(first)).toEqual([
      { status: 'not_found', reason: 'no published document' },
      { status: 'not_found', reason: 'no published document' },
    ])
  })
})
