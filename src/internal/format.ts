// Pure card-format settings: no sharp, so the plugin entry (loaded by the Payload CLI) can validate the options.
import { DEFAULT_HERO_BACKGROUND } from './colour.js'

/** The encodings a card can leave in. PNG is the default and the only one before 0.6. */
export type CardFormat = 'png' | 'jpeg' | 'webp'
/** JPEG (mozjpeg) settings: `quality` from 1 to 100. */
export type JpegOptions = { quality?: number }
/** WebP (libwebp) settings: `quality` from 1 to 100. */
export type WebpOptions = { quality?: number }
/**
 * What a card is encoded as, once the plugin's and the target's options are resolved. JPEG and WebP cards are opaque: `ground` is the
 * colour a see-through pixel is flattened onto.
 */
export type CardEncoding = { format: 'png' } | { format: 'jpeg' | 'webp'; quality: number; ground: string }
export type CardMime = 'image/png' | 'image/jpeg' | 'image/webp'

/**
 * mozjpeg quality 82: a full-bleed 1200x630 photograph with a title on a scrim is about a quarter of the palette PNG (one sample
 * photograph) and stays under 100 KB, the size crawlers are happy with; the text edges show no ringing at this level (measured, docs/reference.md).
 */
export const DEFAULT_JPEG_QUALITY = 82
/** libwebp quality 80 (see docs/reference.md for the measured sizes against JPEG 82). */
export const DEFAULT_WEBP_QUALITY = 80

const FORMATS = ['png', 'jpeg', 'webp'] as const
const LOSSY = ['jpeg', 'webp'] as const
export const isLossy = (f: CardFormat): f is 'jpeg' | 'webp' => f !== 'png'
const DEFAULT_QUALITY = { jpeg: DEFAULT_JPEG_QUALITY, webp: DEFAULT_WEBP_QUALITY } as const

type FormatSettings = { format?: unknown; jpeg?: unknown; webp?: unknown }
type FormatFields = { format?: CardFormat; jpeg?: JpegOptions; webp?: WebpOptions }

/** `format`, `jpeg` and `webp` as given at the plugin, a target or a static card: a named error now, not at the first card. */
export function assertFormatOption(where: string, o: FormatSettings): void {
  if (o.format !== undefined && !(FORMATS as readonly unknown[]).includes(o.format))
    throw new Error(`payload-og-image: ${where}.format must be 'png', 'jpeg' or 'webp', got ${JSON.stringify(o.format)}`)
  for (const name of LOSSY) {
    const v = o[name]
    if (v === undefined) continue
    if (v === null || typeof v !== 'object' || Array.isArray(v))
      throw new Error(`payload-og-image: ${where}.${name} must be an object { quality? }`)
    for (const [k, q] of Object.entries(v)) {
      if (k !== 'quality') throw new Error(`payload-og-image: ${where}.${name}.${k} is not an option (${name}.quality)`)
      if (q !== undefined && !(typeof q === 'number' && Number.isInteger(q) && q >= 1 && q <= 100))
        throw new Error(`payload-og-image: ${where}.${name}.quality must be an integer from 1 to 100, got ${JSON.stringify(q)}`)
    }
  }
}

/** The format and quality of a card: the target's own setting, else the plugin's, else PNG (and the format's default quality). */
export function formatOf(plugin: FormatFields, own: FormatFields): { format: CardFormat; quality: number } {
  const format = own.format ?? plugin.format ?? 'png'
  const quality = isLossy(format) ? (own[format]?.quality ?? plugin[format]?.quality ?? DEFAULT_QUALITY[format]) : DEFAULT_JPEG_QUALITY
  return { format, quality }
}

const MIME: Record<CardFormat, CardMime> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
export const mimeOf = (format: CardFormat): CardMime => MIME[format]
export const extensionOf = (format: CardFormat) => (format === 'jpeg' ? 'jpg' : format)

/**
 * The version's variant slot: absent (the 0.1 value, `og`) for PNG so no existing card URL moves; for JPEG and WebP the format, the
 * quality and the ground, because each changes the bytes of the same drawing.
 */
export const variantOf = (e: CardEncoding): string | undefined => (e.format === 'png' ? undefined : `${e.format}:q${e.quality}:${e.ground}`)

/** A short key for a memo entry that must differ per encoding (the fallback card). */
export const encodingKey = (e: CardEncoding) => variantOf(e) ?? 'png'

/** The ground a transparent pixel of a lossy card is flattened onto: the card's own, else the plugin's, else white. */
export const groundOf = (card: string | undefined, plugin: string | undefined): string => card ?? plugin ?? DEFAULT_HERO_BACKGROUND

/** The encoding of a format with its quality and ground (PNG needs neither). */
export const encodingOf = (format: CardFormat, quality: number, ground: string): CardEncoding =>
  format === 'png' ? { format } : { format, quality, ground }

const PATH_EXT = /\.([A-Za-z0-9]+)$/
const EXTENSIONS: Record<CardFormat, string[]> = { png: ['png'], jpeg: ['jpg', 'jpeg'], webp: ['webp'] }
const ALL_EXTENSIONS = Object.values(EXTENSIONS).flat()
const NAME: Record<CardFormat, string> = { png: 'a PNG', jpeg: 'a JPEG', webp: 'a WebP' }

/**
 * The problem with a card path whose file extension names another image format, or undefined. A path without a recognised image
 * extension is the site's own business (crawlers go by `content-type`).
 */
export function pathProblem(pathname: string, format: CardFormat): string | undefined {
  const ext = PATH_EXT.exec(pathname)?.[1]?.toLowerCase()
  if (ext === undefined || !ALL_EXTENSIONS.includes(ext) || EXTENSIONS[format].includes(ext)) return undefined
  return `path "${pathname}" ends in .${ext} but the card is ${NAME[format]}: use a .${extensionOf(format)} path`
}
