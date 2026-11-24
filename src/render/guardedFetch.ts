import dns from 'node:dns'
import https from 'node:https'
import net from 'node:net'
import { Readable } from 'node:stream'

export type ResolvedAddress = { address: string; family: number }
export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>

/**
 * Everything that is not a globally reachable unicast address, derived from the IANA special-purpose registries:
 *   IPv4: https://www.iana.org/assignments/iana-ipv4-special-registry (RFC 6890 and updates)
 *   IPv6: https://www.iana.org/assignments/iana-ipv6-special-registry (RFC 6890, RFC 9637 and updates)
 * Whole blocks are refused even where the registry lists a globally reachable sub-range (2001::/23 holds a few): a card
 * image is never worth the exception.
 */
const blocked = new net.BlockList()
for (const [net4, bits] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared address space (CGNAT)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata lives here)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments (incl. 192.0.0.8/32 and 192.0.0.170/171)
  ['192.0.2.0', 24], // documentation
  ['192.31.196.0', 24], // AS112-v4
  ['192.52.193.0', 24], // AMT
  ['192.88.99.0', 24], // deprecated 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['192.175.48.0', 24], // direct delegation AS112
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and the limited broadcast 255.255.255.255
] as const) {
  blocked.addSubnet(net4, bits, 'ipv4')
}
for (const [net6, bits] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64 well-known prefix
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['100:0:0:1::', 64], // dummy IPv6 prefix
  ['2001::', 23], // IETF protocol assignments (Teredo 2001::/32, ORCHID, AMT, AS112 ... live here)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['3fff::', 20], // documentation (RFC 9637)
  ['5f00::', 16], // segment routing SIDs
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net6, bits, 'ipv6')
}
// ::ffff:0:0/96 (IPv4-mapped) is refused in isPublicAddress: Node's BlockList treats every IPv4 address as mapped, so it cannot be a subnet rule.

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
    // A dedicated agent: the global agents follow HTTPS_PROXY when NODE_USE_ENV_PROXY is set, and a proxy would resolve and
    // connect on its own, around the vetted address.
    const agent = new https.Agent({ keepAlive: false })
    const req = https.request(
      url,
      { method: 'GET', headers: { accept: 'image/*' }, lookup: pinnedLookup(resolve) as never, signal: init.signal, agent },
      (res) => {
        try {
          const status = res.statusCode ?? 0
          if (status >= 300 && status < 400) throw new Error('payload-og-image: a redirect answer is refused')
          const headers = new Headers()
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
          const nullBody = status === 204 || status === 205 || status === 304
          // `new Response` throws for a status outside 200-599 and for a header it cannot hold: that is a failed fetch, not a crash.
          ok(new Response(nullBody ? null : (Readable.toWeb(res) as ReadableStream), { status, headers }))
        } catch (error) {
          res.destroy()
          fail(error)
        }
      },
    )
    req.on('error', (e) => {
      agent.destroy()
      fail(e)
    })
    req.end()
  })
}
