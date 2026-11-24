import { createHash } from 'node:crypto'
import type { CardKey, Upload, VersionInput } from './types.js'

export const VERSION_FORMAT = 1

const sha = (t: string) => createHash('sha256').update(t).digest('hex')

/** JSON with object keys sorted deeply and `undefined` object members dropped, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  // A Date (or any value with toJSON) has no own enumerable keys; without this it would hash as `{}` and every date would collide.
  if (value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return canonicalJson((value as { toJSON(): unknown }).toJSON())
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/** `id:updatedAt`. The id makes a replaced or deleted upload change the version, which `updatedAt` alone misses. */
export const heroTag = (h: Upload) => `${String(h.id)}:${h.updatedAt ?? ''}`

// Slots 8-10 (locale, variant, nonce) are constants in 0.1; 0.2 fills them, and the defaults hash identically.
export const cardVersion = (i: VersionInput) =>
  sha(
    canonicalJson([VERSION_FORMAT, i.templateId, i.templateRevision, i.props, i.heroes.map(heroTag), i.fontsDigest, i.host, '', 'og', 0]),
  ).slice(0, 12)

export const pageId = (k: CardKey) => sha(`${k.kind}\u0000${k.slug}`).slice(0, 16)
