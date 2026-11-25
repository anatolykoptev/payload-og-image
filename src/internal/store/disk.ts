import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, mkdir, open, readdir, realpath, rename, statfs, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeCall } from '../events.js'
import { type CardFormat, extensionOf } from '../format.js'
import { assertInt, assertNumber } from '../limits.js'
import type { CardStore, OnEvent } from '../types.js'
import { isWholeCard } from './validate.js'

export type DiskStoreOptions = {
  dir: string
  maxFiles?: number
  maxBytes?: number
  /** Versions of one page kept by a prune (default 2: the current one and the one before). */
  keepPerPage?: number
  /** Minimum gap between automatic prunes (default 60 s). */
  pruneEveryMs?: number
  onEvent?: OnEvent
}

export type DiskStore = CardStore & { prune(): Promise<void>; readonly enabled: boolean; readonly dir: string }

const PAGE_ID = /^[0-9a-f]{16}$/
const VERSION = /^[0-9a-f]{12}$/
/** The only names this store owns: a card file, and a temporary file left by a write cut short. */
const CARD_FILE = /^([0-9a-f]{16})-[0-9a-f]{12}\.(?:png|jpg|webp)$/
const TEMP_FILE = /^[0-9a-f]{16}-[0-9a-f]{12}\.(?:png|jpg|webp)\.\d+\.[0-9a-f]{8}\.tmp$/
const TEMP_TTL_MS = 60 * 60 * 1000
/** Errors that retrying cannot fix: the store turns itself off with one event. */
const PERMANENT = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOTDIR'])

const code = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code
const noop = () => undefined
const fileOf = (pageId: string, v: string, format: CardFormat) => `${pageId}-${v}.${extensionOf(format)}`
/** Open without following a symlink planted at a cache-shaped name (absent on Windows, where it is 0). */
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0
/** A FIFO at a cache-shaped name must not block open() before fstat can reject it. */
const O_NONBLOCK = constants.O_NONBLOCK ?? 0

/**
 * Rendered cards on disk, one file per version: `<pageId>-<v>.png`, `.jpg` for a JPEG card, `.webp` for a WebP one. A file is never stale for its name,
 * because `v` changes whenever anything drawn changes.
 *
 * - Crash-safe write: temp file in the same dir, fsync, rename, best-effort dir fsync. A read validates the
 *   whole file (a PNG: every chunk CRC, IEND at the end; a JPEG: its marker structure, EOI at the end; a WebP: its RIFF size and chunks; both then fully decoded),
 *   so a torn file is a miss and is deleted.
 * - Pruning runs off the request path, throttled: it keeps the newest `keepPerPage` versions of a page,
 *   then trims oldest-first to `maxFiles` / `maxBytes`. Fresh temp files count toward the caps.
 * - Only files matching the two patterns above are ever counted or deleted.
 * - A directory that cannot be written turns the store off with one `store_disabled` event; get/put never throw.
 */
