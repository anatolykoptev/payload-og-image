import sharp from 'sharp'

/**
 * SVG logos, rasterised safely. An SVG is a document that can name other resources (`<image href>`, `<use href="other.svg#x">`,
 * `url(...)` and `@import` in CSS), define entities (a billion-laughs expansion) and declare a size no memory holds, and librsvg
 * will follow some of that. So the document is never handed to it as received: `screenSvg` refuses anything that could reach outside
 * itself or cost more than a logo should, and returns the document it vetted; `rasteriseSvg` renders THAT, at a size capped in pixels.
 * Anything refused or unrenderable is `null`: no logo, never a crash, never a fetch.
 */

/** A logo is a few kilobytes; a megabyte is already an export with embedded art. */
const MAX_SVG_BYTES = 1024 * 1024
/** Elements in a logo: a few hundred paths at most. */
const MAX_ELEMENTS = 10_000
/** `<use>` clones: a few per logo; a nest of them multiplies (10 levels of 10 is 10^10 draws), so the count is capped as well as librsvg's own limit. */
const MAX_USE = 64
/** The most pixels one rasterisation produces (about 2800 x 2800). */
const MAX_RENDER_PIXELS = 8_000_000
/** A viewBox or size beyond this cannot be a logo (and overflows the renderer's 32-bit sizes well before 1e9). */
const MAX_COORD = 1_000_000

/** Elements that run code, embed another document or load a resource, or whose cost is not bounded by the pixel cap. */
const REFUSED_ELEMENT =
  /<\s*(?:[\w.-]+:)?(?:script|foreignObject|image|feImage|iframe|embed|object|audio|video|feTurbulence|feConvolveMatrix|feMorphology)\b/i
const ELEMENT = /<[A-Za-z]/g
/** An attribute named `href` under any namespace prefix (`xlink:href`, or a prefix bound to xlink by the document itself). */
const HREF = /(?:^|[\s"'])(?:[\w.-]+:)?href\s*=\s*(["'])(.*?)\1/gis
const CSS_URL = /url\(\s*(["']?)\s*([^)"']*)/gi
/** Character references are decoded by the parser, so one that is not one of the five predefined entities is refused outright. */
const ENTITY_REF = /&(?!(?:amp|lt|gt|quot|apos);|#\d+;|#x[\da-f]+;)/i
const ROOT = /^\s*(?:<\?xml\s[^>]*?\?>\s*)?(<(?:[\w.-]+:)?svg(?=[\s>/])[^>]*>)/i

const num = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*(?:px)?\s*$/i

/** Whether the root element's size is a plain, sane box: a missing size is left to the renderer, a hostile or degenerate one is refused. */
function sizeIsSane(root: string): boolean {
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'is').exec(root)?.[2]
  for (const name of ['width', 'height']) {
    const v = attr(name)
    if (v === undefined) continue
    // Percentages and units other than px are left to the renderer, which resolves them against the viewBox.
    if (num.test(v) && (Number.parseFloat(v) <= 0 || Number.parseFloat(v) > MAX_COORD)) return false
  }
  const box = attr('viewBox')
  if (box === undefined) return true
  const parts = box.trim().split(/[\s,]+/)
  if (parts.length !== 4) return false
  const n = parts.map(Number)
  return n.every((x) => Number.isFinite(x) && Math.abs(x) <= MAX_COORD) && (n[2] as number) > 0 && (n[3] as number) > 0
}

/**
 * The vetted document as UTF-8 bytes, or null when the input is no SVG this module renders: not UTF-8 text (a UTF-16 or other declared
 * encoding would hide the text from these checks), too large, entities or an internal DTD, a processing instruction other than the XML
 * declaration, a stylesheet or script, an element that loads or embeds something, a link that leaves the document, a CSS `url()` or
 * `@import` that leaves it, a backslash (CSS escapes spell `url(` in ways a scan cannot see), or too many elements.
 * Comments are dropped and CDATA is scanned as plain text, so a keyword split across either cannot slip past.
 */
export function screenSvg(bytes: Uint8Array): Buffer | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SVG_BYTES || bytes.includes(0)) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return null
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  text = text.replace(/<!--[\s\S]*?-->/g, '')
  if (text.includes('<!--')) return null
  // An external DTD reference with no internal subset is only ever dropped; a subset, an entity or any other declaration is refused.
  text = text.replace(/<!DOCTYPE\s[^>[]*>/i, '')
  if (/<!(?!\[CDATA\[)/i.test(text)) return null
  // Only the leading XML declaration, and only as UTF-8 (the checks below read the document as UTF-8 text).
  const decl = /^\s*<\?xml\s[^>]*?\?>/i.exec(text)
  if (decl && /encoding\s*=\s*["'](?!utf-8["'])/i.test(decl[0])) return null
  if (text.replace(decl?.[0] ?? '', '').includes('<?')) return null
  if (text.includes('\\') || ENTITY_REF.test(text) || /xml:base\s*=/i.test(text)) return null
  const flat = text.replace(/<!\[CDATA\[|\]\]>/g, '')
  if (REFUSED_ELEMENT.test(flat) || /@import|image(?:-set)?\s*\(/i.test(flat)) return null
  for (const m of flat.matchAll(HREF)) if (!(m[2] as string).trim().startsWith('#')) return null
  for (const m of flat.matchAll(CSS_URL)) if (!(m[2] as string).startsWith('#')) return null
  if ((flat.match(ELEMENT)?.length ?? 0) > MAX_ELEMENTS) return null
  if ((flat.match(/<\s*(?:[\w.-]+:)?use\b/gi)?.length ?? 0) > MAX_USE) return null
  const root = ROOT.exec(flat)?.[1]
  if (root === undefined || !sizeIsSane(root)) return null
  return Buffer.from(text, 'utf8')
}

/** Whether the bytes are text that opens an SVG document (after a BOM, whitespace, the XML declaration, comments and a DOCTYPE). Raster bytes are not. */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SVG_BYTES) return false
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1')
  return /^(?:\xef\xbb\xbf)?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?svg[\s>/]/i.test(
    head,
  )
}

/**
 * The SVG as a PNG (alpha kept), drawn at least `cover.width` x `cover.height` where the size cap allows (a vector scales up without
 * loss, so the later crop and scale start from enough pixels), or null. A declared size above `maxPixels` is refused, as a raster of that
 * size would be.
 */
export async function rasteriseSvg(bytes: Uint8Array, cover: { width: number; height: number }, maxPixels: number): Promise<Buffer | null> {
  const vetted = screenSvg(bytes)
  if (!vetted) return null
  try {
    const { width, height } = await sharp(vetted, { density: 72, limitInputPixels: maxPixels, failOn: 'error' }).metadata()
    if (!width || !height || width * height > maxPixels) return null
    const wanted = Math.max(cover.width / width, cover.height / height, 1 / Math.max(width, height))
    const scale = Math.min(wanted, Math.sqrt(MAX_RENDER_PIXELS / (width * height)))
    const density = Math.max(1, Math.min(100_000, Math.floor(72 * scale)))
    return await sharp(vetted, { density, limitInputPixels: MAX_RENDER_PIXELS, failOn: 'error' }).png({ compressionLevel: 1 }).toBuffer()
  } catch {
    return null
  }
}
