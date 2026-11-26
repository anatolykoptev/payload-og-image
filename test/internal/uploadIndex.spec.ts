/** Mutation table (production line -> the test that goes RED). Silent-failure surface: old pixels left in the store after an upload changed, with no error.
 * - uploadIndex.ts `failed` entries not put back -> "a card whose delete failed stays in the index and the next purge removes it" RED
 * - uploadIndex.ts `cards.delete(id)` before `cards.set` (no recency refresh) -> "a card drawn again is the last to be evicted" RED */
import { describe, expect, it, vi } from 'vitest'
import { createMemo } from '../../src/internal/memo.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { createUploadIndex, type DrawnCard } from '../../src/internal/uploadIndex.js'

const card = (n: number): DrawnCard => ({
  pageId: String(n).padStart(16, '0'),
  v: 'a'.repeat(12),
  encoding: { format: 'png' },
  hero: { id: 9, url: '/m/h.jpg' } as never,
  heroCollection: 'media',
  images: [],
})

describe('createUploadIndex', () => {
  it('a card whose delete failed stays in the index and the next purge removes it', async () => {
    const store = memoryStore()
    const errors: string[] = []
    const idx = createUploadIndex({ store: () => store, memo: createMemo(), onError: (m) => errors.push(m) })
    const c = card(1)
    await store.put(c.pageId, c.v, new Uint8Array([1]))
    idx.stamp(c)
    const drop = vi.spyOn(store, 'drop').mockRejectedValueOnce(new Error('EIO'))
    expect(await idx.purge('media', 9)).toBe(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/EIO/)
    expect(await store.get(c.pageId, c.v)).not.toBeNull()
    drop.mockRestore()
    expect(await idx.purge('media', 9)).toBe(1)
    expect(await store.get(c.pageId, c.v)).toBeNull()
  })
  it('a card drawn again is the last to be evicted from its upload', async () => {
    const store = memoryStore()
    const idx = createUploadIndex({ store: () => store, memo: createMemo() })
    const first = card(0)
    await store.put(first.pageId, first.v, new Uint8Array([1]))
    idx.stamp(first)
    for (let i = 1; i < 64; i++) idx.stamp(card(i)) // 64 cards: the bound
    idx.stamp(first) // served again: now the most recent
    idx.stamp(card(64)) // one past the bound evicts the oldest, which is no longer `first`
    await idx.purge('media', 9)
    expect(await store.get(first.pageId, first.v)).toBeNull()
  })
})
