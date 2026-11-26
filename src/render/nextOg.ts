import type { Renderer } from '../internal/handler.js'
import { MAX_SIDE } from '../internal/limits.js'
import { isWholeCard } from '../internal/store/validate.js'
import { assertPalette, DEFAULT_PALETTE, encodeLossy, encodePng, type Palette } from './encode.js'
import { withoutNetwork } from './noNetwork.js'

/**
 * Draws a card with `next/og` (satori + resvg), then keeps the smaller of the truecolour and palette PNGs, or flattens it into a mozjpeg JPEG or a libwebp WebP when the card asks for one.
 * `next/og` is imported lazily: plain Node ESM cannot resolve the bare `next/og` specifier (the file `next/og.js` resolves everywhere), so a module that
 * only mentions the renderer must not load it, and Next's bundler resolves the dynamic import normally.
 */
export function nextOgRenderer(o: { palette?: Palette | false } = {}): Renderer {
  const palette = o.palette === undefined ? DEFAULT_PALETTE : o.palette
  if (palette !== false) assertPalette(palette)
  return {
    async render(el, { width, height, fonts, encoding }) {
      if (![width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE)) {
        throw new Error(`payload-og-image: card size ${width}x${height} must be whole pixels from 1 to ${MAX_SIDE}`)
      }
      const { ImageResponse } = await import('next/og.js')
      // `next/og` fetches a font or an emoji image from a CDN for any character no registered face has, and has no option to refuse:
      // the draw runs with fetch refused. (Callers remove such characters first, so this is the backstop, not the path.)
      const png = await withoutNetwork(async () => {
        const res = new ImageResponse(el, {
          width,
          height,
          fonts: fonts.map((f) => ({ name: f.family, data: f.data, weight: f.weight as 400, style: f.style })),
        })
        if (!res.ok) throw new Error(`payload-og-image: next/og answered ${res.status}`)
        // A Buffer, not `new Uint8Array(...)`: `Buffer` is always the Node realm's, which sharp accepts.
        return Buffer.from(await res.arrayBuffer())
      })
      const format = encoding?.format ?? 'png'
      const out = encoding && encoding.format !== 'png' ? await encodeLossy(png, encoding) : await encodePng(png, palette)
      // Whatever leaves here may be cached as immutable: it must be a whole, decodable card of the format asked for.
      if (!(await isWholeCard(out, format))) throw new Error(`payload-og-image: the renderer produced an invalid ${format.toUpperCase()}`)
      return out
    },
  }
}
