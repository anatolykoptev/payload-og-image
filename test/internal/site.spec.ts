/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a stale site name drawn on every card for a minute.
 * - site.ts:11  accept a bad ttl -> "refuses a ttl that is not a finite number of at least 0" RED
 * - site.ts:16  cache forever -> "loads once within the ttl and again after it" RED
 * - site.ts:20  cache a rejection -> "a rejection is forgotten, not cached" RED
 * - site.ts:25  invalidate() does not clear -> "invalidate() forces a reload" RED */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cachedSite } from '../../src/internal/site.js'

afterEach(() => vi.useRealTimers())

describe('cachedSite', () => {
  it('loads once within the ttl and again after it', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async () => ({ name: 'S' }))
    const site = cachedSite(load, { ttlMs: 1000 })
    await site.get()
    await site.get()
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1001)
    await site.get()
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('a rejection is forgotten, not cached', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ name: 'S' })
    const site = cachedSite(load)
    await expect(site.get()).rejects.toThrow('down')
    await expect(site.get()).resolves.toEqual({ name: 'S' })
  })
  it('invalidate() forces a reload', async () => {
    let name = 'Old'
    const site = cachedSite(async () => ({ name }))
    expect((await site.get()).name).toBe('Old')
    name = 'New'
    site.invalidate()
    expect((await site.get()).name).toBe('New')
  })
  it('a load in flight when invalidate() runs is not cached afterwards (no separate guard exists: nothing sets the entry after the load starts)', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let name = 'Old'
    const load = vi.fn(async () => {
      const seen = name
      await gate
      return { name: seen }
    })
    const site = cachedSite(load)
    const inflight = site.get()
    name = 'New'
    site.invalidate()
    release()
    expect((await inflight).name).toBe('Old') // the caller that asked before still gets its answer
    expect((await site.get()).name).toBe('New') // ...but it was not cached: this is a fresh load
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('refuses a ttl that is not a finite number of at least 0', () => {
    for (const ttlMs of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => cachedSite(async () => ({ name: 'S' }), { ttlMs })).toThrow(/ttlMs/)
  })
})
