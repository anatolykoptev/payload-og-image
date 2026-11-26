// Pure card-format settings: no sharp, so the plugin entry (loaded by the Payload CLI) can validate the options.
import { DEFAULT_HERO_BACKGROUND } from './colour.js'

/** The encodings a card can leave in. PNG is the default and the only one before 0.6. */
export type CardFormat = 'png' | 'jpeg' | 'webp'
/** JPEG chroma subsampling: `'4:2:0'` (the default) halves the colour resolution both ways, `'4:4:4'` keeps it (no halo round coloured text, a larger file). */
export type ChromaSubsampling = '4:2:0' | '4:4:4'
/** JPEG (mozjpeg) settings: `quality` from 1 to 100; `chromaSubsampling` (default `'4:2:0'`). */
export type JpegOptions = { quality?: number; chromaSubsampling?: ChromaSubsampling }
/** WebP (libwebp) settings: `quality` from 1 to 100. */
export type WebpOptions = { quality?: number }
/**
 * What a card is encoded as, once the plugin's and the target's options are resolved. JPEG and WebP cards are opaque: `ground` is the
 * colour a see-through pixel is flattened onto.
 */
export type CardEncoding =
  | { format: 'png' }
  | { format: 'jpeg' | 'webp'; quality: number; ground: string /** JPEG only; absent is 4:2:0. */; chromaSubsampling?: ChromaSubsampling }
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
const CHROMA: readonly ChromaSubsampling[] = ['4:2:0', '4:4:4']
/** The option keys of each lossy format. */
const OPTION_KEYS = { jpeg: ['quality', 'chromaSubsampling'], webp: ['quality'] } as const
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
      throw new Error(`payload-og-image: ${where}.${name} must be an object { ${OPTION_KEYS[name].map((k) => `${k}?`).join(', ')} }`)
    for (const [k, q] of Object.entries(v)) {
      if (!(OPTION_KEYS[name] as readonly string[]).includes(k))
        throw new Error(
          `payload-og-image: ${where}.${name}.${k} is not an option (${OPTION_KEYS[name].map((o) => `${name}.${o}`).join(', ')})`,
        )
      if (k === 'chromaSubsampling') {
        if (q !== undefined && !(CHROMA as readonly unknown[]).includes(q))
          throw new Error(`payload-og-image: ${where}.${name}.chromaSubsampling must be '4:2:0' or '4:4:4', got ${JSON.stringify(q)}`)
      } else if (q !== undefined && !(typeof q === 'number' && Number.isInteger(q) && q >= 1 && q <= 100))
        throw new Error(`payload-og-image: ${where}.${name}.quality must be an integer from 1 to 100, got ${JSON.stringify(q)}`)
    }
  }
}

/**
 * The format and quality of a card: the target's own setting, else the plugin's, else PNG (and the format's default quality). `chromaSubsampling` is
 * set only for a JPEG asked for 4:4:4: 4:2:0, the default, stays absent so it hashes and encodes exactly as before.
 */
export function formatOf(plugin: FormatFields, own: FormatFields): { format: CardFormat; quality: number; chromaSubsampling?: '4:4:4' } {
  const format = own.format ?? plugin.format ?? 'png'
  const quality = isLossy(format) ? (own[format]?.quality ?? plugin[format]?.quality ?? DEFAULT_QUALITY[format]) : DEFAULT_JPEG_QUALITY
  const chroma = format === 'jpeg' ? (own.jpeg?.chromaSubsampling ?? plugin.jpeg?.chromaSubsampling) : undefined
  return chroma === '4:4:4' ? { format, quality, chromaSubsampling: chroma } : { format, quality }
}

const MIME: Record<CardFormat, CardMime> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
export const mimeOf = (format: CardFormat): CardMime => MIME[format]
export const extensionOf = (format: CardFormat) => (format === 'jpeg' ? 'jpg' : format)

/**
 * The version's variant slot: absent (the 0.1 value, `og`) for PNG so no existing card URL moves; for JPEG and WebP the format, the
 * quality and the ground, because each changes the bytes of the same drawing.
 */
export const variantOf = (e: CardEncoding): string | undefined =>
  e.format === 'png' ? undefined : `${e.format}:q${e.quality}:${e.ground}${e.chromaSubsampling === '4:4:4' ? ':c444' : ''}`

/** A short key for a memo entry that must differ per encoding (the fallback card). */
export const encodingKey = (e: CardEncoding) => variantOf(e) ?? 'png'

/** The ground a transparent pixel of a lossy card is flattened onto: the card's own, else the plugin's, else white. */
export const groundOf = (card: string | undefined, plugin: string | undefined): string => card ?? plugin ?? DEFAULT_HERO_BACKGROUND

/** The encoding of a format with its quality and ground (PNG needs neither) and, for a JPEG, 4:4:4 when asked. */
export const encodingOf = (format: CardFormat, quality: number, ground: string, chromaSubsampling?: '4:4:4'): CardEncoding =>
  format === 'png' ? { format } : chromaSubsampling ? { format, quality, ground, chromaSubsampling } : { format, quality, ground }

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

/**
 * The problem with a card path given every encoding its card can leave in, or undefined: ONE rule for a hand-written target, a preset's and a static card.
 * `:ext` stands for the extension of the card's format, so it must be the end of the file name (`card.:ext`) and nowhere else (a request for `/og/jpg/x/card`
 * could never be checked). A fixed path with no `:ext` serves one file, so every encoding its template can choose must be the one the path names.
 */
export function cardPathProblem(pathname: string, formats: CardFormat[]): string | undefined {
  if (/:ext\b/.test(pathname)) {
    const tail = pathname.slice(-5)
    if (tail !== '.:ext' || /:ext\b/.test(pathname.slice(0, -5)))
      return `path "${pathname}" must hold :ext only as the end of its file name (card.:ext)`
    return undefined
  }
  const distinct = [...new Set(formats)]
  if (distinct.length > 1)
    return `path "${pathname}" serves one file but its card can be ${distinct.join(' or ')}: end it in .:ext (card.:ext) or set a fixed \`format\``
  return distinct[0] === undefined ? undefined : pathProblem(pathname, distinct[0])
}
