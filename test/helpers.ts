import { readFile } from 'node:fs/promises'
import { loadFonts } from '../src/internal/fonts.js'

const file = (n: string) => () => readFile(new URL(`./fixtures/fonts/${n}`, import.meta.url))

let loaded: ReturnType<typeof loadFonts> | undefined
/** The OFL fixture faces (Archivo 600, Inter 800), loaded once per test file. */
export const loadTestFonts = () => {
  loaded ??= loadFonts([
    { family: 'Archivo', weight: 600, data: file('archivo-latin-600.woff') },
    { family: 'Inter', weight: 800, data: file('inter-latin-cyrillic-800.woff') },
  ])
  return loaded
}

import sharp from 'sharp'

/** A real, tiny PNG whose bytes depend on `text`, so two different cards never share bytes. */
export const realPng = async (text: string): Promise<Uint8Array> => {
  let h = 7
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const background = { r: h & 255, g: (h >> 8) & 255, b: (h >> 16) & 255 }
  return new Uint8Array(
    await sharp({ create: { width: 8, height: 8, channels: 3, background } })
      .png()
      .toBuffer(),
  )
}

/** A real, tiny card of `format` whose bytes depend on `text` (a PNG, a JPEG or a WebP: each passes its format's whole-file checks). */
export const realCard = async (text: string, format: 'png' | 'jpeg' | 'webp' = 'png', size = 16): Promise<Uint8Array> => {
  let h = 7
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const image = sharp({
    create: { width: size, height: size, channels: 3, background: { r: h & 255, g: (h >> 8) & 255, b: (h >> 16) & 255 } },
  })
  return new Uint8Array(
    await (format === 'png' ? image.png() : format === 'jpeg' ? image.jpeg({ mozjpeg: true }) : image.webp()).toBuffer(),
  )
}

/**
 * A `related()` that answers an upload by id from the fixtures: every object with an `id` and a `url` held, at any depth, by `pool` (a document, a list or a
 * map of them). What a hero or image resolves to is read again by id, never taken from the document, so a fixture's upload must be readable this way.
 */
export const relatedUploads = (pool: unknown) => async (_collection: string, id: string | number) => {
  const seen = new Set<unknown>()
  const find = (v: unknown): Record<string, any> | null => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return null
    seen.add(v)
    const o = v as Record<string, any>
    if (o.id !== undefined && typeof o.url === 'string' && String(o.id) === String(id)) return o
    for (const c of Object.values(o)) {
      const hit = find(c)
      if (hit) return hit
    }
    return null
  }
  return find(pool)
}

import { createUploadReader, VERIFIED, type VerifiedUpload } from '../src/internal/uploads.js'

/** An upload as the reader would have verified it from `collection`. For a test that feeds the version, the loader or the probe directly. */
export const verifiedUpload = <T extends Record<string, any>>(upload: T, collection = 'media'): VerifiedUpload & T =>
  Object.defineProperty({ ...upload }, VERIFIED, { value: collection, enumerable: false }) as VerifiedUpload & T

/** A source's batched `uploads` over a per-id `related`: what the visitor may read, by id. */
export const uploadsFrom =
  (related: (collection: string, id: string | number, ctx: any) => Promise<Record<string, any> | null>) =>
  async (collection: string, ids: string[], ctx?: any) =>
    new Map(
      (
        await Promise.all(
          ids.map(
            async (id) =>
              [
                id,
                await (ctx === undefined
                  ? (related as (c: string, i: string) => Promise<Record<string, any> | null>)(collection, id)
                  : related(collection, id, ctx)),
              ] as const,
          ),
        )
      ).flatMap(([id, doc]) => (doc ? [[id, doc] as const] : [])),
    ) as ReadonlyMap<string, Record<string, any>>

/** The request's upload reader over a per-id `related`: what the visitor may read, one call per id. */
export const uploadReaderOf = (related: Parameters<typeof uploadsFrom>[0] | undefined) =>
  createUploadReader(uploadsFrom(related ?? (async () => null)))