export function diskStore(o: DiskStoreOptions): DiskStore {
  const { dir, maxFiles = 2000, maxBytes = 100 * 1024 * 1024, keepPerPage = 2, pruneEveryMs = 60_000 } = o
  if (typeof dir !== 'string' || dir === '') throw new Error('payload-og-image: disk store dir must be a non-empty path')
  assertInt('disk store maxFiles', maxFiles, 0)
  assertNumber('disk store maxBytes', maxBytes, 1)
  assertInt('disk store keepPerPage', keepPerPage, 1)
  assertNumber('disk store pruneEveryMs', pruneEveryMs, 0, { finite: false })
  const emit: OnEvent = (e) => {
    if (o.onEvent) safeCall(o.onEvent, e)
  }
  /** The real path of `dir`, set at boot. Every file operation goes through it. */
  let root = dir
  let off = false
  let skippedOnce = false
  let ready: Promise<boolean> | undefined
  let lastPrune = 0
  let tail: Promise<void> = Promise.resolve()

  const disable = (error: unknown) => {
    if (off) return
    off = true
    emit({ name: 'store_disabled', detail: { dir, code: code(error), message: (error as Error)?.message } })
  }
  const skipOnce = (error: unknown) => {
    if (skippedOnce) return
    skippedOnce = true
    emit({ name: 'store_write_skipped', detail: { reason: 'write_error', code: code(error), message: (error as Error)?.message } })
  }

  const boot = async (): Promise<boolean> => {
    try {
      await mkdir(dir, { recursive: true })
      // The root itself must not be a symlink (a link planted there would redirect every read and delete).
      // Parent components may be (macOS temp dirs are), so the real path is resolved once and used from here on.
      if ((await lstat(dir)).isSymbolicLink()) {
        disable(Object.assign(new Error(`${dir} is a symbolic link`), { code: 'ESYMLINKROOT' }))
        return false
      }
      root = await realpath(dir)
      await access(root, constants.W_OK)
    } catch (error) {
      disable(error)
      return false
    }
    try {
      const fs = await statfs(root)
      const free = Number(fs.bavail) * Number(fs.bsize)
      if (free < maxBytes) emit({ name: 'store_write_skipped', detail: { reason: 'low_free_space', free, maxBytes } })
    } catch {
      // not every file system reports free space
    }
    return true
  }
  const usable = async () => {
    ready ??= boot()
    return !off && (await ready)
  }

  const fsyncDir = async () => {
    try {
      const h = await open(root, 'r')
      try {
        await h.sync()
      } finally {
        await h.close()
      }
    } catch {
      // best effort: some platforms cannot fsync a directory
    }
  }

  const doPrune = async () => {
    let names: string[]
    try {
      names = await readdir(root)
    } catch {
      return
    }
    const stats = await Promise.all(
      names.map(async (name) => {
        const isCard = CARD_FILE.exec(name)
        if (!isCard && !TEMP_FILE.test(name)) return null
        try {
          // lstat: a symlink, directory or other non-regular file at a cache-shaped name is foreign, never counted or deleted.
          const s = await lstat(path.join(root, name))
          if (!s.isFile()) return null
          return { name, page: isCard?.[1] ?? '', temp: !isCard, mtime: s.mtimeMs, size: s.size, ino: s.ino }
        } catch {
          return null // removed by another process meanwhile
        }
      }),
    )
    const files = stats.filter((f): f is NonNullable<typeof f> => f !== null)
    // Delete only the file that was observed: if the name now holds something else (replaced meanwhile), leave it.
    const drop = (f: { name: string; mtime: number; size: number; ino: number }) =>
      dropIfSame(path.join(root, f.name), { ino: f.ino, mtimeMs: f.mtime, size: f.size })

    const now = Date.now()
    const liveTemps = []
    for (const f of files.filter((f) => f.temp)) {
      if (now - f.mtime > TEMP_TTL_MS) await drop(f)
      else liveTemps.push(f)
    }
    // Newest first; the name breaks mtime ties so the order is deterministic.
    const cards = files.filter((f) => !f.temp).sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1))
    const kept: typeof cards = []
    const perPage = new Map<string, number>()
    for (const c of cards) {
      const n = (perPage.get(c.page) ?? 0) + 1
      perPage.set(c.page, n)
      if (n > keepPerPage) await drop(c)
      else kept.push(c)
    }
    let count = kept.length + liveTemps.length
    let bytes = kept.reduce((s, f) => s + f.size, 0) + liveTemps.reduce((s, f) => s + f.size, 0)
    for (let i = kept.length - 1; i >= 0 && (count > maxFiles || bytes > maxBytes); i--) {
      const f = kept[i] as (typeof kept)[number]
      await drop(f)
      count -= 1
      bytes -= f.size
    }
  }

  // Off the request path: never awaited, throttled. Also after a failed write: a full disk is exactly
  // when deleting old cards helps.
  const schedulePrune = () => {
    if (Date.now() - lastPrune >= pruneEveryMs) {
      lastPrune = Date.now()
      setImmediate(() => void store.prune()).unref()
    }
  }

  /** Unlink `file` only if it is still the regular file that was observed (same inode, mtime and size). */
  const dropIfSame = async (file: string, seen: { ino: number; mtimeMs: number; size: number }) => {
    const cur = await lstat(file).catch(() => null)
    if (cur?.isFile() && cur.ino === seen.ino && cur.mtimeMs === seen.mtimeMs && cur.size === seen.size) await unlink(file).catch(noop)
  }

  const store: DiskStore = {
    dir,
    get enabled() {
      return !off
    },
    prune() {
      // Runs queue behind each other, so an explicit call waits for one already running.
      // A disabled store (unwritable, or a symlinked root) never prunes: its root is not to be trusted.
      const run = tail.then(async () => ((await usable()) ? doPrune() : undefined)).catch(noop)
      tail = run
      lastPrune = Date.now()
      return run
    },
    async get(pageId, v, format = 'png') {
      if (!PAGE_ID.test(pageId) || !VERSION.test(v) || !(await usable())) return null
      const file = path.join(root, fileOf(pageId, v, format))
      let handle: Awaited<ReturnType<typeof open>>
      try {
        // O_NOFOLLOW: a symlink at a cache-shaped name fails to open (ELOOP), and is left alone.
        handle = await open(file, constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
      } catch {
        return null
      }
      let bytes: Uint8Array
      let seen: { ino: number; mtimeMs: number; size: number }
      try {
        const st = await handle.stat()
        // Not a regular file (a fifo, a device): foreign, never read and never deleted.
        if (!st.isFile()) return null
        seen = st
        if (st.size > maxBytes) {
          // Larger than the whole cache budget cannot be one of our cards: drop it, allocate nothing.
          await dropIfSame(file, seen)
          emit({ name: 'store_corrupt', v, bytes: st.size, detail: { reason: 'oversized' } })
          return null
        }
        const buf = Buffer.alloc(st.size)
        const { bytesRead } = await handle.read(buf, 0, st.size, 0)
        bytes = new Uint8Array(buf.buffer, buf.byteOffset, bytesRead)
      } catch {
        return null
      } finally {
        await handle.close().catch(noop)
      }
      if (await isWholeCard(bytes, format)) return bytes
      // A file cut short by a host crash is not a card: drop it so the next request draws it again.
      await dropIfSame(file, seen)
      emit({ name: 'store_corrupt', v, bytes: bytes.byteLength })
      return null
    },
    async stat(pageId, v, format = 'png') {
      if (!PAGE_ID.test(pageId) || !VERSION.test(v) || !(await usable())) return null
      try {
        const st = await lstat(path.join(root, fileOf(pageId, v, format))) // lstat: a symlink at a card name is foreign
        return st.isFile() ? { bytes: st.size } : null
      } catch {
        return null
      }
    },
    async put(pageId, v, bytes, format = 'png') {
      if (!PAGE_ID.test(pageId) || !VERSION.test(v) || !(await usable())) return
      if (!(await isWholeCard(bytes, format))) {
        emit({ name: 'store_write_skipped', v, bytes: bytes.byteLength, detail: { reason: `not_a_complete_${format}` } })
        return
      }
      const target = path.join(root, fileOf(pageId, v, format))
      const tmp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
      let owned = true // false once the exclusive create found the name already taken: not ours to unlink
      const write = async () => {
        owned = true
        try {
          await writeFile(tmp, bytes, { flush: true, flag: 'wx' })
        } catch (error) {
          if (code(error) === 'EEXIST') owned = false
          throw error
        }
        await rename(tmp, target)
        await fsyncDir()
      }
      try {
        try {
          await write()
        } catch (error) {
          if (code(error) !== 'ENOENT') throw error
          await mkdir(root, { recursive: true }) // the directory vanished after boot: recreate once and retry
          await write()
        }
      } catch (error) {
        if (owned) await unlink(tmp).catch(noop)
        if (PERMANENT.has(code(error) ?? '')) disable(error)
        else {
          skipOnce(error)
          schedulePrune()
        }
        return
      }
      schedulePrune()
    },
  }
  return store
}
