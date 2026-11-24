import type { SiteInfo } from './types.js'

/**
 * Memoises `load()` for `ttlMs` (default 60 s). A rejection is forgotten, not cached, and `invalidate()` also
 * discards a load that is still in flight, so a stale answer can never land after an invalidation.
 */
export function cachedSite(
  load: () => Promise<SiteInfo>,
  { ttlMs = 60_000 }: { ttlMs?: number } = {},
): { get(): Promise<SiteInfo>; invalidate(): void } {
  if (!Number.isFinite(ttlMs) || ttlMs < 0)
    throw new Error(`payload-og-image: site cache ttlMs must be a finite number of at least 0, got ${ttlMs}`)
  let entry: { promise: Promise<SiteInfo>; at: number } | undefined
  let generation = 0
  return {
    get() {
      if (entry && Date.now() - entry.at < ttlMs) return entry.promise
      const mine = generation
      const created = { promise: load(), at: Date.now() }
      entry = created
      created.promise.catch(() => {
        if (entry === created) entry = undefined
      })
      // An invalidation while this load was in flight: serve the caller, but cache nothing.
      created.promise.then(
        () => {
          if (mine !== generation && entry === created) entry = undefined
        },
        () => undefined,
      )
      return created.promise
    },
    invalidate() {
      generation += 1
      entry = undefined
    },
  }
}
