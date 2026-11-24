// Builds the dev app, serves it with `next start` and probes a card the way a crawler and an editor meet it. The vitest
// suite calls the route modules in-process; what lives in the Next layer (HEAD, framing, route wiring, the page cache,
// Turbopack) is only seen over HTTP. Needs `pnpm build` first (the dev app imports the package by name), which
// `make preflight` has done. Run: `node scripts/probe-dev-server.mjs`. Exit 1 on the first failed assertion.
//
// Mutations that turn it RED (each checked by hand):
// - dev/app/(payload)/api/[...slug]/route.ts:17  `HEAD = GET` instead of `withHead(GET)` -> "HEAD an uploaded file: 200"
// - src/internal/handler.ts:383  `CACHE.immutable` for every version -> "GET a stale ?v: one hour"
// - dev/payload.config.ts:22  no `revalidatePost` hook, or `'max'` instead of `{ expire: 0 }` in dev/src/og/revalidate.ts:15 -> "the cached page advertises a new card after the edit"
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'og-probe-'))
const port = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address()
    s.close(() => resolve(port))
  })
})
const origin = `http://127.0.0.1:${port}`
const env = {
  ...process.env,
  DATABASE_URL: `file:${join(work, 'db.sqlite')}`,
  NEXT_PUBLIC_SERVER_URL: origin,
  PAYLOAD_CONFIG_PATH: 'dev/payload.config.ts',
  NEXT_TELEMETRY_DISABLED: '1',
}
const bin = (name) => join(root, 'node_modules', '.bin', name)
const CACHE = {
  immutable: 'public, max-age=31536000, immutable, no-transform',
  short: 'public, max-age=3600, no-transform',
}

let server
let log = ''
let stopping = false
const stop = () => {
  stopping = true
  server?.kill('SIGTERM')
  rmSync(work, { recursive: true, force: true })
}
const fail = (what) => {
  console.error(`probe-dev-server: FAIL: ${what}`)
  if (log) console.error(`--- server log (tail) ---\n${log.split('\n').slice(-25).join('\n')}`)
  stop()
  process.exit(1)
}
const ok = (what) => console.log(`ok   ${what}`)
const check = (cond, what) => (cond ? ok(what) : fail(what))
const eq = (got, want, what) => (got === want ? ok(what) : fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`))

const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8' })
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} exited ${r.status}\n${r.stdout}\n${r.stderr}`)
}
sh(bin('payload'), ['run', 'dev/seed.ts'])
sh(bin('next'), ['build', 'dev'])
server = spawn(bin('next'), ['start', 'dev', '-p', String(port), '-H', '127.0.0.1'], { cwd: root, env })
for (const s of [server.stdout, server.stderr]) s.on('data', (d) => (log += d))
server.on('exit', (code) => !stopping && fail(`next start exited ${code}`))
for (let i = 0; ; i++) {
  if (i > 100) fail('the server did not answer within 30 s')
  try {
    if ((await fetch(`${origin}/posts/plain`)).status === 200) break
  } catch {}
  await new Promise((r) => setTimeout(r, 300))
}

const SKIP = new Set(['date', 'x-og-cache', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'])
const headersOf = (res) => Object.fromEntries([...res.headers].filter(([k]) => !SKIP.has(k)))
const ogImage = async (path) => {
  const html = await (await fetch(`${origin}${path}`)).text()
  const m = /<meta property="og:image" content="([^"]+)"/.exec(html)
  if (!m) fail(`${path} advertises no og:image`)
  return m[1].replaceAll('&amp;', '&')
}

// 1. A page advertises a card, and the card is served the way a crawler needs it.
const card = await ogImage('/posts/plain')
const v = /\/og\/posts\/plain\/card\.png\?v=([0-9a-f]{12})$/.exec(card)?.[1]
check(card.startsWith(`${origin}/og/posts/plain/card.png?v=`) && v, `the page advertises an absolute card URL with a version (${card})`)
const get = await fetch(card)
const bytes = new Uint8Array(await get.arrayBuffer())
eq(get.status, 200, 'GET the current card: 200')
eq(get.headers.get('content-type'), 'image/png', 'GET: content-type image/png')
check(bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47, 'GET: the body is a PNG')
eq(get.headers.get('cache-control'), CACHE.immutable, 'GET the current version: immutable')
eq(get.headers.get('etag'), `"${v}"`, 'GET: etag is the advertised version')

