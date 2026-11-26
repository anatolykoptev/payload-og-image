import { type Field, flatFields, singleUpload } from './fields.js'
import type { Upload } from './types.js'

/**
 * Uploads have one identity and one reader.
 *
 * Whatever site code hands over (a populated object, a bare id, `{ id }`) is reduced to an `UploadKey`: the upload's collection and id. The
 * collection comes from the schema (the `relationTo` of the field the document held it in) or, where the schema cannot tell, from the target's
 * explicit `heroCollection` / `imageCollections`. Only the reader below turns a ref into a `VerifiedUpload`: a record read with the visitor's access
 * (published only; the editor's draft view in a preview) that carries the collection it was read from. Resolve, the version, the alpha probe, the
 * hero loader and the inspector accept nothing else, so no upload drawn on a card was ever just something a field held.
 */
export type UploadKey = { readonly collection: string; readonly id: string }

/** The collection a verified upload was read from. Not enumerable: it is no part of the record, never hashed, spread or serialised. */
export const VERIFIED: unique symbol = Symbol('payload-og-image.verifiedUpload')

export type VerifiedUpload = Upload & { readonly [VERIFIED]: string }

export const isVerified = (v: unknown): v is VerifiedUpload =>
  v !== null && typeof v === 'object' && typeof (v as { [VERIFIED]?: unknown })[VERIFIED] === 'string'

/** The collection a verified upload was read from. */
export const collectionOf = (u: VerifiedUpload): string => u[VERIFIED]

/**
 * Is this error a DEFINITE answer that there is no readable document? Payload throws `Forbidden` when the caller may not read a collection at all
 * and `NotFound` for a missing one; both are "no such readable record". Any other error (connection, timeout, adapter) is a failure of the read: it
 * says nothing about whether the record exists.
 */
export const isDefiniteAbsence = (error: unknown): boolean => {
  const e = error as { name?: string; status?: number } | null
  return e?.name === 'Forbidden' || e?.name === 'NotFound' || e?.status === 403 || e?.status === 404
}

/**
 * The ONE place a failed read is told from an empty answer: `absent` for a definite "no such readable record" (see `isDefiniteAbsence`), the error
 * itself for anything else. A caller never maps an arbitrary error to "absent": a card drawn from a read that failed would carry a version (and an
 * immutable cache header) for a card the data never produced.
 */
export async function orAbsent<T>(read: () => Promise<T>, absent: T): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (isDefiniteAbsence(error)) return absent
    throw error
  }
}

const keyOf = (r: UploadKey) => `${r.collection}\u0000${r.id}`

/** The id of an upload, whether the value is a populated object or the bare id. */
export const idOf = (v: unknown): string | undefined => {
  const id = v && typeof v === 'object' && 'id' in v ? (v as { id?: unknown }).id : v
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined
}

/**
 * The ref a value names: its id, in the collection a verified upload says it was read from, else `collection`. Undefined for a value with no id,
 * or with no collection to place it in.
 */
export function refOf(value: unknown, collection: string | undefined): UploadKey | undefined {
  const id = idOf(value)
  const from = (isVerified(value) ? collectionOf(value) : undefined) ?? collection
  return id === undefined || from === undefined ? undefined : { collection: from, id }
}

/**
 * Reads uploads of one collection by id with the caller's access: the records found, by id. An id that is missing, draft-only (for the public) or
 * not readable to this caller is absent from the answer.
 */
export type ReadUploads = (collection: string, ids: string[]) => Promise<ReadonlyMap<string, Record<string, any>>>

/** The request's reader: `load` answers a verified upload (or null) for each ref, in order. */
export type UploadReader = {
  load(refs: readonly UploadKey[]): Promise<Array<VerifiedUpload | null>>
}

/**
 * One reader per request. Every ref not yet asked for is read in ONE `id in` find per upload collection; a ref asked for before is answered from
 * what that read returned, so the same upload named twice (the hero, and the share image field it also sits in) costs nothing the second time.
 * Only a definite answer is "no upload" (`orAbsent`): a read that fails for any other reason rejects every `load` that asked for it, for the rest
 * of the request, so nothing is resolved from a partial read.
 */
