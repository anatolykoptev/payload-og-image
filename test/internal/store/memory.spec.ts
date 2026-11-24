/** Mutation table (production line -> the test that goes RED). Silent-failure surface: unbounded memory gives no error.
 * - memory.ts:12  drop the oversize guard -> "never keeps one card larger than the whole budget" RED */
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
})
