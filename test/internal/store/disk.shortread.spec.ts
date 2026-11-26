/** Mutation table (production line -> the test that goes RED). Silent-failure surface: truncated bytes served as an immutable card.
 * - disk.ts get(): remove the `bytesRead !== st.size` miss -> "a short read of a validated lossy card is a miss, not truncated bytes" RED
 * - disk.ts get(): keep the miss but not `validated.delete(key)` -> "... and the key is dropped: the next read validates in full again" RED */
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { diskStore } from '../../../src/internal/store/disk.js'
import { realCard } from '../../helpers.js'

/** While `short.by > 0`, every FileHandle#read returns that many bytes fewer than it read: the file was truncated after fstat. */
const short = vi.hoisted(() => ({ by: 0 }))
const decodes = vi.hoisted(() => ({ calls: 0 }))
vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (...a: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...a)
      const read = handle.read.bind(handle) as (...r: unknown[]) => Promise<{ bytesRead: number }>
      ;(handle as { read: unknown }).read = async (...r: unknown[]) => {
        const out = await read(...r)
        return short.by > 0 ? { ...out, bytesRead: Math.max(0, out.bytesRead - short.by) } : out
      }
      return handle
    },
  }
})
vi.mock('../../../src/internal/store/validate.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/internal/store/validate.js')>()
  return {
    ...actual,
    isWholeCard: async (...a: Parameters<typeof actual.isWholeCard>) => {
      decodes.calls += 1
      return actual.isWholeCard(...a)
    },
  }
})

const P = 'a'.repeat(16)
const V = 'b'.repeat(12)

describe.each(['jpeg', 'webp'] as const)('diskStore, short read of a validated %s card', (format) => {
  it('is a miss, not truncated bytes, and the key is dropped: the next read validates in full again', async () => {
    const s = diskStore({ dir: await mkdtemp(path.join(os.tmpdir(), 'og-short-')) })
    const b = await realCard('x', format, 64)
    await s.put(P, V, b, format)
    expect(await s.get(P, V, format)).toEqual(b) // validated by this process
    const before = decodes.calls
    expect(await s.get(P, V, format)).toEqual(b) // served from the validated set: no decode
    expect(decodes.calls).toBe(before)

    short.by = 7
    try {
      expect(await s.get(P, V, format)).toBeNull()
    } finally {
      short.by = 0
    }
    expect(await s.get(P, V, format)).toEqual(b) // the file itself is intact and still served
    expect(decodes.calls).toBe(before + 1) // ...after a full validation: the key had been dropped
  })
})
