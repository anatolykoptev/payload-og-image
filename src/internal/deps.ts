/**
 * The two heavy dependencies, loaded on first use and cached for the life of the process. Nothing on the plugin or `/next` import path
 * may import `sharp` or `fontkit` statically: Payload loads the config on every start (the CLI included), and neither is needed until a
 * card is drawn or a font is read. A test pins this (test/plugin/bootBudget.spec.ts).
 */
/** A heavy dependency that could not be loaded (a missing native binary). Callers that turn every failure into "no hero" rethrow it, so it reaches `render_error` with the cause. */
export class DepLoadError extends Error {
  constructor(name: string, cause: unknown) {
    super(`payload-og-image: ${name} could not be loaded: ${String((cause as Error)?.message ?? cause)}`, { cause })
    this.name = 'DepLoadError'
  }
}

/** One load per process; a failed load is forgotten so the next draw retries it. The reset is attached once, where the promise is made. */
function once<T>(name: string, load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined
  return () => {
    if (!p) {
      const made = load().catch((e) => {
        if (p === made) p = undefined
        throw new DepLoadError(name, e)
      })
      p = made
    }
    return p
  }
}

export const loadSharp = once('sharp', () => import('sharp').then((m) => m.default))
export const loadFontkit = once('fontkit', () => import('fontkit'))
