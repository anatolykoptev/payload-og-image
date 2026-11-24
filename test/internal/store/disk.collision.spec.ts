/** Mutation table (production line -> the test that goes RED). Silent-failure surface: deleting a file the store never created.
 * - disk.ts:261  unlink the temp name even when the exclusive create found it taken (EEXIST) -> "does not unlink a temp name it never created" RED */
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'

// A fixed "random" suffix makes the temp name predictable, so a colliding file can be planted at it.
vi.mock('node:crypto', async (orig) => ({
  ...(await orig<typeof import('node:crypto')>()),
  randomBytes: () => Buffer.from('abcdef01', 'hex'),
}))

it('does not unlink a temp name it never created (EEXIST on the exclusive create)', async () => {
  const { diskStore } = await import('../../../src/internal/store/disk.js')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'og-'))
  const P = 'a'.repeat(16)
  const V = 'b'.repeat(12)
  const taken = path.join(dir, `${P}-${V}.png.${process.pid}.abcdef01.tmp`)
  await writeFile(taken, 'someone else')
  const png = new Uint8Array(
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c33' } })
      .png()
      .toBuffer(),
  )
  const s = diskStore({ dir })
  await s.put(P, V, png)
  expect(await readdir(dir)).toEqual([path.basename(taken)])
  expect(await readFile(taken, 'utf8')).toBe('someone else')
  expect(s.enabled).toBe(true)
})
