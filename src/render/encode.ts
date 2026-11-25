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

/**
 * A lossy card from the renderer's PNG: any see-through pixel is flattened onto `ground` first (neither format is used with alpha
 * here: crawlers composite it on whatever they like), then JPEG by mozjpeg (progressive, trellis quantisation, an optimised scan
 * script) or WebP by libwebp (`smartSubsample` keeps chroma edges, the reason a coloured title on a photo does not bleed).
 * JPEG chroma stays 4:2:0, which is what browsers and crawlers expect.
 */
export async function encodeLossy(
  png: Uint8Array,
  { format, quality, ground }: { format: 'jpeg' | 'webp'; quality: number; ground: string },
): Promise<Uint8Array> {
  const flat = sharp(png).flatten({ background: ground })
  const out = await (format === 'jpeg'
    ? flat.jpeg({ quality, mozjpeg: true })
    : flat.webp({ quality, effort: WEBP_EFFORT, smartSubsample: true })
  ).toBuffer()
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
}

/** libwebp effort (0 to 6): 4 is sharp's default; each step up costs time for a few percent of bytes (measured, docs/reference.md). */
const WEBP_EFFORT = 4
