import type { Renderer } from '../internal/handler.js'
import { MAX_SIDE } from '../internal/limits.js'
import { isCompletePng } from '../internal/store/png.js'
import { assertPalette, DEFAULT_PALETTE, encodePng, type Palette } from './encode.js'

/**
 * Draws a card with `next/og` (satori + resvg), then keeps the smaller of the truecolour and palette PNGs.
 * `next/og` is imported lazily: plain Node ESM cannot resolve the bare `next/og` specifier (the file `next/og.js` resolves everywhere), so a module that
 * only mentions the renderer must not load it, and Next's bundler resolves the dynamic import normally.
 */
export function nextOgRenderer(o: { palette?: Palette | false } = {}): Renderer {
  const palette = o.palette === undefined ? DEFAULT_PALETTE : o.palette
  if (palette !== false) assertPalette(palette)
  return {
    async render(el, { width, height, fonts }) {
      if (![width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE)) {
        throw new Error(`payload-og-image: card size ${width}x${height} must be whole pixels from 1 to ${MAX_SIDE}`)
      }
      const { ImageResponse } = await import('next/og.js')
      const res = new ImageResponse(el, {
        width,
        height,
        fonts: fonts.map((f) => ({ name: f.family, data: f.data, weight: f.weight as 400, style: f.style })),
      })
      if (!res.ok) throw new Error(`payload-og-image: next/og answered ${res.status}`)
      const out = await encodePng(new Uint8Array(await res.arrayBuffer()), palette)
      // Whatever leaves here may be cached as immutable: it must be a whole, decodable PNG.
      if (!isCompletePng(out)) throw new Error('payload-og-image: the renderer produced an invalid PNG')
      return out
    },
  }
}
