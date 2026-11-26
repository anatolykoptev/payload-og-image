import type { Memo } from './memo.js'
import type { CardFormat, CardStore, Upload } from './types.js'

/** What `record` needs of a generated card: its key and encoding, and the uploads it drew. */
export type DrawnCard = {
  pageId: string
  v: string
  encoding: { format: CardFormat }
  hero: Upload | null
  heroCollection: string | undefined
  images: ReadonlyArray<{ collection: string; uploads: ReadonlyArray<{ id: string | number }> }>
}

export type UploadIndex = {
  /** Remember which uploads a served card drew, so a change to one can purge it. `soleCollection` is where a hero is read from when the target names none. */
  record(card: DrawnCard, soleCollection?: string): void
  /** Drop every card that drew this upload from the memo and from the store. Resolves to how many it dropped; never throws. */
  purge(collection: string, id: string | number): Promise<number>
}

/** Most uploads remembered, and most cards per upload: a bound on memory, oldest first. A card past the bound is left to the store's own pruning. */
const MAX_UPLOADS = 20_000
const MAX_CARDS_PER_UPLOAD = 64

const keyOf = (collection: string, id: string | number) => `${collection}\u0000${String(id)}`

/**
 * Which stored cards drew which upload, in this process. A card version already changes whenever the upload does, so an old file is never served
 * for a current URL; what this removes is the old pixels at rest (the store keeps the newest versions of a page) and in the memo, once an
 * upload changes or goes: the `afterChange` and `afterDelete` hooks of every upload collection call `purge`. The index is per process: a card
 * drawn before a restart, or by another process, is left to the store's pruning.
 */
export function createUploadIndex(d: { store: () => CardStore; memo: Memo; onError?: (message: string) => void }): UploadIndex {
  const drew = new Map<string, Map<string, { pageId: string; v: string; format: CardFormat }>>()
  const note = (collection: string, id: string | number, c: DrawnCard) => {
    const key = keyOf(collection, id)
    let cards = drew.get(key)
    if (cards)
      drew.delete(key) // reinserted below: the most recently drawn upload is the last to go
    else cards = new Map()
    cards.set(`${c.pageId}|${c.v}|${c.encoding.format}`, { pageId: c.pageId, v: c.v, format: c.encoding.format })
    if (cards.size > MAX_CARDS_PER_UPLOAD) cards.delete(cards.keys().next().value as string)
    drew.set(key, cards)
    if (drew.size > MAX_UPLOADS) drew.delete(drew.keys().next().value as string)
  }
  return {
    record(card, soleCollection) {
      const heroCollection = card.heroCollection ?? soleCollection
      if (card.hero && heroCollection !== undefined) note(heroCollection, card.hero.id, card)
      for (const image of card.images) for (const u of image.uploads) note(image.collection, u.id, card)
    },
    async purge(collection, id) {
      const key = keyOf(collection, id)
      const cards = drew.get(key)
      if (!cards) return 0
      drew.delete(key)
      let dropped = 0
      for (const c of cards.values()) {
        d.memo.delete(`${c.pageId}|${c.v}`)
        try {
          await d.store().drop?.(c.pageId, c.v, c.format)
          dropped += 1
        } catch (error) {
          d.onError?.(String((error as Error)?.message ?? error))
        }
      }
      return dropped
    },
  }
}
