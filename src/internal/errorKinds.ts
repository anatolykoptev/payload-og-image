/**
 * Which errors are the library's own, remembered by identity rather than by a property an arbitrary thrown object could carry.
 * A bundler may ship a module in more than one chunk, and then `instanceof` fails across copies: so the registry lives on `globalThis`
 * under one string key and every copy of this module reads and writes the same `WeakMap`. Only code that calls `register` on a real
 * instance is trusted, so an object thrown by a site's own callback (an access function, a loader) is never taken for a shed or a
 * tool-input error, whatever properties it has.
 */
type Kind = 'shed' | 'input'
const KEY = '__payloadOgImageErrorKinds__'

const registry = (): WeakMap<object, Kind> => {
  const g = globalThis as Record<string, unknown>
  let found = g[KEY] as WeakMap<object, Kind> | undefined
  if (!(found instanceof WeakMap)) {
    found = new WeakMap()
    Object.defineProperty(g, KEY, { value: found, enumerable: false, writable: false, configurable: false })
  }
  return found
}

export const register = (e: Error, kind: Kind): void => void registry().set(e, kind)
export const isKind = (e: unknown, kind: Kind): boolean => typeof e === 'object' && e !== null && registry().get(e) === kind
