// Prepares a named image by its `ImageShape`: contained and trimmed, tinted when it would vanish on its ground, declined when its shape is no mark.
// Everything is a pure function of the image's bytes and the template's shape, so the result is covered by the upload's identity (the version's
// image tail) and the template's revision. Nothing here is random.
import { loadSharp } from '../internal/deps.js'
import type { ImageShape } from '../template.js'

const RASTER = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif'])
/** A source larger than this is scaled down before any pixel is read: a logo needs no more. */
const WORK = 1000

type Raw = { data: Buffer; width: number; height: number }

const hexOf = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const n = Number.parseInt(f.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const linear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
/** WCAG relative luminance. */
const luminance = ([r, g, b]: number[]) => 0.2126 * linear(r as number) + 0.7152 * linear(g as number) + 0.0722 * linear(b as number)
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

async function upright(bytes: Buffer, maxPixels: number): Promise<Raw | null> {
  const sharp = await loadSharp()
  const input = { limitInputPixels: maxPixels, failOn: 'error' as const }
  const meta = await sharp(bytes, input).metadata()
  if (!meta.format || !RASTER.has(meta.format)) return null
  const { data, info } = await sharp(bytes, input)
    .rotate()
    .resize(WORK, WORK, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/** The colour the image sits on (the median of its four corners), or undefined when the corners disagree by more than 24 in any channel. */
function cornerGround(r: Raw): [number, number, number] | undefined {
  const at = (x: number, y: number) => {
    const i = (y * r.width + x) * 4
    return [r.data[i], r.data[i + 1], r.data[i + 2]] as number[]
  }
  const corners = [at(0, 0), at(r.width - 1, 0), at(0, r.height - 1), at(r.width - 1, r.height - 1)]
  for (let c = 0; c < 3; c++) {
    const v = corners.map((p) => p[c] as number)
    if (Math.max(...v) - Math.min(...v) > 24) return undefined
  }
  const median = (c: number) => {
    const v = corners.map((p) => p[c] as number).sort((a, b) => a - b)
    return ((v[1] as number) + (v[2] as number)) / 2
  }
  return [median(0), median(1), median(2)]
}

/** The silhouette as 0..1 per pixel: the alpha when the image has any, else the distance from the corner colour. Undefined: no uniform ground to cut it from. */
function maskOf(r: Raw): Float32Array | undefined {
  const n = r.width * r.height
  const out = new Float32Array(n)
  let alpha = false
  for (let i = 0; i < n; i++) if ((r.data[i * 4 + 3] as number) < 250) alpha = true
  if (alpha) {
    for (let i = 0; i < n; i++) out[i] = (r.data[i * 4 + 3] as number) / 255
    return out
  }
  const bg = cornerGround(r)
  if (!bg) return undefined
  for (let i = 0; i < n; i++) {
    const d = Math.hypot((r.data[i * 4] as number) - bg[0], (r.data[i * 4 + 1] as number) - bg[1], (r.data[i * 4 + 2] as number) - bg[2])
    out[i] = Math.min(1, Math.max(0, (d - 16) / 64))
  }
  return out
}

/** The box of pixels the silhouette occupies, or undefined for an empty one. */
function bounds(mask: Float32Array, w: number, h: number) {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if ((mask[y * w + x] as number) > 0.1) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  return x1 < 0 ? undefined : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

const png = async (r: Raw) =>
  (await loadSharp())(r.data, { raw: { width: r.width, height: r.height, channels: 4 } })
    .png()
    .toBuffer()
const url = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`

/**
 * The image contained in `box` (never cropped, at most as large as its aspect makes it), its margin trimmed first when asked, and its silhouette
 * filled with `fill` when most of its opaque pixels contrast less than `min`:1 with `ground`.
 */
async function contained(
  bytes: Buffer,
  box: { width: number; height: number },
  shape: ImageShape,
  maxPixels: number,
): Promise<string | null> {
  const r = await upright(bytes, maxPixels)
  if (!r) return null
  let src: Raw = r
  // For an opaque image on a uniform ground, the silhouette (the corner-distance mask) is what a tint fills: without it the tint would fill the whole rectangle.
  let keyed: Raw | undefined
  const mask = maskOf(r)
  const opaque = (() => {
    for (let i = 0; i < r.width * r.height; i++) if ((r.data[i * 4 + 3] as number) < 250) return false
    return true
  })()
  const b = mask && (shape.trim || shape.aspect || opaque) ? bounds(mask, r.width, r.height) : undefined
  if (b && shape.aspect && (b.w / b.h < shape.aspect[0] || b.w / b.h > shape.aspect[1])) return ''
  const crop = (from: Raw, alphaFrom?: Float32Array): Raw => {
    const data = Buffer.alloc((b as { w: number }).w * (b as { h: number }).h * 4)
    const bb = b as { x: number; y: number; w: number; h: number }
    for (let y = 0; y < bb.h; y++)
      for (let x = 0; x < bb.w; x++) {
        const si = ((bb.y + y) * from.width + bb.x + x) * 4
        const di = (y * bb.w + x) * 4
        data[di] = from.data[si] as number
        data[di + 1] = from.data[si + 1] as number
        data[di + 2] = from.data[si + 2] as number
        data[di + 3] = alphaFrom
          ? Math.round((alphaFrom[(bb.y + y) * from.width + bb.x + x] as number) * 255)
          : (from.data[si + 3] as number)
      }
    return { data, width: bb.w, height: bb.h }
  }
  // Without a silhouette to cut by (an opaque image on a patchy ground), the image is kept whole.
  if (b && shape.trim) src = crop(r)
  if (b && opaque && mask) keyed = crop(r, mask)
  if (shape.key && keyed) src = keyed
  const fit = async (from: Raw): Promise<Raw> => {
    const { data, info } = await (await loadSharp())(await png(from))
      .resize(box.width, box.height, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
  }
  let out = await fit(src)
  if (shape.contrast) {
    const ground = luminance(hexOf(shape.contrast.ground))
    const min = shape.contrast.min ?? 3
    let seen = 0
    let low = 0
    for (let i = 0; i < out.width * out.height; i++) {
      if ((out.data[i * 4 + 3] as number) < 128) continue
      seen++
      if (contrast(luminance([out.data[i * 4] as number, out.data[i * 4 + 1] as number, out.data[i * 4 + 2] as number]), ground) < min)
        low++
    }
    if (seen > 0 && low / seen >= 0.5) {
      out = keyed ? await fit(keyed) : out
      const [fr, fg, fb] = hexOf(shape.contrast.fill)
      for (let i = 0; i < out.width * out.height; i++) {
        out.data[i * 4] = fr
        out.data[i * 4 + 1] = fg
        out.data[i * 4 + 2] = fb
      }
    }
  }
  return url(await png(out))
}

/** A named image by its shape: a data URL, `''` for an image the shape declines, null when it cannot be prepared. */
export async function prepareShape(
  bytes: Buffer,
  box: { width: number; height: number },
  shape: ImageShape,
  maxPixels: number,
): Promise<string | null> {
  try {
    return await contained(bytes, box, shape, maxPixels)
  } catch {
    return null
  }
}
