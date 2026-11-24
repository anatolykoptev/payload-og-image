export type ShareImage = { url: string; width: number; height: number; type: string; alt?: string }

type File = { url?: unknown; width?: unknown; height?: unknown; mimeType?: unknown }

const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
/** X's large card takes these and no SVG; a crawler also needs the size on record to show the picture at all. */
const SHAREABLE = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])

const eligible = (file: unknown): file is { url: string; width: number; height: number; mimeType: string } => {
  if (!file || typeof file !== 'object') return false
  const f = file as File
  return filled(f.url) && positive(f.width) && positive(f.height) && filled(f.mimeType) && SHAREABLE.has(f.mimeType.toLowerCase())
}

function absolute(path: string, serverUrl: string): string {
  if (/^https?:\/\//i.test(path)) return path
  if (path.startsWith('//')) return `https:${path}`
  return `${serverUrl.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`
}

/**
 * An upload as a share image, with the width, height and type of the file it links and the editor's alt:
 * its `og` rendition when that one is eligible, else the original file when that one is. An upload with
 * neither (no URL, no size on record, an SVG) is no share image: the page gets its generated card instead.
 */
export function shareImageOf(upload: unknown, serverUrl: string): ShareImage | undefined {
  if (!upload || typeof upload !== 'object') return undefined
  const image = upload as { alt?: unknown; sizes?: { og?: unknown } | null }
  const file = [image.sizes?.og, image].find(eligible)
  if (!file) return undefined
  const alt = typeof image.alt === 'string' ? image.alt.trim() : ''
  return { ...(alt ? { alt } : {}), height: file.height, type: file.mimeType, url: absolute(file.url, serverUrl), width: file.width }
}

/** The first candidate that is a usable share image: an empty, unpopulated or unsized one is skipped. */
export function firstShareImage(candidates: unknown[], serverUrl: string): ShareImage | undefined {
  for (const c of candidates) {
    const s = shareImageOf(c, serverUrl)
    if (s) return s
  }
  return undefined
}
