/** Mutation table (production line -> the test that goes RED). Silent-failure surface: duplicate renders and unbounded memory give no error.
 * - memo.ts:31  skip the join -> "single flight" RED
 * - memo.ts:48  keep a rejected entry -> "a failed make is forgotten" RED
 * - memo.ts:22  evict pending entries too -> "never evicts a pending entry" RED
 * - memo.ts:39  count the view length, not its backing buffer -> "counts the backing buffer a view keeps alive" RED
 * - memo.ts:40  remember an empty card -> "never remembers an empty card" RED */
import { describe, expect, it, vi } from 'vitest'
import { createMemo } from '../../src/internal/memo.js'

const png = (n: number) => new Uint8Array(n)
const tick = () => new Promise((r) => setImmediate(r))

describe('createMemo', () => {
  it('single flight: two concurrent gets call make once', async () => {
    const memo = createMemo()
    const make = vi.fn(async () => png(10))
    const [a, b] = await Promise.all([memo.get('k', make), memo.get('k', make)])
    expect(make).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })
  it('a failed make is forgotten, so the next get tries again', async () => {
    const memo = createMemo()
    await expect(memo.get('k', async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    await tick()
    expect(memo.size).toBe(0)
    const make = vi.fn(async () => png(5))
    await memo.get('k', make)
    expect(make).toHaveBeenCalledTimes(1)
  })
  it('stays within maxBytes by dropping the oldest settled entries', async () => {
    const memo = createMemo({ maxBytes: 100 })
    for (const k of ['a', 'b', 'c']) await memo.get(k, async () => png(60))
    await tick()
    expect(memo.bytes).toBeLessThanOrEqual(100)
    expect(memo.size).toBe(1)
  })
  it('never evicts a pending entry: a second get joins it', async () => {
    const memo = createMemo({ maxBytes: 10 })
    let finish!: (b: Uint8Array) => void
    const slow = vi.fn(
      () =>
        new Promise<Uint8Array>((r) => {
          finish = r
        }),
    )
    const pending = memo.get('slow', slow)
    for (const k of ['a', 'b', 'c']) await memo.get(k, async () => png(60))
    await tick()
    const joined = memo.get('slow', slow)
    expect(slow).toHaveBeenCalledTimes(1)
    finish(png(1))
    expect(await joined).toBe(await pending)
  })
  it('counts the backing buffer a view keeps alive, not the view length', async () => {
    const memo = createMemo({ maxBytes: 100 })
    await memo.get('k', async () => new Uint8Array(1000).subarray(0, 10))
    await tick()
    expect(memo.bytes).toBe(0)
    expect(memo.size).toBe(0)
  })
  it('never remembers an empty card', async () => {
    const memo = createMemo()
    const make = vi.fn(async () => new Uint8Array(0))
    await memo.get('k', make)
    await tick()
    expect(memo.size).toBe(0)
    await memo.get('k', make)
    expect(make).toHaveBeenCalledTimes(2)
  })
  it('delete releases the bytes', async () => {
    const memo = createMemo()
    await memo.get('k', async () => png(40))
    await tick()
    expect(memo.bytes).toBe(40)
    memo.delete('k')
    expect(memo.bytes).toBe(0)
    expect(memo.size).toBe(0)
  })
})
