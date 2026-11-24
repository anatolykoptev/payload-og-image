/**
 * HEAD for a route that only exports GET: runs the GET on a GET copy of the request, keeps its status and headers
 * and drops the body (cancelled unread).
 *
 * For Payload's `(payload)/api/[...slug]` route only: Payload's REST router looks endpoints up by method, so a
 * HEAD to any `/api/...` path (an uploaded file, say) answers 404, and link-preview crawlers HEAD an og:image
 * first. Remove it when Payload REST answers HEAD. The card route does not need it: `HEAD = GET` there.
 */
export const withHead =
  <C>(get: (r: Request, c: C) => Promise<Response> | Response) =>
  async (r: Request, c: C): Promise<Response> => {
    const res = await get(new Request(r.url, { headers: r.headers, method: 'GET', signal: r.signal }), c)
    await res.body?.cancel()
    return new Response(null, { headers: res.headers, status: res.status, statusText: res.statusText })
  }
