import type { SanitizedConfig } from 'payload'
import type { RouteContext } from '../internal/handler.js'
import { getRuntime } from '../internal/runtime.js'

/**
 * The card route's handler. Export `GET` and, explicitly, `HEAD = GET`: the card route answers HEAD itself, with
 * the same headers as GET and no body (Next drops the body). `target` pins a route to one target
 * (`createOgRoute({ config, target: 'posts' })`) so its params carry no `kind`.
 */
export function createOgRoute(o: { config: Promise<SanitizedConfig> | SanitizedConfig; target?: string }): {
  GET(r: Request, c: RouteContext): Promise<Response>
} {
  return {
    GET: async (r, c) => (await getRuntime(o.config)).handler(o.target).GET(r, c),
  }
}
