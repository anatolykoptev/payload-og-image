/**
 * A brand that survives a bundler duplicating this module: Next may ship `gate.js` in more than one chunk, and then a `ShedError` thrown by
 * one copy is not an `instanceof` the class of another (a shed would answer as an internal error). Test with `isShedError`.
 */
const SHED = Symbol.for('payload-og-image.ShedError')

/** Thrown when the wait queue is full: the caller answers 503 with Retry-After. */
export class ShedError extends Error {
  readonly [SHED] = true
  constructor() {
    super('render queue full')
    this.name = 'ShedError'
  }
}

/** True for a `ShedError` of any copy of this module. */
export const isShedError = (e: unknown): e is ShedError =>
  typeof e === 'object' && e !== null && (e as Record<symbol, unknown>)[SHED] === true

export type Gate = {
  run<T>(job: () => Promise<T>): Promise<T>
  stats(): { active: number; waiting: number }
}

/**
 * Runs at most `concurrency` jobs at once; the rest wait, up to `queue` of them, and the next caller is shed.
 * A card render is CPU and memory heavy on a small box, and an unbounded crawl of cold URLs must not pile them up.
 */
export function createGate({ concurrency = 2, queue = 50 }: { concurrency?: number; queue?: number } = {}): Gate {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error('payload-og-image: gate concurrency must be an integer of at least 1')
  if (!Number.isInteger(queue) || queue < 0) throw new Error('payload-og-image: gate queue must be an integer of at least 0')
  let active = 0
  const waiting: (() => void)[] = []
  const release = () => {
    const next = waiting.shift()
    // The slot is handed over still counted as active, so the count never dips between jobs.
    if (next) next()
    else active -= 1
  }
  return {
    async run<T>(job: () => Promise<T>): Promise<T> {
      if (active >= concurrency) {
        if (waiting.length >= queue) throw new ShedError()
        await new Promise<void>((resolve) => waiting.push(resolve))
      } else {
        active += 1
      }
      try {
        return await job()
      } finally {
        release()
      }
    },
    stats: () => ({ active, waiting: waiting.length }),
  }
}
