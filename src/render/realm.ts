import { AsyncLocalStorage } from 'node:async_hooks'

/** Set while a card is being drawn. */
const drawing = new AsyncLocalStorage<true>()
/** Draws in flight that depend on the wrapper below, and the encoder that was global before it was installed. */
let owners = 0
let original: typeof TextEncoder | undefined
let wrapper: typeof TextEncoder | undefined

/**
 * `next/og` hands sharp `new TextEncoder().encode(svg)`, and sharp accepts a `Buffer` or an `instanceof Uint8Array` of the *global* `Uint8Array`.
 * A test environment that swaps that global for another realm's (vitest's jsdom) makes the encoder's bytes fail that check: "Unsupported input".
 * In a plain Node process the encoder's bytes pass and nothing is installed. Otherwise the global encoder is wrapped for as long as a draw
 * needs it: inside a draw it returns a `Buffer` (sharp accepts one in any realm), outside it behaves as before. Overlapping draws share the
 * wrapper, and the last one out puts the original back (only if nothing else has replaced the global meanwhile).
 */
function acquire(): void {
  if (owners === 0) {
    const current = globalThis.TextEncoder
    if (typeof current !== 'function' || new current().encode('') instanceof Uint8Array) return
    original = current
    wrapper = class extends current {
      override encode(input?: string): Uint8Array<ArrayBuffer> {
        const bytes = super.encode(input)
        return drawing.getStore() ? (Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as Uint8Array<ArrayBuffer>) : bytes
      }
    }
    globalThis.TextEncoder = wrapper
  }
  if (wrapper) owners += 1
}

function release(): void {
  if (!wrapper) return
  owners -= 1
  if (owners > 0) return
  if (globalThis.TextEncoder === wrapper && original) globalThis.TextEncoder = original
  wrapper = original = undefined
}

/** Runs `fn` (a draw) so that the bytes `next/og` encodes for sharp are accepted whatever realm the globals come from. */
export async function inNodeRealm<T>(fn: () => Promise<T>): Promise<T> {
  acquire()
  const mine = wrapper
  try {
    return await drawing.run(true, fn)
  } finally {
    if (mine) release()
  }
}
