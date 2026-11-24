/** Mutation table (production line -> the test that goes RED), against a REAL Payload instance (SQLite). Silent-failure surface: an endpoint that tells a non-admin how the plugin is running.
 * - endpoints.ts  skip the `req.user` check -> "anonymous -> 403" RED
 * - endpoints.ts  skip the admin-collection check -> "a user of another auth collection -> 403" RED
 * - endpoints.ts  skip the `access.admin` check -> "an admin-collection user whose access.admin says no -> 403" RED
 * - endpoints.ts  expose more than the four named parts (a path, a config value) -> "the answer has exactly these keys" RED
 * - endpoints.ts  `cache-control` other than no-store -> "an admin gets the shape" RED
 * - endpoints.ts  read the counters from somewhere else than the event sink -> "after one rendered GET counters.render is 1" RED */
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, getPayload, type Payload } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildRuntime, setTestRuntime } from '../../src/internal/runtime.js'
import { CUSTOM_KEY, createState, type OgState } from '../../src/internal/state.js'
import { OG_EVENT_NAMES } from '../../src/internal/types.js'
import { statsEndpoint } from '../../src/plugin/endpoints.js'
import { ogImagePlugin } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'

const font = () => readFile(new URL('../fixtures/fonts/inter-latin-cyrillic-800.woff', import.meta.url))
const post = defineTemplate<{ title: string }>({
  id: 'post',
  revision: '1',
  textFields: ['title'],
  render: (p) => ({ type: 'div', props: { children: p.title } }) as never,
})
let payload: Payload
let state: OgState
const tokens: Record<string, string> = {}
const users: Record<string, any> = {}
const png = async () =>
  new Uint8Array(
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
      .png()
      .toBuffer(),
  )

beforeAll(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'og-stats-'))
  const config = await buildConfig({
    secret: 'test-secret-test-secret',
    serverURL: 'https://x.test',
    db: sqliteAdapter({ client: { url: `file:${path.join(dir, 'db.sqlite')}` } }),
    editor: lexicalEditor(),
    collections: [
      // `noadmin@x.test` is of the admin collection but the collection's own admin access refuses it.
      {
        slug: 'users',
        auth: true,
        access: { admin: ({ req: { user } }) => (user as { email?: string } | null)?.email !== 'noadmin@x.test' },
        fields: [],
      },
      { slug: 'customers', auth: true, fields: [] },
      {
        slug: 'posts',
        access: { read: () => true },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
        ],
      },
    ],
    plugins: [
      ogImagePlugin({
        site: async () => ({ name: 'Site' }),
        fonts: [{ family: 'Inter', weight: 800, data: font }],
        stacks: { default: ['Inter'] },
        templates: [post],
        targets: {
          posts: defineTarget<any, any>({
            path: '/og/:kind/:slug/card.png',
            template: 'post',
            props: ({ doc }: any) => ({ title: doc.title }),
          }),
        },
        store: { memory: true },
      }),
    ],
  })
  payload = await getPayload({ config })
  state = payload.config.custom?.[CUSTOM_KEY] as OgState
  for (const [coll, email] of [
    ['users', 'admin@x.test'],
    ['users', 'noadmin@x.test'],
    ['customers', 'cu@x.test'],
  ] as const) {
    await payload.create({ collection: coll, data: { email, password: 'pw-pw-pw-pw' } })
    const l = await payload.login({ collection: coll, data: { email, password: 'pw-pw-pw-pw' } })
    tokens[email] = l.token as string
    users[email] = l.user
  }
  await payload.create({ collection: 'posts', data: { title: 'Hello', slug: 'hello' } })
  setTestRuntime(buildRuntime(state, payload, { renderer: { render: png }, isDraftRequest: async () => false }))
}, 60_000)
afterAll(async () => {
  setTestRuntime(null)
  await payload?.db?.destroy?.()
})

const endpoint = () => {
  const e = (payload.config.endpoints ?? []).find((x) => x.path === '/payload-og-image/stats' && x.method === 'get')
  if (!e) throw new Error('the stats endpoint is not registered')
  return e
}
const get = (as: string | null) =>
  endpoint().handler({ user: as ? users[as] : null, payload, headers: new Headers(), context: {} } as never)

describe('GET /api/payload-og-image/stats', () => {
  it('anonymous -> 403', async () => {
    const r = await get(null)
    expect(r.status).toBe(403)
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
  it('a user of another auth collection -> 403', async () => expect((await get('cu@x.test')).status).toBe(403))
  it('an admin-collection user whose access.admin says no -> 403', async () => expect((await get('noadmin@x.test')).status).toBe(403))
  it('an admin gets the shape: every counter, the gate, the memo and the store', async () => {
    const r = await get('admin@x.test')
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('content-type')).toMatch(/application\/json/)
    const body = await r.json()
    expect(Object.keys(body).sort()).toEqual(['counters', 'gate', 'memo', 'store'])
    expect(Object.keys(body.counters).sort()).toEqual([...OG_EVENT_NAMES].sort())
    expect(Object.values(body.counters).every((n) => typeof n === 'number')).toBe(true)
    expect(body.gate).toEqual({ active: 0, waiting: 0 })
    expect(body.memo).toEqual({ size: 0, bytes: 0 })
    expect(body.store).toEqual({ kind: 'memory', enabled: true })
  })
  it('after one rendered GET counters.render is 1 and the memo holds it', async () => {
    const rt = buildRuntime(state, payload, { renderer: { render: png }, isDraftRequest: async () => false })
    const res = await rt
      .handler('posts')
      .GET(new Request('https://x.test/og/posts/hello/card.png'), { params: Promise.resolve({ slug: 'hello' }) })
    expect(res.status).toBe(200)
    const body = await (await get('admin@x.test')).json()
    expect(body.counters.render).toBe(1)
    expect(body.memo.size).toBe(1)
    expect(body.memo.bytes).toBeGreaterThan(0)
  })
  it('a disk store reports its kind and dir, and nothing else about the filesystem', async () => {
    const dir = path.join(os.tmpdir(), 'og-stats-disk')
    const s = createState(
      {
        site: () => ({ name: 'S' }),
        fonts: [],
        stacks: { default: [] },
        templates: [],
        targets: {},
        store: { dir },
      } as never,
      'https://x.test',
    )
    const fake = {
      user: { collection: 'users' },
      payload: { config: { admin: { user: 'users' } }, collections: { users: { config: { access: { admin: () => true } } } } },
    }
    const r = await statsEndpoint(s).handler(fake as never)
    const body = await r.json()
    expect(body.store).toEqual({ kind: 'disk', enabled: true, dir })
  })
})
