/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a torn or foreign JPEG/WebP is served as an immutable card.
 * - disk.ts get(): `isWholeCard(bytes, format)` -> `isCompletePng(bytes)` (or accept any bytes) -> "a whole <format> round-trips" / "a torn <format> file is a miss and is deleted" RED
 * - disk.ts put(): drop the `isWholeCard` check -> "put refuses bytes that are not a whole <format>" RED
 * - disk.ts `fileOf` always `.png` -> "a whole <format> round-trips" (file name) RED
 * - disk.ts CARD_FILE without `jpg|webp` -> "prune counts and trims JPEG and WebP files" RED
 * - disk.ts `validated` set: a repeat get validates again -> "a file is validated in full once per process" RED; key without ino/mtime/size -> "... a file replaced on disk is validated again" RED
 * - validate.ts `checked` WeakSet dropped -> validate.spec "bytes the renderer already validated are not decoded again" RED
 * - disk.ts get(): the `format` argument ignored (validated as PNG) -> "a PNG at a .jpg name is a miss" RED */
import { mkdtemp, readdir, rename, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CardFormat } from '../../../src/internal/format.js'
import { diskStore } from '../../../src/internal/store/disk.js'
import type { OgEvent } from '../../../src/internal/types.js'
import { realCard } from '../../helpers.js'

const decodes = vi.hoisted(() => ({ calls: 0 }))
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
const V = (c: string) => c.repeat(12)
const tmp = () => mkdtemp(path.join(os.tmpdir(), 'og-lossy-'))
const EXT = { jpeg: 'jpg', webp: 'webp' } as const
const events = () => {
  const list: OgEvent[] = []
  return { list, onEvent: (e: OgEvent) => list.push(e) }
}

describe.each(['jpeg', 'webp'] as const)('diskStore, %s cards', (format) => {
  const ext = EXT[format]
  const card = (text: string) => realCard(text, format, 64)

  it(`a whole ${format} round-trips under a .${ext} name and leaves no temp file`, async () => {
    const dir = await tmp()
    const s = diskStore({ dir })
    const b = await card('x')
    await s.put(P, V('b'), b, format)
    expect(await s.get(P, V('b'), format)).toEqual(b)
    expect(await s.stat(P, V('b'), format)).toEqual({ bytes: b.byteLength })
    expect(await readdir(dir)).toEqual([`${P}-${V('b')}.${ext}`])
    expect(await s.stat(P, V('b'))).toBeNull() // the same version as a PNG is another file
  })

  it.each([
    ['cut in half', (b: Uint8Array) => b.subarray(0, b.length >> 1)],
    ['a zeroed tail', (b: Uint8Array) => Uint8Array.from(b).fill(0, b.length - 6)],
    ['one byte short', (b: Uint8Array) => b.subarray(0, b.length - 1)],
  ])(`a torn %s file is a miss and is deleted`, async (_, tear) => {
    const dir = await tmp()
    const ev = events()
    const s = diskStore({ dir, onEvent: ev.onEvent })
    const name = `${P}-${V('c')}.${ext}`
    await writeFile(path.join(dir, name), tear(await card('torn')))
    expect(await s.get(P, V('c'), format)).toBeNull()
    expect(await readdir(dir)).not.toContain(name)
    expect(ev.list.map((e) => e.name)).toContain('store_corrupt')
  })

  it('a PNG at a card name of another format is a miss', async () => {
    const dir = await tmp()
    const s = diskStore({ dir })
    const name = `${P}-${V('d')}.${ext}`
    await writeFile(path.join(dir, name), await realCard('p', 'png'))
    expect(await s.get(P, V('d'), format)).toBeNull()
    expect(await readdir(dir)).not.toContain(name)
  })

  it(`put refuses bytes that are not a whole ${format}`, async () => {
    const dir = await tmp()
    const ev = events()
    const s = diskStore({ dir, onEvent: ev.onEvent })
    const b = await card('y')
    for (const bad of [b.subarray(0, b.length >> 1), await realCard('p', 'png'), new Uint8Array()]) await s.put(P, V('e'), bad, format)
    expect(await readdir(dir)).toEqual([])
    expect(ev.list.filter((e) => e.name === 'store_write_skipped').map((e) => e.detail?.reason)).toEqual(
      Array(3).fill(`not_a_complete_${format}`),
    )
  })

  it('a file is validated in full once per process; a file replaced on disk is validated again', async () => {
    const dir = await tmp()
    const s = diskStore({ dir })
    await s.put(P, V('f'), await card('one'), format)
    const file = path.join(dir, `${P}-${V('f')}.${ext}`)
    decodes.calls = 0
    expect(await s.get(P, V('f'), format)).not.toBeNull()
    expect(await s.get(P, V('f'), format)).not.toBeNull()
    expect(decodes.calls).toBe(1) // the second read trusts the first
    const other = await card('two, a different card')
    await writeFile(`${file}.new`, other)
    await rename(`${file}.new`, file) // replaced: another inode, size and mtime
    expect(await s.get(P, V('f'), format)).toEqual(other)
    expect(decodes.calls).toBe(2)
    await writeFile(file, other.subarray(0, other.length >> 1)) // torn after validation: size changed, so it is decoded, found torn, deleted
    expect(await s.get(P, V('f'), format)).toBeNull()
    expect(decodes.calls).toBe(3)
  })

  it('prune counts and trims JPEG and WebP files with the PNGs', async () => {
    const dir = await tmp()
    const s = diskStore({ dir, maxFiles: 1, pruneEveryMs: Number.POSITIVE_INFINITY })
    const other: CardFormat = format === 'jpeg' ? 'webp' : 'jpeg'
    await s.put(P, V('1'), await card('1'), format)
    await s.put('b'.repeat(16), V('2'), await realCard('2', other, 64), other)
    for (const f of await readdir(dir)) await utimes(path.join(dir, f), f.startsWith(P) ? 1 : 2, f.startsWith(P) ? 1 : 2)
    await s.prune()
    expect(await readdir(dir)).toEqual([`${'b'.repeat(16)}-${V('2')}.${EXT[other]}`])
  })
})
