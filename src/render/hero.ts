import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { HeroLoader } from '../internal/handler.js'
import { MAX_SIDE } from '../internal/limits.js'
import type { Upload } from '../internal/types.js'

export type HeroLoaderOptions = {
  /** The folders Payload writes uploads to (each upload collection's `staticDir`). */
  staticDirs: () => Promise<string[]>
  /** Hosts a hero may be fetched from, matched exactly against the parsed hostname. Default none: no fetch at render time. */
  allowedHosts?: string[]
  fetchImpl?: typeof fetch
  /** Largest source file or download (default 15 MiB). */
  maxBytes?: number
  /** Largest source image in pixels (default 40 million); a bigger header is refused before any decode. */
  maxPixels?: number
  /** Colour the image is flattened onto where it is transparent (default white). */
  background?: string
}

const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0
const O_NONBLOCK = constants.O_NONBLOCK ?? 0
/** Raster formats only: an SVG would be rasterised by librsvg, which may touch other files. */
const RASTER = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif'])
const FETCH_TIMEOUT_MS = 5000

const posInt = (n: unknown, what: string) => {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1)
    throw new Error(`payload-og-image: ${what} must be a positive integer, got ${String(n)}`)
  return n
}

/** A regular file, opened without following a symlink or waiting on a FIFO, read only if within `maxBytes`. */
async function readRegular(file: string, maxBytes: number): Promise<Buffer | null> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(file, constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
  } catch {
    return null
  }
  try {
    const st = await handle.stat()
    if (!st.isFile() || st.size > maxBytes || st.size === 0) return null
    const buf = Buffer.alloc(st.size)
    const { bytesRead } = await handle.read(buf, 0, st.size, 0)
    return bytesRead === st.size ? buf : null
  } catch {
    return null
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function readLocal(hero: Upload, dirs: string[], maxBytes: number): Promise<Buffer | null> {
  if (typeof hero.filename !== 'string') return null
  // Only the base name: a stored filename can never reach outside the folder.
  const name = path.basename(hero.filename)
  if (name === '' || name === '.' || name === '..') return null
  for (const dir of dirs) {
    const bytes = await readLocalIn(dir, name, maxBytes)
    if (bytes) return bytes
  }
  return null
}
const readLocalIn = (dir: string, name: string, maxBytes: number) => readRegular(path.join(dir, name), maxBytes)

async function fetchRemote(hero: Upload, o: { hosts: Set<string>; fetchImpl: typeof fetch; maxBytes: number }): Promise<Buffer | null> {
  if (o.hosts.size === 0 || typeof hero.url !== 'string') return null
  let url: URL
  try {
    url = new URL(hero.url) // a relative url throws: it is never resolved against anything
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || !o.hosts.has(url.hostname)) return null
  try {
    // `redirect: 'error'`: a redirect would leave the allowlist.
    const res = await o.fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok || !res.body) return null
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > o.maxBytes) {
      await res.body.cancel().catch(() => undefined)
      return null
    }
    const chunks: Uint8Array[] = []
    let total = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > o.maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    return total === 0 ? null : Buffer.concat(chunks)
  } catch {
    return null
  }
}

const clamp = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback)

/** The image cut to the box around its focal point (the centre without one), as a palette PNG data URL; null if it is no usable raster image. */
async function prepare(
  bytes: Buffer,
  hero: Upload,
  box: { width: number; height: number },
  o: { maxPixels: number; background: string },
): Promise<string | null> {
  try {
    const input = { limitInputPixels: o.maxPixels, failOn: 'error' as const }
    // The header alone: format, size and EXIF orientation, no pixel decode.
    const meta = await sharp(bytes, input).metadata()
    if (!meta.format || !RASTER.has(meta.format)) return null
    // After `rotate()` the image is upright, so a quarter turn swaps the stored width and height.
    const turned = (meta.orientation ?? 1) >= 5
    const width = (turned ? meta.height : meta.width) ?? 0
    const height = (turned ? meta.width : meta.height) ?? 0
    if (!width || !height) return null
    const aspect = box.width / box.height
    const cropW = Math.min(width, Math.round(height * aspect))
    const cropH = Math.min(height, Math.round(cropW / aspect))
    if (cropW < 1 || cropH < 1) return null
    const at = (focus: number, size: number, crop: number) =>
      Math.round(Math.min(size - crop, Math.max(0, (focus / 100) * size - crop / 2)))
    const png = await sharp(bytes, input)
      .rotate()
      .extract({
        left: at(clamp(hero.focalX, 50), width, cropW),
        top: at(clamp(hero.focalY, 50), height, cropH),
        width: cropW,
        height: cropH,
      })
      .resize(box.width, box.height)
      .flatten({ background: o.background })
      .png({ palette: true })
      .toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * Prepares a card's hero: read from the upload folders (base name only; no symlink, FIFO, oversized or non-raster
 * file), or fetched from an allowlisted host (https, no redirect, bounded, 5 s). Any failure is null, and the card
 * is then drawn without it (and served as degraded, never stored).
 */
export function payloadHeroLoader(o: HeroLoaderOptions): HeroLoader {
  const maxBytes = posInt(o.maxBytes ?? 15 * 1024 * 1024, 'hero maxBytes')
  const maxPixels = posInt(o.maxPixels ?? 40_000_000, 'hero maxPixels')
  const hosts = new Set((o.allowedHosts ?? []).map((h) => h.toLowerCase()))
  const fetchImpl = o.fetchImpl ?? fetch
  const background = o.background ?? '#ffffff'
  return async (hero, box) => {
    try {
      if (![box.width, box.height].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE)) return null
      const bytes = (await readLocal(hero, await o.staticDirs(), maxBytes)) ?? (await fetchRemote(hero, { hosts, fetchImpl, maxBytes }))
      return bytes ? await prepare(bytes, hero, box, { maxPixels, background }) : null
    } catch {
      return null
    }
  }
}
