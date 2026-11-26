import { createHash } from 'node:crypto'
import { focalOf } from './crop.js'
import { PHOTO_SET, type PhotoName } from './photo.js'
import type { CardKey, VersionInput } from './types.js'
import { collectionOf, type VerifiedUpload } from './uploads.js'

export const VERSION_FORMAT = 1

/** Bumped when the bytes a transparent, unflattened hero draws change. 2: the alpha is kept (0.5.0); before, it was flattened onto white. */
export const HERO_ALPHA_REVISION = 2

const sha = (t: string) => createHash('sha256').update(t).digest('hex')

/**
 * JSON with object keys sorted deeply and `undefined`, function and symbol members dropped, so equal values hash equally.
 * Follows `JSON.stringify` where it matters: `toJSON(key)` is applied once per value (a `Date` has no own
 * enumerable keys and would otherwise hash as `{}`), and an array hole or `undefined` element is `null`.
 */
export function canonicalJson(value: unknown, key = ''): string {
  const v = hasToJson(value) ? value.toJSON(key) : value
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${Array.from(v, (el, i) => (omitted(el) ? 'null' : canonicalJson(el, String(i)))).join(',')}]`
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, member]) => !omitted(member))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, member]) => `${JSON.stringify(k)}:${canonicalJson(member, k)}`).join(',')}}`
}

/** Values `JSON.stringify` leaves out of an object (and writes as null in an array). */
const omitted = (v: unknown) => v === undefined || typeof v === 'function' || typeof v === 'symbol'

const hasToJson = (v: unknown): v is { toJSON(key: string): unknown } =>
  v !== null && typeof v === 'object' && typeof (v as { toJSON?: unknown }).toJSON === 'function'

const isPlain = (v: object) => {
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * Props are a defined model: string, finite number, boolean, null, array, plain object, and a Date (taken as
 * its ISO string). Anything else (Map, Set, class instances, functions, bigint, NaN/Infinity, cycles) throws,
 * naming the path, because it would hash alike (`{}`) or not at all. Object members that are `undefined` are
 * dropped and array holes become null. The result is what is both hashed and handed to the template.
 */
export function normalizeProps(value: unknown, path = 'props', seen: object[] = []): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`payload-og-image: ${path} is ${value}; props must be finite numbers`)
    return value
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`payload-og-image: ${path} is an invalid Date`)
    return value.toISOString()
  }
  if (typeof value !== 'object') throw new Error(`payload-og-image: ${path} is a ${typeof value}; props must be plain JSON`)
  if (seen.includes(value)) throw new Error(`payload-og-image: ${path} is a circular reference`)
  const next = [...seen, value]
  if (Array.isArray(value)) {
    return Array.from(value, (el, i) => (el === undefined ? null : normalizeProps(el, `${path}[${i}]`, next)))
  }
  if (!isPlain(value)) {
    const name = (value as object).constructor?.name ?? 'object'
    throw new Error(
      `payload-og-image: ${path} is a ${name}; props must be plain JSON (string, finite number, boolean, null, array, plain object, Date)`,
    )
  }
  const out: Record<string, unknown> = {}
  for (const [k, member] of Object.entries(value)) {
    // defineProperty, not assignment: an own "__proto__" key is data here, never a prototype swap.
    if (member !== undefined) {
      Object.defineProperty(out, k, {
        value: normalizeProps(member, `${path}.${k}`, next),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
  }
  return out
}

/** `id:updatedAt`. The id makes a replaced or deleted upload change the version, which `updatedAt` alone misses. */
export const heroTag = (h: VerifiedUpload) => `${String(h.id)}:${h.updatedAt ?? ''}`

const imagePaletteOf = (i: VersionInput) => ('imagePalette' in i ? i.imagePalette : i.heroPalette)

/**
 * `img:` and the canonical JSON of `[name, collection, [upload tags]]` entries sorted by name, plus the hero palette (named images are cut with it,
 * and are never flattened, so the plugin's `heroBackground` is no part of them). Undefined when no image resolved.
 */
function imageTail(i: VersionInput): string | undefined {
  const named = (i.images ?? []).filter((e) => e.uploads.length > 0)
  if (named.length === 0) return undefined
  const sorted = [...named].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  // The collection is in it: ids are only unique within one collection. One name can mix collections: its entry then lists each upload's own
  // (an image whose uploads all share the first one's collection hashes exactly as it always did).
  const entry = (e: (typeof sorted)[number]) => {
    const collections = e.uploads.map(collectionOf)
    const first = collections[0] as string
    return collections.every((c) => c === first)
      ? [e.name, first, e.uploads.map(heroTag)]
      : [e.name, first, e.uploads.map(heroTag), collections]
  }
  return `img:${canonicalJson(sorted.map(entry))}${imagePaletteOf(i) ? `|hp:${imagePaletteOf(i)}` : ''}`
}

// Slots 8-9 (locale, variant) are constants in 0.1 (`''`, `og`); the variant slot carries a JPEG card's encoding (0.6), and the default hashes identically. Slot 10 is the nonce: 0 or absent is the 0.1 value.
export const cardVersion = (i: VersionInput) => {
  const images = imageTail(i)
  return sha(
    canonicalJson([
      VERSION_FORMAT,
      i.templateId,
      i.templateRevision,
      i.props,
      i.heroes.map(
        (h) =>
          heroTag(h) +
          (i.heroBackground ? `|bg:${i.heroBackground}` : '') +
          // Only a transparent hero without a ground: every other hero draws the bytes it always did, so its URL does not move.
          (i.heroTransparent ? `|ha:${HERO_ALPHA_REVISION}` : '') +
          (i.heroPalette ? `|hp:${i.heroPalette}` : ''),
      ),
      i.fontsDigest,
      i.host,
      '',
      i.variant ?? 'og',
      i.nonce ?? 0,
      // Appended only when set: the default encoding hashes exactly as before, so no existing card URL moves.
      ...(i.cardPalette ? [`pal:${i.cardPalette}`] : []),
      // Likewise only when the card has named images, as one last element. The names are sorted; a name with no upload left is not in it.
      ...(images ? [images] : []),
    ]),
  ).slice(0, 12)
}

export const pageId = (k: CardKey) => sha(`${k.kind}\u0000${k.slug}`).slice(0, 16)

/**
 * The version of one photo-set image: everything its bytes come from and nothing else. The spec whole (ratios, cap, floor, revision), the size, the upload (its collection,
 * id and `updatedAt`), its recorded size, its focal point (clamped as the cropper clamps it, so moving the point moves the URL even where a window happens not to move), the
 * JPEG quality and the ground a see-through pixel is flattened onto. 12 hex characters, as the store keys.
 */
export const photoVersion = (i: {
  name: PhotoName
  upload: VerifiedUpload
  source: { width: number; height: number }
  quality: number
  ground: string
}) =>
  sha(
    canonicalJson([
      'photo',
      PHOTO_SET,
      i.name,
      collectionOf(i.upload),
      heroTag(i.upload),
      [i.source.width, i.source.height],
      focalOf(i.upload),
      i.quality,
      i.ground,
    ]),
  ).slice(0, 12)

/** The store key of one photo-set image: one page id per size, because the disk store keeps a few versions per page id and the three sizes must not evict each other. */
export const photoPageId = (k: CardKey, name: PhotoName) => pageId({ kind: `photo:${name}:${k.kind}`, slug: k.slug })
