type Entry = { promise: Promise<Uint8Array>; settled: boolean; bytes: number }

export type Memo = {
  get(key: string, make: () => Promise<Uint8Array>): Promise<Uint8Array>
  delete(key: string): void
  readonly bytes: number
  readonly size: number
}

/**
 * Single-flight memory of rendered PNGs. A request for a card still being drawn joins the same render
 * (a crawler's HEAD-then-GET often asks twice at once). Bounded by bytes: past `maxBytes` the oldest SETTLED
 * entries go; a render in flight is never evicted, or the next request would draw it a second time.
 * A failed render is forgotten, so the next request tries again.
 */
export function createMemo({ maxBytes = 16 * 1024 * 1024 }: { maxBytes?: number } = {}): Memo {
  const entries = new Map<string, Entry>()
  let bytes = 0
  const evict = () => {
    for (const [k, e] of entries) {
      if (bytes <= maxBytes) return
      if (e.settled) {
        entries.delete(k)
        bytes -= e.bytes
      }
    }
  }
  return {
    get(key, make) {
      const hit = entries.get(key)
      if (hit) return hit.promise
      const entry: Entry = { promise: make(), settled: false, bytes: 0 }
      entries.set(key, entry)
      entry.promise.then(
        (b) => {
          if (entries.get(key) !== entry) return
          entry.settled = true
          entry.bytes = b.byteLength
          bytes += b.byteLength
          evict()
        },
        () => {
          if (entries.get(key) === entry) entries.delete(key)
        },
      )
      return entry.promise
    },
    delete(key) {
      const e = entries.get(key)
      if (e) {
        entries.delete(key)
        bytes -= e.bytes
      }
    },
    get bytes() {
      return bytes
    },
    get size() {
      return entries.size
    },
  }
}
