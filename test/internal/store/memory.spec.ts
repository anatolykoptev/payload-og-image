/** Mutation table (production line -> the test that goes RED). Silent-failure surface: unbounded memory gives no error.
 * - memory.ts:12  accept an empty card -> "refuses an empty card" RED; drop the oversize guard -> "never keeps one card larger than the whole budget" RED
 * - memory.ts:13  keep the view, not a copy -> "keeps an exact copy" RED */
import { describe, expect, it } from 'vitest'
import { memoryStore } from '../../../src/internal/store/memory.js'

const bytes = (n: number) => new Uint8Array(n)

describe('memoryStore', () => {
  it('round-trips and keeps versions of a page apart', async () => {
    const s = memoryStore()
    await s.put('p', 'v1', bytes(3))
    await s.put('p', 'v2', bytes(5))
    expect((await s.get('p', 'v1'))?.length).toBe(3)
    expect((await s.get('p', 'v2'))?.length).toBe(5)
    expect(await s.get('p', 'v3')).toBeNull()
  })
  it('drops the oldest entries past maxBytes but keeps the one just written', async () => {
    const s = memoryStore({ maxBytes: 100 })
    for (const v of ['a', 'b', 'c']) await s.put('p', v, bytes(60))
    expect(await s.get('p', 'a')).toBeNull()
    expect(await s.get('p', 'b')).toBeNull()
    expect(await s.get('p', 'c')).not.toBeNull()
  })
  it('never keeps one card larger than the whole budget, and keeps what it already had', async () => {
    const s = memoryStore({ maxBytes: 100 })
    await s.put('p', 'small', bytes(50))
    await s.put('p', 'huge', bytes(500))
    expect(await s.get('p', 'huge')).toBeNull()
    expect(await s.get('p', 'small')).not.toBeNull()
  })
  it('keeps an exact copy: a later change to the source, or its big backing buffer, does not leak in', async () => {
    const s = memoryStore({ maxBytes: 100 })
    const backing = new Uint8Array(1000)
    const view = backing.subarray(0, 10)
    view.fill(7)
    await s.put('p', 'a', view)
    backing.fill(9)
    const got = await s.get('p', 'a')
    expect([...(got ?? [])]).toEqual(Array(10).fill(7))
    expect(got?.buffer.byteLength).toBe(10)
  })
  it('refuses an empty card', async () => {
    const s = memoryStore()
    await s.put('p', 'a', new Uint8Array(0))
    expect(await s.get('p', 'a')).toBeNull()
  })
})
