/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a tool that lets a caller open unbounded reads, or names the wrong document.
 * - inspect.ts the `scopes`/`card`/`audit` wrappers around `d.gate.run` dropped -> "concurrent audits are bounded: two run, two wait, the rest are shed" RED
 * - inspect.ts `locate` maps `:id` to `{ id }` -> "a card path with :id is looked up by its slug, as the route does" (tools.spec) RED
 * - inspect.ts the audit row slug read from `doc.slug` -> "an audit row's slug follows the target's slugField" (tools.spec) RED */
import { describe, expect, it } from 'vitest'
import { createGate, ShedError } from '../../src/internal/gate.js'
import type { CardHandler, DocSource } from '../../src/internal/handler.js'
import { createInspector } from '../../src/internal/inspect.js'
import { memoryStore } from '../../src/internal/store/memory.js'

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
})
