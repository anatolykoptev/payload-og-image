import type { OgEvent, OnEvent } from './types.js'

const HIT_SAMPLE = 100

function defaultSink(e: OgEvent, count: number): void {
  // Cache hits are the common case: log the first and then every 100th.
  if (e.name.startsWith('hit_') && count % HIT_SAMPLE !== 1) return
  const parts = [`event=${e.name}`]
  if (e.kind !== undefined) parts.push(`kind=${e.kind}`)
  if (e.slug !== undefined) parts.push(`slug=${e.slug}`)
  if (e.v !== undefined) parts.push(`v=${e.v}`)
  if (e.ms !== undefined) parts.push(`ms=${Math.round(e.ms)}`)
  if (e.bytes !== undefined) parts.push(`bytes=${e.bytes}`)
  if (e.detail !== undefined) parts.push(`detail=${JSON.stringify(e.detail)}`)
  console.warn(`[payload-og] ${parts.join(' ')}`)
}

const noop = () => undefined

/**
 * Calls a user's sink so that nothing it does can reach serving: a throw is swallowed, and so is the
 * rejection of an async sink (an unhandled rejection would otherwise take the process down).
 */
export function safeCall(sink: OnEvent, e: OgEvent): void {
  try {
    const out = sink(e) as unknown
    if (out && typeof (out as PromiseLike<unknown>).then === 'function') (out as Promise<unknown>).then(noop, noop)
  } catch {
    // observability must not break serving
  }
}

/**
 * The one place events leave the package. Counts every event by name; hands each to `onEvent`
 * (or to the default console sink). A throwing sink never fails a request.
 */
export function createEventSink(onEvent?: OnEvent): { emit: OnEvent; counters(): Record<string, number> } {
  const counts: Record<string, number> = {}
  return {
    emit(e) {
      const n = (counts[e.name] ?? 0) + 1
      counts[e.name] = n
      if (onEvent) safeCall(onEvent, e)
      else safeCall((ev) => defaultSink(ev, n), e)
    },
    counters: () => ({ ...counts }),
  }
}
