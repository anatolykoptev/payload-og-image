/** Mutation table (reviewer neuters each once in a scratch copy). Silent-failure surface: a torn or foreign file is served or deleted without error.
 * - disk.ts:178   get(): replace `isCompletePng(bytes)` with `true`                  -> "a torn file (...) is a miss and is deleted" RED
 * - disk.ts:116      doPrune(): drop the CARD_FILE/TEMP_FILE ownership filter            -> "never counts or deletes files it does not own" RED
 * - disk.ts:141       doPrune(): keep the newest 1 instead of keepPerPage                 -> "keeps the newest two versions of a page" RED
 * - disk.ts:211     put(): await store.prune() inline instead of scheduling             -> "put never prunes on the hot path" RED
 * - disk.ts:214   put(): never schedule a prune                                       -> "put schedules a prune off the hot path" RED
 * - disk.ts:145  doPrune(): leave live temp files out of bytes                           -> "counts fresh temp files toward the cap" RED
 * - disk.ts:144  doPrune(): leave live temp files out of count                           -> "counts fresh temp files toward maxFiles" RED
 * - disk.ts:131  doPrune(): never sweep old temp files                               -> "sweeps temp files older than an hour" RED
 * - disk.ts:201     put(): drop the ENOENT mkdir-and-retry                              -> "recreates a directory that vanished" RED
 * - disk.ts:207       disable on every error (drop the PERMANENT split)                   -> "a non-permanent write error is skipped once and keeps the store on" RED
 * - disk.ts:61       emit store_disabled on every failure (drop the `if (off) return`)   -> "concurrent failing writes emit ONE store_disabled" RED
 * - disk.ts:185        drop the PAGE_ID/VERSION validation                                 -> "a non-hex page id or version never becomes a file name" RED
 * - disk.ts:82     drop the free-space check                                           -> "warns once at boot when the cap exceeds free space" RED
 * - disk.ts:186     put(): drop the isCompletePng check                                 -> "put refuses bytes that are not a whole PNG" RED */
import { chmod, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { diskStore } from '../../../src/internal/store/disk.js'
import type { OgEvent } from '../../../src/internal/types.js'

const png = async (c = '#c33') =>
  new Uint8Array(
    await sharp({ create: { width: 64, height: 64, channels: 3, background: c } })
      .png()
      .toBuffer(),
  )
const P = 'a'.repeat(16)
const V = (c: string) => c.repeat(12)
const tmp = () => mkdtemp(path.join(os.tmpdir(), 'og-'))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => Promise<boolean>, ms = 3000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(10)) if (await cond()) return true
  return false
}
const events = () => {
  const list: OgEvent[] = []
  return { list, onEvent: (e: OgEvent) => list.push(e), names: () => list.map((e) => e.name) }
}

