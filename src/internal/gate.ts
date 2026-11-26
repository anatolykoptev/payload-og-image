/** Thrown when the wait queue is full: the caller answers 503 with Retry-After. */
export class ShedError extends Error {
  constructor() {
    super('render queue full')
    this.name = 'ShedError'
  }
}

/**
 * True for a `ShedError` of THIS copy of the module, and for nothing else: not an object a site's callback threw, whatever properties it carries.
 * If a bundle ever duplicates this module, a shed from the other copy is not recognised and is reported as an ordinary error (logged, a generic
 * internal_error, no message): the safe side, never a trusted lookalike.
 */
export const isShedError = (e: unknown): e is ShedError => e instanceof ShedError

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
