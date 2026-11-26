/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a reader served a half-written card.
 * - disk.ts put(): write to `target` instead of `tmp` (no rename) -> "a card is not visible under its name until the write is complete" RED, "a write cut short leaves no card under the card name" RED
 * - disk.ts put(): skip `rename(tmp, target)` -> "a card is not visible under its name until the write is complete" RED (the card never appears) */
import { mkdtemp, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { diskStore } from '../../../src/internal/store/disk.js'

/** `writeFile` writes the first half of the bytes, then waits for `gate.release` (or throws, as a crash would). */
const gate = vi.hoisted(() => ({
  release: undefined as undefined | (() => void),
  wait: undefined as undefined | Promise<void>,
  crash: false,
}))
vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: async (file: string, data: Uint8Array, options: never) => {
      await actual.writeFile(file, data.subarray(0, Math.floor(data.byteLength / 2)), options)
      if (gate.crash) throw Object.assign(new Error('the process died mid-write'), { code: 'EIO' })
      await gate.wait
      await actual.writeFile(file, data, { flag: 'w' })
    },
  }
})

const P = 'a'.repeat(16)
const V = 'b'.repeat(12)
const png = async () =>
  new Uint8Array(
    await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c33' } })
      .png()
      .toBuffer(),
  )
const tmp = () => mkdtemp(path.join(os.tmpdir(), 'og-crash-'))
const name = `${P}-${V}.png`

describe('diskStore put is crash-safe', () => {
  it('a card is not visible under its name until the write is complete', async () => {
    const dir = await tmp()
    const s = diskStore({ dir })
    const b = await png()
    gate.wait = new Promise((r) => {
      gate.release = r
    })
    gate.crash = false
    const writing = s.put(P, V, b)
    await vi.waitFor(async () => expect((await readdir(dir)).some((f) => f.endsWith('.tmp'))).toBe(true)) // half the bytes are on disk, in the temp file
    expect(await readdir(dir)).not.toContain(name)
    expect(await s.get(P, V)).toBeNull()
    expect(await s.stat(P, V)).toBeNull()
    gate.release?.()
    await writing
    expect(await readdir(dir)).toEqual([name])
    expect(await s.get(P, V)).toEqual(b)
  })

  it('a write cut short leaves no card under the card name, and no temp file', async () => {
    const dir = await tmp()
    const s = diskStore({ dir })
    gate.crash = true
    try {
      await s.put(P, V, await png())
    } finally {
      gate.crash = false
    }
    expect(await readdir(dir)).toEqual([])
    expect(await s.get(P, V)).toBeNull()
  })
})
