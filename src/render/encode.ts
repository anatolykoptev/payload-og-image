import type { Sharp } from 'sharp'
import { loadSharp } from '../internal/deps.js'
import type { ChromaSubsampling } from '../internal/format.js'
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
  const sharp = await loadSharp()
  const encoded = await sharp(png)
    .png({ colours: palette.colours, compressionLevel: 6, dither: palette.dither, effort: 1, palette: true })
    .toBuffer()
  return encoded.length < png.length ? new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength) : png
}

/**
 * The JPEG every card and photo is written as: a see-through pixel flattened onto `ground`, mozjpeg at `quality`, no metadata (sharp writes none unless asked,
 * so a phone photo's EXIF and GPS never ship). The one place these settings are written.
 */
export const toJpeg = (
  image: Sharp,
  { quality, ground, chromaSubsampling = '4:2:0' }: { quality: number; ground: string; chromaSubsampling?: ChromaSubsampling },
): Sharp => image.flatten({ background: ground }).jpeg({ quality, mozjpeg: true, chromaSubsampling })

/**
 * A lossy card from the renderer's PNG: any see-through pixel is flattened onto `ground` first (neither format is used with alpha
 * here: crawlers composite it on whatever they like), then JPEG by mozjpeg (progressive, trellis quantisation, an optimised scan
 * script) or WebP by libwebp (`smartSubsample` keeps chroma edges, the reason a coloured title on a photo does not bleed).
 * JPEG chroma is 4:2:0 unless the card asks for 4:4:4 (`jpeg.chromaSubsampling`): the photo set always keeps 4:2:0.
 */
export async function encodeLossy(
  png: Uint8Array,
  {
    format,
    quality,
    ground,
    chromaSubsampling,
  }: { format: 'jpeg' | 'webp'; quality: number; ground: string; chromaSubsampling?: ChromaSubsampling },
): Promise<Uint8Array> {
  const sharp = await loadSharp()
  const out = await (format === 'jpeg'
    ? toJpeg(sharp(png), { quality, ground, chromaSubsampling })
    : sharp(png).flatten({ background: ground }).webp({ quality, effort: WEBP_EFFORT, smartSubsample: true })
  ).toBuffer()
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
}

/** libwebp effort (0 to 6): 4 is sharp's default; each step up costs time for a few percent of bytes (measured, docs/reference.md). */
const WEBP_EFFORT = 4