describe('diskStore', () => {
  it('round-trips a card and leaves no temp file behind', async () => {
    const dir = await tmp()
    const s = diskStore({ dir })
    const b = await png()
    await s.put(P, V('b'), b)
    expect(await s.get(P, V('b'))).toEqual(b)
    expect(await readdir(dir)).toEqual([`${P}-${V('b')}.png`])
  })

  it.each([
    ['truncated at 50%', (b: Uint8Array) => b.subarray(0, b.length >> 1)],
    [
      'last 8 bytes wrong',
      (b: Uint8Array) => {
        const c = Uint8Array.from(b)
        c.fill(0, c.length - 8)
        return c
      },
    ],
  ])('a torn file (%s) is a miss and is deleted', async (_, tear) => {
    const dir = await tmp()
    const ev = events()
    const s = diskStore({ dir, onEvent: ev.onEvent })
    const name = `${P}-${V('c')}.png`
    await writeFile(path.join(dir, name), tear(await png()))
    expect(await s.get(P, V('c'))).toBeNull()
    expect(await readdir(dir)).not.toContain(name)
    expect(ev.names()).toContain('store_corrupt')
  })

  it('never counts or deletes files it does not own', async () => {
    const dir = await tmp()
    // Old enough that a store mistaking them for its own temp files would sweep them.
    for (const name of ['logo.png', `${P}-short.png`, `${P}-${V('d')}.png.bak`]) {
      await writeFile(path.join(dir, name), await png('#000'))
      await utimes(path.join(dir, name), 1, 1)
    }
    const s = diskStore({ dir, maxFiles: 1, pruneEveryMs: Number.POSITIVE_INFINITY })
    await s.put(P, V('d'), await png())
    await s.put('e'.repeat(16), V('f'), await png())
    await s.prune()
    const left = await readdir(dir)
    expect(left).toContain('logo.png')
    expect(left).toContain(`${P}-short.png`)
    expect(left).toContain(`${P}-${V('d')}.png.bak`)
  })

  it('keeps the newest two versions of a page', async () => {
    const dir = await tmp()
    const s = diskStore({ dir, keepPerPage: 2, pruneEveryMs: Number.POSITIVE_INFINITY })
    for (const [i, v] of ['1', '2', '3'].entries()) {
      await s.put(P, V(v), await png())
      await utimes(path.join(dir, `${P}-${V(v)}.png`), 1000 + i, 1000 + i)
    }
    await s.prune()
    expect((await readdir(dir)).sort()).toEqual([`${P}-${V('2')}.png`, `${P}-${V('3')}.png`])
  })

  it('put never prunes on the hot path', async () => {
    const dir = await tmp()
    // Throttle off for automatic prunes, so only an inline prune inside put could delete anything.
    const s = diskStore({ dir, maxFiles: 1, pruneEveryMs: Number.POSITIVE_INFINITY })
    await s.put(P, V('4'), await png())
    await utimes(path.join(dir, `${P}-${V('4')}.png`), 1000, 1000)
    await s.put(P, V('5'), await png())
    expect((await readdir(dir)).sort()).toEqual([`${P}-${V('4')}.png`, `${P}-${V('5')}.png`])
  })

  it('put schedules a prune off the hot path', async () => {
    const dir = await tmp()
    const s = diskStore({ dir, maxFiles: 1, pruneEveryMs: 0 })
    await s.put(P, V('4'), await png())
    await utimes(path.join(dir, `${P}-${V('4')}.png`), 1000, 1000)
    await s.put(P, V('5'), await png())
    expect(await until(async () => (await readdir(dir)).length === 1)).toBe(true)
    expect(await readdir(dir)).toEqual([`${P}-${V('5')}.png`])
  })

  it('sweeps temp files older than an hour', async () => {
    const dir = await tmp()
    const t = path.join(dir, `${P}-${V('9')}.png.123.abcdef01.tmp`)
    await writeFile(t, Buffer.alloc(10))
    await utimes(t, 1, 1)
    await diskStore({ dir }).prune()
    expect(await readdir(dir)).not.toContain(path.basename(t))
  })

  it('counts fresh temp files toward the cap', async () => {
    const dir = await tmp()
    const card = await png()
    const t = path.join(dir, `${'1'.repeat(16)}-${V('9')}.png.123.abcdef01.tmp`)
    await writeFile(t, Buffer.alloc(5000)) // fresh: not swept, but it occupies the disk
    const s = diskStore({ dir, maxBytes: card.length + 1000, pruneEveryMs: Number.POSITIVE_INFINITY })
    await s.put(P, V('a'), card)
    await s.prune()
    expect(await readdir(dir)).toEqual([path.basename(t)]) // the card went; the temp file stays until it ages out
  })

  it('counts fresh temp files toward maxFiles', async () => {
    const dir = await tmp()
    await writeFile(path.join(dir, `${'1'.repeat(16)}-${V('9')}.png.123.abcdef01.tmp`), Buffer.alloc(10))
    const s = diskStore({ dir, maxFiles: 1, pruneEveryMs: Number.POSITIVE_INFINITY })
    await s.put(P, V('a'), await png())
    await s.prune()
    expect(await readdir(dir)).toHaveLength(1) // only the temp file: with it counted, the card is over the cap
  })

  it('concurrent failing writes emit ONE store_disabled', async () => {
    const dir = await tmp()
    const ev = events()
    const s = diskStore({ dir, onEvent: ev.onEvent })
    await s.put(P, V('a'), await png()) // boots while the dir is still writable
    await chmod(dir, 0o500)
    const card = await png()
    await Promise.all([V('b'), V('c'), V('d')].map((v) => s.put(P, v, card)))
    expect(ev.names().filter((n) => n === 'store_disabled')).toHaveLength(1)
  })

  it('a read-only dir turns the store off with ONE store_disabled event; get/put never throw', async () => {
    const dir = await tmp()
    await chmod(dir, 0o500)
    const ev = events()
    const s = diskStore({ dir, onEvent: ev.onEvent })
    await s.put(P, V('a'), await png())
    await s.put(P, V('b'), await png())
    expect(await s.get(P, V('a'))).toBeNull()
    expect(ev.names().filter((n) => n === 'store_disabled')).toHaveLength(1)
    expect(s.enabled).toBe(false)
  })

  it('a non-permanent write error is skipped once and keeps the store on', async () => {
    const dir = await tmp()
    const ev = events()
    const s = diskStore({ dir, onEvent: ev.onEvent })
    // A directory squatting on the card's name makes the rename fail with EISDIR, which is not permanent.
    await mkdir(path.join(dir, `${P}-${V('a')}.png`))
    await s.put(P, V('a'), await png())
    await s.put(P, V('a'), await png())
    expect(ev.list.filter((e) => e.name === 'store_write_skipped' && e.detail?.reason === 'write_error')).toHaveLength(1)
    expect(s.enabled).toBe(true)
    await s.put(P, V('b'), await png())
    expect(await s.get(P, V('b'))).not.toBeNull()
  })

  it('recreates a directory that vanished after boot', async () => {
    const dir = await tmp()
    const s = diskStore({ dir })
    await s.put(P, V('a'), await png())
    await rm(dir, { recursive: true })
    await s.put(P, V('b'), await png())
    expect(await s.get(P, V('b'))).not.toBeNull()
    expect(s.enabled).toBe(true)
  })

  it('a non-hex page id or version never becomes a file name', async () => {
    // The store dir sits two levels down, so a path-escaping id would land in `outer/inner`.
    const outer = await tmp()
    const inner = path.join(outer, 'inner')
    const dir = path.join(inner, 'store')
    await mkdir(dir, { recursive: true })
    const s = diskStore({ dir })
    await s.put('../../etc', 'x', await png())
    await s.put('../x', V('a'), await png())
    await s.put(P, '../../etc/passwd', await png())
    expect(await s.get('../../etc', 'x')).toBeNull()
    expect(await readdir(dir)).toEqual([])
    expect(await readdir(inner)).toEqual(['store'])
    expect(await readdir(outer)).toEqual(['inner'])
  })

  it('put refuses bytes that are not a whole PNG', async () => {
    const dir = await tmp()
    const ev = events()
    const s = diskStore({ dir, onEvent: ev.onEvent })
    await s.put(P, V('a'), new Uint8Array([1, 2, 3]))
    expect(await readdir(dir)).toEqual([])
    expect(ev.list.some((e) => e.name === 'store_write_skipped' && e.detail?.reason === 'not_a_complete_png')).toBe(true)
  })

  it('warns once at boot when the cap exceeds free space', async () => {
    const dir = await tmp()
    const ev = events()
    const s = diskStore({ dir, maxBytes: Number.MAX_SAFE_INTEGER, onEvent: ev.onEvent })
    await s.put(P, V('a'), await png())
    await s.put(P, V('b'), await png())
    expect(ev.list.filter((e) => e.detail?.reason === 'low_free_space')).toHaveLength(1)
    expect(s.enabled).toBe(true)
  })
})
