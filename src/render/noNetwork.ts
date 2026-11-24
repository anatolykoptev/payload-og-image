import { AsyncLocalStorage } from 'node:async_hooks'

/** Set while a card is being drawn. Only code running inside `withoutNetwork` (and what it awaits) sees it. */
const drawing = new AsyncLocalStorage<{ refused: string[] }>()
/** The wrapper this module last put on `globalThis.fetch`. */
let installed: typeof fetch | undefined

const urlOf = (input: unknown): string => (input instanceof Request ? input.url : String(input))
/** A `data:` or `blob:` URL carries its bytes: no request leaves the process (the renderer reads its own WebAssembly this way). */
const isLocal = (url: string) => /^(data|blob):/i.test(url)
const hostOf = (url: string): string => {
  try {
    return new URL(url).host // never the path or query: a font request carries the text it is for
  } catch {
    return 'an unknown host'
  }
}

const refusal = (host: string) =>
  `payload-og-image: the renderer tried to fetch from ${host} while drawing a card; a render makes no network request (characters no registered font draws are removed before drawing)`

/**
 * Makes `globalThis.fetch` refuse every call made while a card is being drawn, and pass through every other call untouched.
 * It is installed over whatever `fetch` is current (a host app, or Next, may have replaced it since the last render) and not
 * swapped back afterwards: concurrent renders and the host's own requests would race a swap-and-restore.
 */
function install(): void {
  const inner = globalThis.fetch
  if (typeof inner !== 'function' || inner === installed) return
  const guarded = function guardedByPayloadOgImage(this: unknown, ...args: Parameters<typeof fetch>) {
    const scope = drawing.getStore()
    if (scope && !isLocal(urlOf(args[0]))) {
      const host = hostOf(urlOf(args[0]))
      scope.refused.push(host)
      return Promise.reject(new Error(refusal(host)))
    }
    return inner.apply(this, args)
  } as typeof fetch
  installed = guarded
  globalThis.fetch = guarded
}

/**
 * Runs `fn` with outbound `fetch` refused; if anything tried to fetch, it throws even when the renderer carried on without the response. `next/og` fetches a Noto font (the missing characters in the query) or a Twemoji image
 * from a CDN whenever a character is not in a registered face, and exposes no option to turn that off: this makes the render fail
 * closed instead of sending text off the host. Whatever `fn` starts is refused too, as the async context follows it.
 */
export async function withoutNetwork<T>(fn: () => Promise<T>): Promise<T> {
  install()
  const scope = { refused: [] as string[] }
  const out = await drawing.run(scope, fn)
  // `next/og` swallows a refused font download and draws without the glyphs: that is a card that is not what was asked for.
  if (scope.refused.length > 0) throw new Error(refusal(scope.refused[0] as string))
  return out
}
