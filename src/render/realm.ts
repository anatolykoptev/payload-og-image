import { AsyncLocalStorage } from 'node:async_hooks'

/** Set while a card is being drawn. */
const drawing = new AsyncLocalStorage<true>()
/** The class this module last put on `globalThis.TextEncoder`. */
let installed: typeof TextEncoder | undefined

/**
 * `next/og` hands sharp `new TextEncoder().encode(svg)`, and sharp accepts a `Buffer` or an `instanceof Uint8Array` of the *global* `Uint8Array`.
 * A test environment that swaps that global for another realm's (vitest's jsdom) makes the encoder's bytes fail that check: "Unsupported input".
 * In a plain Node process the encoder's bytes pass and nothing is installed. Otherwise the global encoder is wrapped once: inside a draw it
 * returns a `Buffer` (sharp accepts one in any realm), outside a draw it behaves as before.
 */
function install(): void {
  const current = globalThis.TextEncoder
  if (typeof current !== 'function' || current === installed) return
  if (new current().encode('') instanceof Uint8Array) return
  const wrapped = class extends current {
    override encode(input?: string): Uint8Array<ArrayBuffer> {
      const bytes = super.encode(input)
      return drawing.getStore() ? (Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as Uint8Array<ArrayBuffer>) : bytes
    }
  }
  installed = wrapped
  globalThis.TextEncoder = wrapped
}

/** Runs `fn` (a draw) so that the bytes `next/og` encodes for sharp are accepted whatever realm the globals come from. */
export function inNodeRealm<T>(fn: () => Promise<T>): Promise<T> {
  install()
  return drawing.run(true, fn)
}
