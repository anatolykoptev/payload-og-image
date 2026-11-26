import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { DepLoadError, loadSharp } from '../internal/deps.js'
import type { HeroLoader } from '../internal/handler.js'
import { MAX_SIDE } from '../internal/limits.js'
import { DEFAULT_HERO_COLOURS } from '../internal/palette.js'
import type { OnEvent, Upload } from '../internal/types.js'
import { heroTag } from '../internal/version.js'
import { guardedFetch, isPublicAddress, type ResolveHost, systemResolve } from './guardedFetch.js'
import { prepareShape } from './shape.js'
import { looksLikeSvg, looksRaster } from './sniff.js'

export type HeroLoaderOptions = {
  /**
   * The folders to read a hero file from, for the hero's own upload collection (`undefined` when the target names none).
   * A file is only ever read inside that collection's folder.
   */
  staticDirs: (collection?: string) => Promise<string[]>
  /** Hosts a hero may be fetched from, matched exactly against the parsed hostname. Default none: no fetch at render time. */
  allowedHosts?: string[]
  /**
   * Replaces the guarded fetch (a test seam). The default resolves the host itself, refuses any non-public address, pins the
   * connection to the vetted address and uses https on the default port only: an injected one gets none of that.
   */
  fetchImpl?: typeof fetch
  /** DNS resolution for the guarded fetch (a test seam; default the system resolver). */
  resolveHost?: ResolveHost
  /** Largest source file or download (default 15 MiB). */
  maxBytes?: number
  /** Largest source image in pixels (default 40 million); a bigger header is refused before any decode. */
  maxPixels?: number
  /** Hears why an SVG gave no PNG (`svg_rejected`, with `detail.reason`). Default: nothing. */
  onEvent?: OnEvent
  /** Colour a transparent image is flattened onto (sharp flattens before it scales). Unset: transparency is kept and the card shows through. */
  background?: string
  /** Colours the hero is cut to (2 to 256, default 256); `false` keeps truecolour. */
  colours?: false | number
}

const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0
const O_NONBLOCK = constants.O_NONBLOCK ?? 0
/** Raster formats only: an SVG never reaches sharp as received (librsvg may follow its references); `decode` vets and rasterises it first. */
const RASTER = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif'])
const FETCH_TIMEOUT_MS = 5000
/** A rasterised SVG whose alpha mean is at least this (of 255) counts as opaque. */
const SVG_OPAQUE_MEAN = 254

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

async function fetchRemote(
  hero: Upload,
  o: {
    hosts: Set<string>
    fetchImpl: typeof fetch | ((url: string, init: { signal?: AbortSignal; redirect?: string }) => Promise<Response>)
    maxBytes: number
  },
): Promise<Buffer | null> {
  if (o.hosts.size === 0 || typeof hero.url !== 'string') return null
  let url: URL
  try {
    url = new URL(hero.url) // a relative url throws: it is never resolved against anything
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || !o.hosts.has(url.hostname)) return null
  // The default port only, and an IP literal only when the operator allowlisted that exact address AND it is public.
  if (url.port !== '') return null
  const literal = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(literal) !== 0 && !isPublicAddress(literal)) return null
  try {
    // `redirect: 'error'`: a redirect would leave the allowlist.
    const res = await o.fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined) // an error body left open holds the connection until the timeout
      return null
    }
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

/** The size an SVG is drawn at, once per upload version: the pixel cap (`MAX_RENDER_PIXELS`) bounds it, and sharp scales that raster to each card's box. */
const SVG_COVER = { width: 1000, height: 1000 }
/** Rasterised SVGs remembered per upload version (the least recently used goes first): an SVG is drawn once per version per process. */
const SVG_CACHE = 16

/**
 * The bytes ready for the raster pipeline. A document that opens as SVG is vetted and drawn by `renderSvg` (never handed to sharp, which would
 * give it to librsvg); raster bytes pass as they are; anything else is nothing. `remember`: the answer is a property of the file (a drawing, or
 * a refusal by the sanitiser), not of this attempt (a timeout, a memory limit, a busy queue). `onReason` hears why an SVG gave no PNG.
 */
