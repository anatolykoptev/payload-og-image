import type { Memo } from './memo.js'
import type { CardFormat, CardStore, Upload } from './types.js'

/** What `stamp` needs of a generated card: its key and encoding, and the uploads it drew. */
export type DrawnCard = {
  pageId: string
  v: string
  encoding: { format: CardFormat }
  hero: Upload | null
  heroCollection: string | undefined
  images: ReadonlyArray<{ collection: string; uploads: ReadonlyArray<{ id: string | number; updatedAt?: string | null }> }>
}

/** Taken before a card is drawn. `current()` is false once any upload it drew has changed or gone since: its bytes must not be kept. */
export type Stamp = { current(): boolean }

export type UploadIndex = {
  /** Remember which uploads a served card drew, so a change to one can purge it, and return the stamp the card's write checks. `soleCollection` is where a hero is read from when the target names none. */
  stamp(card: DrawnCard, soleCollection?: string): Stamp
  /**
   * An upload changed or was deleted: drop every card that drew it from the memo and the store, and refuse the write of any card drawn from an
   * older state of it (one rendering right now, or one that read the upload before the change committed). `updatedAt` is the saved upload's;
   * pass it only for a change that is visible to the public (not a draft save). `deleted`: the upload is gone. Resolves to how many cards it
   * dropped; never throws. A card whose delete failed stays in the index for the next purge.
   */
  purge(collection: string, id: string | number, change?: { updatedAt?: string | null; deleted?: boolean }): Promise<number>
}

/**
 * Most uploads remembered, and most cards per upload: a bound on memory, least recently drawn first. A card or an upload past the bound is outside
 * the purge guarantee and falls back to the store's own pruning (the newest versions of a page are kept).
 */
const MAX_UPLOADS = 20_000
const MAX_CARDS_PER_UPLOAD = 64

const keyOf = (collection: string, id: string | number) => `${collection}\u0000${String(id)}`
const at = (t: string | null | undefined) => {
  const n = t ? Date.parse(t) : Number.NaN
  return Number.isNaN(n) ? undefined : n
}
type Card = { pageId: string; v: string; format: CardFormat }
type Mark = { generation: number; floor?: number; deleted?: boolean }

/**
 * Which stored cards drew which upload, in this process. A card version already changes whenever the upload does, so an old file is never served
 * for a current URL; what this removes is the old pixels at rest and in the memo once an upload changes or goes. The `afterChange` and
 * `afterDelete` hooks of every upload collection call `purge`.
 *
 * Two things keep a purge from being undone. A render in flight when the upload changes holds a stamp whose generation is now old, so its
 * write is refused (and removed if it already landed). A render that starts after the hook but before Payload commits the change reads the old
 * upload, whose `updatedAt` is older than the floor the hook recorded, so its write is refused too. The index is per process: a card drawn
 * before a restart, or by another process, is left to the store's pruning.
 */
export function createUploadIndex(d: { store: () => CardStore; memo: Memo; onError?: (message: string) => void }): UploadIndex {
  const drew = new Map<string, Map<string, Card>>()
  const marks = new Map<string, Mark>()
  const markOf = (key: string): Mark => marks.get(key) ?? { generation: 0 }
  const note = (key: string, c: DrawnCard) => {
    let cards = drew.get(key)
    if (cards)
      drew.delete(key) // reinserted below: the most recently drawn upload is the last to go
    else cards = new Map()
    const id = `${c.pageId}|${c.v}|${c.encoding.format}`
    cards.delete(id) // and the most recently drawn card the last of its upload
    cards.set(id, { pageId: c.pageId, v: c.v, format: c.encoding.format })
    if (cards.size > MAX_CARDS_PER_UPLOAD) cards.delete(cards.keys().next().value as string)
    drew.set(key, cards)
    if (drew.size > MAX_UPLOADS) drew.delete(drew.keys().next().value as string)
  }
  return {
    stamp(card, soleCollection) {
      const heroCollection = card.heroCollection ?? soleCollection
      const drawn: Array<{ key: string; updatedAt: number | undefined; generation: number }> = []
      const add = (collection: string, u: { id: string | number; updatedAt?: string | null }) => {
        const key = keyOf(collection, u.id)
        note(key, card)
        drawn.push({ key, updatedAt: at(u.updatedAt), generation: markOf(key).generation })
      }
      if (card.hero && heroCollection !== undefined) add(heroCollection, card.hero)
      for (const image of card.images) for (const u of image.uploads) add(image.collection, u)
      return {
        current: () =>
          drawn.every((u) => {
            const m = markOf(u.key)
            if (m.generation !== u.generation || m.deleted) return false
            return m.floor === undefined || (u.updatedAt !== undefined && u.updatedAt >= m.floor)
          }),
      }
    },
    async purge(collection, id, change = {}) {
      const key = keyOf(collection, id)
      const prior = markOf(key)
      const floor = at(change.updatedAt)
      marks.delete(key) // reinserted: marks are bounded like the index, least recently purged first
      marks.set(key, {
        generation: prior.generation + 1,
        floor: floor === undefined ? prior.floor : Math.max(floor, prior.floor ?? 0),
        ...(change.deleted || prior.deleted ? { deleted: true } : {}),
      })
      if (marks.size > MAX_UPLOADS) marks.delete(marks.keys().next().value as string)
      const cards = drew.get(key)
      if (!cards) return 0
      let dropped = 0
      const failed = new Map<string, Card>()
      for (const [cardKey, c] of cards) {
        d.memo.delete(`${c.pageId}|${c.v}`)
        try {
          await d.store().drop?.(c.pageId, c.v, c.format)
          dropped += 1
        } catch (error) {
          failed.set(cardKey, c)
          d.onError?.(`${c.pageId}-${c.v}: ${String((error as Error)?.message ?? error)}`)
        }
      }
      // Entries whose delete failed stay, merged with any card drawn meanwhile, so the next save of the upload tries again.
      const now = drew.get(key)
      if (now === cards) drew.delete(key)
      if (failed.size > 0) {
        const merged = drew.get(key) ?? new Map<string, Card>()
        for (const [k, c] of failed) if (!merged.has(k)) merged.set(k, c)
        drew.set(key, merged)
      }
      return dropped
    },
  }
}