// 2. HEAD is GET's twin, with no body.
const head = await fetch(card, { method: 'HEAD' })
eq(head.status, 200, 'HEAD the card: 200')
eq((await head.arrayBuffer()).byteLength, 0, 'HEAD: no body')
eq(JSON.stringify(headersOf(head)), JSON.stringify(headersOf(get)), 'HEAD: the same headers as GET (date, x-og-cache and framing aside)')

// 3. A stale version serves the current card for an hour, never immutable.
const stale = await fetch(`${origin}/og/posts/plain/card.png?v=000000000000`)
eq(stale.status, 200, 'GET a stale ?v: 200')
eq(stale.headers.get('cache-control'), CACHE.short, 'GET a stale ?v: one hour')
eq(stale.headers.get('etag'), `"${v}"`, 'GET a stale ?v: the current etag, so a cache can revalidate into the current card')
eq(Buffer.compare(Buffer.from(await stale.arrayBuffer()), Buffer.from(bytes)), 0, 'GET a stale ?v: the current bytes')

// 4. An unknown slug is a 404 nobody may cache.
const missing = await fetch(`${origin}/og/posts/no-such-post/card.png`)
eq(missing.status, 404, 'GET an unknown slug: 404')
eq(missing.headers.get('cache-control'), 'no-store', 'GET an unknown slug: no-store')

// 5. Payload REST answers HEAD for an uploaded file (payload#16754): LinkedIn HEADs an image first.
const registered = await (
  await fetch(`${origin}/api/users/first-register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'probe@example.test', password: 'probe-pass-123' }),
  })
).json()
const auth = { authorization: `JWT ${registered.token}` }
check(registered.token, 'an editor registered over REST')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const form = new FormData()
form.set('file', new Blob([png], { type: 'image/png' }), 'probe.png')
const upload = await fetch(`${origin}/api/media`, { method: 'POST', headers: auth, body: form })
eq(upload.status, 201, 'an upload was created over REST')
const file = `${origin}/api/media/file/${(await upload.json()).doc.filename}`
const fileGet = await fetch(file)
const fileHead = await fetch(file, { method: 'HEAD' })
eq(fileGet.status, 200, 'GET an uploaded file: 200')
eq(fileHead.status, 200, 'HEAD an uploaded file: 200 (Payload alone answers 404)')
eq(fileHead.headers.get('content-type'), fileGet.headers.get('content-type'), 'HEAD an uploaded file: the same content-type as GET')

// 6. A page Next keeps in its cache follows an edit, with no redeploy: the title, og:image and its version change together.
const first = await ogImage('/cached/cached')
const again = await fetch(`${origin}/cached/cached`)
eq(again.headers.get('x-nextjs-cache'), 'HIT', 'the cached page is served from Next cache before the edit')
const found = await (await fetch(`${origin}/api/posts?where[slug][equals]=cached`)).json()
const edited = await fetch(`${origin}/api/posts/${found.docs[0].id}`, {
  method: 'PATCH',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Cached post, edited', _status: 'published' }),
})
eq(edited.status, 200, 'the post was edited over REST')
const second = await ogImage('/cached/cached')
check(second !== first, `the cached page advertises a new card after the edit (${first.split('=')[1]} -> ${second.split('=')[1]})`)
const fresh = await fetch(second)
eq(fresh.status, 200, 'the new card URL is served')
eq(fresh.headers.get('cache-control'), CACHE.immutable, 'the new card URL is immutable')
check((await (await fetch(`${origin}/cached/cached`)).text()).includes('Cached post, edited'), 'the cached page shows the new title')

console.log('probe-dev-server: all checks passed')
stop()
