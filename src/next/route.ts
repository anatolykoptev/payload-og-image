import type { SanitizedConfig } from 'payload'
import type { RouteContext } from '../internal/handler.js'
import { getRuntime } from '../internal/runtime.js'

/** An error as text, whatever it is: a thrown object whose `message` getter or `toString` throws must not turn a 503 into a crash. */
const describe = (error: unknown): string => {
  try {
    return String((error as Error)?.message ?? error)
  } catch {
    return 'unprintable error'
  }
}

/**
 * The card route's handler. Export `GET` and, explicitly, `HEAD = GET`: the card route answers HEAD itself, with
 * the same headers as GET and no body (Next drops the body). `target` pins a route to one target
 * (`createOgRoute({ config, target: 'posts' })`) so its params carry no `kind`.
 */
export function createOgRoute(o: { config: Promise<SanitizedConfig> | SanitizedConfig; target?: string }): {
  GET(r: Request, c: RouteContext): Promise<Response>
} {
  return {
    GET: async (r, c) => {
      let rt: Awaited<ReturnType<typeof getRuntime>> | undefined
      try {
        rt = await getRuntime(o.config)
        return await rt.handler(o.target).GET(r, c)
      } catch (error) {
        // The plugin missing, Payload failing to start, or a pinned target that is not configured: never an uncaught 500.
        const detail = { message: `route: ${describe(error)}` }
        if (rt) rt.emit({ name: 'render_error', detail })
        else console.warn(`[payload-og] event=render_error detail=${JSON.stringify(detail).replace(/[^\x20-\x7e]/g, '?')}`)
        return new Response('Service unavailable', { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '5' } })
      }
    },
  }
}