async function decode(
  source: Buffer,
  maxPixels: number,
  onReason: (reason: string) => void,
): Promise<{ bytes: Buffer | null; svg: boolean; remember: boolean }> {
  // The SVG test first: a document that merely contains the bytes of a raster signature is still an SVG, and must never reach sharp.
  if (looksLikeSvg(source)) {
    // The XML parser and the WebAssembly renderer load the first time an SVG is seen, never for a site that has none.
    const { renderSvg } = await import('./svg.js')
    const out = await renderSvg(source, SVG_COVER, maxPixels)
    if ('png' in out) return { bytes: out.png, svg: true, remember: true }
    onReason(out.reason)
    return { bytes: null, svg: true, remember: out.reason === 'refused' }
  }
  // Neither an SVG document nor a raster image: nothing is handed to a decoder (an SVG in an encoding the sanitiser cannot read included).
  return { bytes: looksRaster(source) ? source : null, svg: false, remember: false }
}

/** The image cut to the box around its focal point (the centre without one), as a palette PNG data URL; null if it is no usable raster image. */
async function prepare(
  bytes: Buffer,
  hero: Upload,
  box: { width: number; height: number },
  o: { maxPixels: number; background: string | undefined; colours: false | number },
): Promise<string | null> {
  // Outside the try: a sharp that cannot load (a missing native binary) is a render error that names it, not a silent hero-less card.
  const sharp = await loadSharp()
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
    const cut = sharp(bytes, input)
      .rotate()
      .extract({
        left: at(clamp(hero.focalX, 50), width, cropW),
        top: at(clamp(hero.focalY, 50), height, cropH),
        width: cropW,
        height: cropH,
      })
      .resize(box.width, box.height)
    // Flattened only when the site chose a ground (sharp flattens before it scales, whatever the chain order). Without one the alpha stays in the PNG, so the card
    // composites the hero as a direct `<img>` would (a flatten onto white first leaves a pale fringe on any other card colour).
    const png = await (o.background === undefined ? cut : cut.flatten({ background: o.background }))
      .png(o.colours === false ? {} : o.colours === DEFAULT_HERO_COLOURS ? { palette: true } : { palette: true, colours: o.colours })
      .toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

/** Whether any pixel of the image is see-through: a header check first, then a pixel pass only for an image that has an alpha channel. */
async function transparent(bytes: Buffer, maxPixels: number, fuzzy = false): Promise<boolean> {
  // Outside the try: a sharp that cannot load (a missing native binary) is a render error that names it, not a silent hero-less card.
  const sharp = await loadSharp()
  try {
    const input = { limitInputPixels: maxPixels, failOn: 'error' as const }
    const meta = await sharp(bytes, input).metadata()
    if (!meta.format || !RASTER.has(meta.format) || !meta.hasAlpha) return false
    const stats = await sharp(bytes, input).stats()
    if (!fuzzy) return !stats.isOpaque
    // A rasterised SVG has a soft edge (and seams) where a shape meets the border or another shape: the alpha MEAN tells a see-through logo
    // (a margin, a hole, a partial fill) from an opaque one with antialiasing (mean 254.8 of 255 for a solid rectangle).
    return (stats.channels.at(-1)?.mean ?? 255) < SVG_OPAQUE_MEAN
  } catch {
    return false
  }
}

/** Uploads whose transparency is remembered; the least recently asked is dropped past this. */
const ALPHA_CAP = 1000

/**
 * A question about an upload answered once and remembered: keyed (collection and tag), a bounded LRU, and concurrent askers share
 * one computation. An answer that says `keep: false` is not remembered (an unreadable file, so a fixed file is picked up; `readable`, so a lost file is noticed).
 * These run before the store lookup (a card's URL needs them) and from audits, so the steady state must cost nothing.
 */
function remembered<A extends unknown[]>(
  keyOf: (...a: A) => string,
  compute: (...a: A) => Promise<{ value: boolean; keep: boolean }>,
): (...a: A) => Promise<boolean> {
  const known = new Map<string, boolean>()
  const inflight = new Map<string, Promise<boolean>>()
  return (...a) => {
    const key = keyOf(...a)
    const seen = known.get(key)
    if (seen !== undefined) {
      known.delete(key) // most recently used last
      known.set(key, seen)
      return Promise.resolve(seen)
    }
    const running = inflight.get(key)
    if (running) return running
    const run = (async () => {
      try {
        const { value, keep } = await compute(...a)
        if (keep) {
          known.set(key, value)
          if (known.size > ALPHA_CAP) known.delete(known.keys().next().value as string)
        }
        return value
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, run)
    return run
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
  const resolveHost = o.resolveHost ?? systemResolve
  const fetchImpl = o.fetchImpl ?? ((url: string, init: { signal?: AbortSignal }) => guardedFetch(url, init, resolveHost))
  const background = o.background
  const colours = o.colours ?? DEFAULT_HERO_COLOURS
  const read = async (hero: Upload, where?: { collection?: string }) =>
    (await readLocal(hero, await o.staticDirs(where?.collection), maxBytes)) ?? (await fetchRemote(hero, { hosts, fetchImpl, maxBytes }))
  const keyOf = (hero: Upload, where?: { collection?: string }) => `${where?.collection ?? ''}\u0000${heroTag(hero)}`
  const svgs = new Map<string, Buffer | null>()
  type Ready = { bytes: Buffer | null; svg: boolean; unreadable: boolean; transient: boolean }
  const inflight = new Map<string, Promise<Ready>>()
  /**
   * The upload as the raster pipeline reads it, once per upload version however many cards ask at the same time (single-flight) and for the card and
   * the see-through probe alike. `svg`: it was rasterised (or refused as an SVG). A drawing, or the sanitiser's refusal, is remembered in `svgs` and a
   * repeat does not read the file; a failure of this attempt (`transient`) is not.
   */
  const rasterReady = (hero: Upload, where: { collection?: string } | undefined): Promise<Ready> => {
    const key = keyOf(hero, where)
    if (svgs.has(key)) {
      const hit = svgs.get(key) as Buffer | null
      svgs.delete(key) // most recently used last
      svgs.set(key, hit)
      return Promise.resolve({ bytes: hit, svg: true, unreadable: false, transient: false })
    }
    const running = inflight.get(key)
    if (running) return running
    const run = (async (): Promise<Ready> => {
      const source = await read(hero, where)
      if (!source) return { bytes: null, svg: false, unreadable: true, transient: false }
      const d = await decode(source, maxPixels, (reason) =>
        o.onEvent?.({ name: 'svg_rejected', detail: { reason, collection: where?.collection } }),
      )
      if (d.remember) {
        svgs.set(key, d.bytes)
        if (svgs.size > SVG_CACHE) svgs.delete(svgs.keys().next().value as string)
      }
      return { bytes: d.bytes, svg: d.svg, unreadable: false, transient: d.svg && !d.remember }
    })().finally(() => inflight.delete(key))
    inflight.set(key, run)
    return run
  }
  const load: HeroLoader = async (hero, box, where) => {
    try {
      if (![box.width, box.height].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE)) return null
      const { bytes } = await rasterReady(hero, where)
      if (!bytes) return null
      // A shaped image (contained, tinted, screened) is its own preparation; `''` is an image its shape declines, not a failure.
      if (where?.shape) return await prepareShape(bytes, box, where.shape, maxPixels)
      return await prepare(bytes, hero, box, {
        maxPixels,
        background: where?.keepAlpha ? undefined : (where?.background ?? background),
        colours: where?.colours !== undefined ? where.colours : colours,
      })
    } catch (error) {
      if (error instanceof DepLoadError) throw error // sharp itself is broken: a render error that names it, not a silent hero-less card
      return null
    }
  }
  load.readable = remembered(
    (hero, where) => keyOf(hero, where),
    async (hero, where) => {
      try {
        // Never remembered: a file deleted or corrupted after a `true` must show as unreadable, and `readable` only serves audits and `og_card` (not the hot path).
        return { value: (await read(hero, where)) !== null, keep: false }
      } catch {
        return { value: false, keep: false }
      }
    },
  )
  load.hasAlpha = remembered(
    (hero, where) => keyOf(hero, where),
    async (hero, where) => {
      try {
        // The same raster the card is cut from: an SVG is drawn once for both.
        const { bytes, svg, unreadable, transient } = await rasterReady(hero, where)
        // Unreadable, or an SVG that failed this time (a timeout, a limit): the card is drawn without it and never stored, so nothing is remembered.
        if (unreadable || transient) return { value: false, keep: false }
        return { value: bytes !== null && (await transparent(bytes, maxPixels, svg)), keep: true }
      } catch (error) {
        if (error instanceof DepLoadError) throw error
        return { value: false, keep: false }
      }
    },
  )
  return load
}
