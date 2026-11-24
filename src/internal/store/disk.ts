import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, open, readdir, readFile, rename, stat, statfs, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeCall } from '../events.js'
import type { CardStore, OnEvent } from '../types.js'
import { isCompletePng } from './png.js'

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
const CARD_FILE = /^([0-9a-f]{16})-[0-9a-f]{12}\.png$/
const TEMP_FILE = /^[0-9a-f]{16}-[0-9a-f]{12}\.png\.\d+\.[0-9a-f]{8}\.tmp$/
const TEMP_TTL_MS = 60 * 60 * 1000
/** Errors that retrying cannot fix: the store turns itself off with one event. */
const PERMANENT = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOTDIR'])

const code = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code
const noop = () => undefined

/**
 * Rendered cards on disk, one file per version: `<pageId>-<v>.png`. A file is never stale for its name,
 * because `v` changes whenever anything drawn changes.
 *
 * - Crash-safe write: temp file in the same dir, fsync, rename, best-effort dir fsync. A read validates the
 *   whole file (every chunk CRC, IEND at the end), so a torn file is a miss and is deleted.
 * - Pruning runs off the request path, throttled: it keeps the newest `keepPerPage` versions of a page,
 *   then trims oldest-first to `maxFiles` / `maxBytes`. Fresh temp files count toward the caps.
 * - Only files matching the two patterns above are ever counted or deleted.
 * - A directory that cannot be written turns the store off with one `store_disabled` event; get/put never throw.
 */
export function diskStore(o: DiskStoreOptions): DiskStore {
  const { dir, maxFiles = 2000, maxBytes = 100 * 1024 * 1024, keepPerPage = 2, pruneEveryMs = 60_000 } = o
  const emit: OnEvent = (e) => {
    if (o.onEvent) safeCall(o.onEvent, e)
  }
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
      await access(dir, constants.W_OK)
    } catch (error) {
      disable(error)
      return false
    }
    try {
      const fs = await statfs(dir)
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
      const h = await open(dir, 'r')
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
      names = await readdir(dir)
    } catch {
      return
    }
    const stats = await Promise.all(
      names.map(async (name) => {
        const isCard = CARD_FILE.exec(name)
        if (!isCard && !TEMP_FILE.test(name)) return null
        try {
          const s = await stat(path.join(dir, name))
          return { name, page: isCard?.[1] ?? '', temp: !isCard, mtime: s.mtimeMs, size: s.size }
        } catch {
          return null // removed by another process meanwhile
        }
      }),
    )
    const files = stats.filter((f): f is NonNullable<typeof f> => f !== null)
    const drop = async (name: string) => void (await unlink(path.join(dir, name)).catch(noop))

    const now = Date.now()
    const liveTemps = []
    for (const f of files.filter((f) => f.temp)) {
      if (now - f.mtime > TEMP_TTL_MS) await drop(f.name)
      else liveTemps.push(f)
    }
    // Newest first; the name breaks mtime ties so the order is deterministic.
    const cards = files.filter((f) => !f.temp).sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1))
    const kept: typeof cards = []
    const perPage = new Map<string, number>()
    for (const c of cards) {
      const n = (perPage.get(c.page) ?? 0) + 1
      perPage.set(c.page, n)
      if (n > keepPerPage) await drop(c.name)
      else kept.push(c)
    }
    let count = kept.length + liveTemps.length
    let bytes = kept.reduce((s, f) => s + f.size, 0) + liveTemps.reduce((s, f) => s + f.size, 0)
    for (let i = kept.length - 1; i >= 0 && (count > maxFiles || bytes > maxBytes); i--) {
      const f = kept[i] as (typeof kept)[number]
      await drop(f.name)
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

  const store: DiskStore = {
    dir,
    get enabled() {
      return !off
    },
    prune() {
      // Runs queue behind each other, so an explicit call waits for one already running.
      const run = tail.then(doPrune).catch(noop)
      tail = run
      lastPrune = Date.now()
      return run
    },
    async get(pageId, v) {
      if (!PAGE_ID.test(pageId) || !VERSION.test(v) || !(await usable())) return null
      const file = path.join(dir, `${pageId}-${v}.png`)
      let buf: Buffer
      try {
        buf = await readFile(file)
      } catch {
        return null
      }
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      if (isCompletePng(bytes)) return bytes
      // A file cut short by a host crash is not a card: drop it so the next request draws it again.
      await unlink(file).catch(noop)
      emit({ name: 'store_corrupt', v, bytes: bytes.byteLength })
      return null
    },
    async put(pageId, v, bytes) {
      if (!PAGE_ID.test(pageId) || !VERSION.test(v) || !(await usable())) return
      if (!isCompletePng(bytes)) {
        emit({ name: 'store_write_skipped', v, bytes: bytes.byteLength, detail: { reason: 'not_a_complete_png' } })
        return
      }
      const target = path.join(dir, `${pageId}-${v}.png`)
      const tmp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
      const write = async () => {
        await writeFile(tmp, bytes, { flush: true })
        await rename(tmp, target)
        await fsyncDir()
      }
      try {
        try {
          await write()
        } catch (error) {
          if (code(error) !== 'ENOENT') throw error
          await mkdir(dir, { recursive: true }) // the directory vanished after boot: recreate once and retry
          await write()
        }
      } catch (error) {
        await unlink(tmp).catch(noop)
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
