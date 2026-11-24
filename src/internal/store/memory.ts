import type { CardStore } from '../types.js'

/** An in-process store bounded by bytes, oldest entries first. For tests and for sites that configure no directory. */
export function memoryStore({ maxBytes = 16 * 1024 * 1024 }: { maxBytes?: number } = {}): CardStore {
  const entries = new Map<string, Uint8Array>()
  let bytes = 0
  return {
    async get(pageId, v) {
      return entries.get(`${pageId}|${v}`) ?? null
    },
    async put(pageId, v, data) {
      const key = `${pageId}|${v}`
      const old = entries.get(key)
      if (old) bytes -= old.byteLength
      entries.delete(key)
      entries.set(key, data)
      bytes += data.byteLength
      for (const [k, e] of entries) {
        if (bytes <= maxBytes || k === key) break
        entries.delete(k)
        bytes -= e.byteLength
      }
    },
  }
}
