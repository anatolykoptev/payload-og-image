import { AsyncLocalStorage } from 'node:async_hooks'

/** Set while a card is being drawn. */
const drawing = new AsyncLocalStorage<true>()
/** Draws in flight that depend on the wrapper below, and the encoder that was global before any wrapper (this copy's or another's). */
let owners = 0
let original: typeof TextEncoder | undefined
let wrapper: typeof TextEncoder | undefined
/** Own, non-enumerable property of every wrapper: the encoder underneath all wrappers, so a copy of this module can see through another copy's. */
const UNDERLYING = '__payloadOgImageUnderlyingEncoder__'
const underlyingOf = (e: typeof TextEncoder): typeof TextEncoder | undefined =>
  Object.hasOwn(e, UNDERLYING) ? ((e as unknown as Record<string, typeof TextEncoder>)[UNDERLYING] as typeof TextEncoder) : undefined

/**
 * `next/og` hands sharp `new TextEncoder().encode(svg)`, and sharp accepts a `Buffer` or an `instanceof Uint8Array` of the *global* `Uint8Array`.
 * A test environment that swaps that global for another realm's (vitest's jsdom) makes the encoder's bytes fail that check: "Unsupported input".
 * In a plain Node process the encoder's bytes pass and nothing is installed. Otherwise the global encoder is wrapped for as long as a draw
 * needs it: inside a draw it returns a `Buffer` (sharp accepts one in any realm), outside it behaves as before. Overlapping draws share the
 * wrapper, and the last one out puts the underlying original back, but only while the global still is a wrapper (nothing foreign replaced it).
 * A second copy of this module (a bundle may duplicate it) sees through the first copy's wrapper to the same original, so interleaved draws of
 * two copies still end with the original restored.
 */
function acquire(): void {
  if (owners === 0) {
    const current = globalThis.TextEncoder
    if (typeof current !== 'function') return
    const underlying = underlyingOf(current) ?? current
    if (new underlying().encode('') instanceof Uint8Array) return
    original = underlying
    wrapper = class extends current {
      override encode(input?: string): Uint8Array<ArrayBuffer> {
        const bytes = super.encode(input)
        return drawing.getStore() ? (Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as Uint8Array<ArrayBuffer>) : bytes
      }
    }
    Object.defineProperty(wrapper, UNDERLYING, { value: underlying, enumerable: false })
    globalThis.TextEncoder = wrapper
  }
  if (wrapper) owners += 1
}

function release(): void {
  if (!wrapper) return
  owners -= 1
  if (owners > 0) return
  const now = globalThis.TextEncoder
  if (original && typeof now === 'function' && underlyingOf(now) !== undefined) globalThis.TextEncoder = original
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