export function createUploadReader(read: ReadUploads): UploadReader {
  const memo = new Map<string, Promise<VerifiedUpload | null>>()
  return {
    async load(refs) {
      const fresh = new Map<string, Map<string, UploadKey>>()
      for (const r of refs) {
        if (memo.has(keyOf(r))) continue
        let byId = fresh.get(r.collection)
        if (!byId) {
          byId = new Map()
          fresh.set(r.collection, byId)
        }
        byId.set(r.id, r)
      }
      for (const [collection, byId] of fresh) {
        const found = orAbsent(
          () => read(collection, [...byId.keys()]),
          new Map<string, Record<string, any>>() as ReadonlyMap<string, Record<string, any>>,
        )
        for (const [id, ref] of byId) {
          memo.set(
            keyOf(ref),
            found.then((docs) => verified(collection, docs.get(id))),
          )
        }
      }
      return Promise.all(refs.map((r) => memo.get(keyOf(r)) as Promise<VerifiedUpload | null>))
    },
  }
}

/** The record as a verified upload: a frozen copy (the source's own object is never marked), or null when the read found nothing with an id. */
function verified(collection: string, doc: Record<string, any> | undefined): VerifiedUpload | null {
  if (!doc || typeof doc !== 'object' || idOf(doc) === undefined) return null
  // Branded first, then frozen: a resolver that mutates the upload it was handed cannot change what is drawn or hashed.
  return Object.freeze(Object.defineProperty({ ...doc }, VERIFIED, { value: collection, enumerable: false })) as VerifiedUpload
}

/** One upload field of a collection: where it sits in a document, and the upload collection its schema says it points to. */
export type UploadField = { path: string[]; relationTo: string }

/**
 * The single-valued upload fields of a collection (top level, in groups, rows and tabs), with their upload collection. A `hasMany` upload stays a
 * list of bare ids: a resolver names the one a hero or named image takes. Access is the reader's business, so a field the public may not read is
 * still listed (an editor reads it).
 */
export const uploadFieldsOf = (fields: Field[] | undefined): UploadField[] =>
  flatFields(fields)
    .filter(singleUpload)
    .map((e) => ({ path: e.keys, relationTo: e.field.relationTo as string }))

/** `doc` with `value` at `path`: a copy of the objects along the path, so the document the source returned is never changed. */
function withValue(doc: Record<string, any>, path: string[], value: unknown): Record<string, any> {
  const [head, ...rest] = path as [string, ...string[]]
  if (rest.length === 0) return { ...doc, [head]: value }
  const inner = doc[head]
  if (inner === null || typeof inner !== 'object') return doc // the group is absent: no upload here
  return { ...doc, [head]: withValue(inner, rest, value) }
}

const valueAt = (doc: Record<string, any>, path: string[]): unknown => {
  let cur: unknown = doc
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/**
 * The document with its upload fields filled in, for a resolver: each field this card draws (`drawn`, dotted paths; undefined: all of them) is
 * read by id through the request's reader and put in place as a verified upload, or null when it cannot be read by this caller. A field the card
 * does not draw is reduced to its bare id and never read. A value that is already an object (a document assembled from an editor's form) is only
 * the id it names, so it is read afresh and never trusted; an object with no usable id is no upload.
 */
export async function fillUploads(
  reader: UploadReader,
  doc: Record<string, any>,
  fields: readonly UploadField[],
  drawn?: readonly string[],
): Promise<Record<string, any>> {
  const wanted: Array<{ field: UploadField; ref: UploadKey }> = []
  let out = doc
  for (const field of fields) {
    const raw = valueAt(doc, field.path)
    if (raw === undefined) continue
    const id = idOf(raw)
    if (id === undefined) {
      if (raw !== null) out = withValue(out, field.path, null) // an object with no usable id is no upload of ours
      continue
    }
    if (drawn && !drawn.includes(field.path.join('.'))) {
      out = withValue(out, field.path, typeof raw === 'object' ? (raw as { id: unknown }).id : raw) // not drawn by this target: never read, and never an object nobody verified
      continue
    }
    wanted.push({ field, ref: { collection: field.relationTo, id } })
  }
  const read = await reader.load(wanted.map((w) => w.ref))
  wanted.forEach((w, n) => {
    out = withValue(out, w.field.path, read[n])
  })
  return out
}
