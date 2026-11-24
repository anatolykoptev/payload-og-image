import dns from 'node:dns'
import https from 'node:https'
import net from 'node:net'
import { Readable } from 'node:stream'

export type ResolvedAddress = { address: string; family: number }
export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>

/** Everything that is not a public unicast address: loopback, private, link-local, CGNAT, ULA, multicast, documentation, mapped. */
const blocked = new net.BlockList()
for (const [net4, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net4, bits, 'ipv4')
}
for (const [net6, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64
  ['100::', 64],
  ['2001::', 32], // Teredo
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net6, bits, 'ipv6')
}

/** True for a public unicast IP literal; false for anything else, including garbage. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '')
  const family = net.isIP(bare)
  if (family === 0) return false
  // Normalise through the URL parser so `::ffff:127.0.0.1` and `::ffff:7f00:1` are one form.
  try {
    const host = new URL(`http://${family === 6 ? `[${bare}]` : bare}`).hostname.replace(/^\[|\]$/g, '')
    // An IPv4-mapped address would need its embedded address vetted, and no public host uses the form: refuse it. (Node's
    // BlockList treats every IPv4 address as mapped, so this cannot be a subnet rule.)
    if (family === 6 && host.startsWith('::ffff:')) return false
    return !blocked.check(host, family === 6 ? 'ipv6' : 'ipv4')
  } catch {
    return false
  }
}

export const systemResolve: ResolveHost = async (hostname) =>
  (await dns.promises.lookup(hostname, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family }))

/**
 * A `lookup` for `https.request` that resolves the name itself, drops every non-public address and hands the first
 * vetted one back. The socket then connects to THAT address, so a second DNS answer (rebinding) can never redirect it.
 * No vetted address means the connection is refused before any packet is sent.
 */
export function pinnedLookup(resolve: ResolveHost) {
  return (
    hostname: string,
    options: { all?: boolean },
    cb: (err: Error | null, address?: string | ResolvedAddress[], family?: number) => void,
  ) => {
    resolve(hostname).then(
      (all) => {
        const ok = all.filter((a) => isPublicAddress(a.address))
        if (ok.length === 0) return cb(new Error(`payload-og-image: ${hostname} resolves to no public address`))
        if (options?.all) return cb(null, ok)
        cb(null, (ok[0] as ResolvedAddress).address, (ok[0] as ResolvedAddress).family)
      },
      (error: Error) => cb(error),
    )
  }
}

/**
 * GET over https to the default port, to a vetted address only, with no redirect followed (a redirect answer is an error).
 * Returns a standard Response so callers read the body as a stream and cap it.
 */
export function guardedFetch(url: string, init: { signal?: AbortSignal }, resolve: ResolveHost = systemResolve): Promise<Response> {
  return new Promise((ok, fail) => {
    const req = https.request(
      url,
      { method: 'GET', headers: { accept: 'image/*' }, lookup: pinnedLookup(resolve) as never, signal: init.signal },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400) {
          res.destroy()
          return fail(new Error('payload-og-image: a redirect answer is refused'))
        }
        const headers = new Headers()
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
        const nullBody = status === 204 || status === 205 || status === 304
        ok(new Response(nullBody ? null : (Readable.toWeb(res) as ReadableStream), { status, headers }))
      },
    )
    req.on('error', fail)
    req.end()
  })
}
