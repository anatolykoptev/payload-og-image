import sharp from 'sharp'
import { DEFAULT_PALETTE, type Palette } from '../internal/palette.js'

export { DEFAULT_PALETTE, type Palette }

export function assertPalette(p: Palette): void {
  if (!Number.isInteger(p.colours) || p.colours < 2 || p.colours > 256) {
    throw new Error(`payload-og-image: palette.colours must be an integer from 2 to 256, got ${p.colours}`)
  }
  if (!Number.isFinite(p.dither) || p.dither < 0 || p.dither > 1) {
    throw new Error(`payload-og-image: palette.dither must be a number from 0 to 1, got ${p.dither}`)
  }
}

/**
 * The smaller of the renderer's truecolour PNG and its palette re-encoding (a flat card shrinks to a fraction;
 * a photographic one may not, and then the original is kept). `palette: false` keeps the truecolour PNG as is.
 */
export async function encodePng(png: Uint8Array, palette: Palette | false): Promise<Uint8Array> {
  if (palette === false) return png
  assertPalette(palette)
  const encoded = await sharp(png)
    .png({ colours: palette.colours, compressionLevel: 6, dither: palette.dither, effort: 1, palette: true })
    .toBuffer()
  return encoded.length < png.length ? new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength) : png
}
