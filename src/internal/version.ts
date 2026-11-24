import { createHash } from 'node:crypto'
import type { CardKey, Upload, VersionInput } from './types.js'

export const VERSION_FORMAT = 1

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

/** `id:updatedAt`. The id makes a replaced or deleted upload change the version, which `updatedAt` alone misses. */
export const heroTag = (h: Upload) => `${String(h.id)}:${h.updatedAt ?? ''}`

// Slots 8-10 (locale, variant, nonce) are constants in 0.1; 0.2 fills them, and the defaults hash identically.
export const cardVersion = (i: VersionInput) =>
  sha(
    canonicalJson([VERSION_FORMAT, i.templateId, i.templateRevision, i.props, i.heroes.map(heroTag), i.fontsDigest, i.host, '', 'og', 0]),
  ).slice(0, 12)

export const pageId = (k: CardKey) => sha(`${k.kind}\u0000${k.slug}`).slice(0, 16)
