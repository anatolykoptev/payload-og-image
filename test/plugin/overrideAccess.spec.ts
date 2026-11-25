/** Mutation table (production line -> the test that goes RED), against a REAL Payload instance (SQLite). Silent-failure surface:
 * the Local API's `overrideAccess` default is `true` on Payload 3 and `false` on Payload 4, so a plugin call that leaves it out reads
 * with full access on one major and with the visitor's on the other, and nothing says so. Every Local API call the plugin makes must state it.
 * - payloadSource.ts:99   leave `overrideAccess: false` out of the upload read -> "the plugin states overrideAccess: false on every Local API call" RED
 * - endpoints.ts:122      leave it out of the preview's document read -> the same test RED
 * - payloadSource.ts:165  leave it out of related()'s base query -> the same test RED
 * - payloadSource.ts:116  call a Local API method this audit does not list (`payload.count`) -> "... only the calls the audit lists" RED */
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, getPayload, type Payload } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CUSTOM_KEY, type OgState } from '../../src/internal/state.js'
import { ogImagePlugin } from '../../src/plugin/index.js'
import { payloadSource } from '../../src/plugin/payloadSource.js'
import { defineTarget, defineTemplate } from '../../src/template.js'

const font = () => readFile(new URL('../fixtures/fonts/inter-latin-cyrillic-800.woff', import.meta.url))
const post = defineTemplate<{ title: string }>({
  id: 'post',
  revision: '1',
  textFields: ['title'],
  render: (p) => ({ type: 'div', props: { children: p.title } }) as never,
})

/** The Local API methods the plugin may call (`auth` takes no overrideAccess). The audit in the PR lists where each is called. */
const AUDITED = new Set(['find', 'findByID', 'auth'])
const LOCAL_API = new Set([
  'find', 'findByID', 'findGlobal', 'findVersions', 'findVersionByID', 'count', 'create', 'update', 'updateGlobal', 'delete',
  'duplicate', 'login', 'forgotPassword', 'resetPassword', 'verifyEmail', 'unlock', 'restoreVersion', 'auth',
]) // biome-ignore format: a list

let payload: Payload
let state: OgState
let spy: Payload
let token = ''
let user: any
const calls: Array<{ method: string; args: Record<string, unknown> | undefined }> = []
const ids: Record<string, number> = {}

beforeAll(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'og-oa-'))
  const config = await buildConfig({
    secret: 'test-secret-test-secret',
    serverURL: 'https://x.test',
    db: sqliteAdapter({ client: { url: `file:${path.join(dir, 'db.sqlite')}` } }),
    editor: lexicalEditor(),
    collections: [
      { slug: 'users', auth: true, fields: [] },
      { slug: 'media', access: { read: () => true }, upload: { staticDir: path.join(dir, 'media') }, fields: [] },
      {
        slug: 'notes',
        versions: { drafts: true },
        access: { read: () => true },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
          { name: 'image', type: 'upload', relationTo: 'media' },
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
          notes: defineTarget<any, any>({
            path: '/og/:kind/:slug/card.png',
            template: 'post',
            props: ({ doc }: any) => ({ title: doc.title ?? '' }),
          }),
        },
        seoImage: { path: 'image' },
        fields: { enabled: true },
        store: { memory: true },
      }),
    ],
  })
  payload = await getPayload({ config })
  state = payload.config.custom?.[CUSTOM_KEY] as OgState
  // A trusted seed: it states what it means, on either major.
  await payload.create({ collection: 'users', data: { email: 'ed@x.test', password: 'pw-pw-pw-pw' }, overrideAccess: true })
  const login = await payload.login({ collection: 'users', data: { email: 'ed@x.test', password: 'pw-pw-pw-pw' } })
  token = login.token as string
  user = login.user
  const bytes = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#abcdef' } })
    .png()
    .toBuffer()
  const media = await payload.create({
    collection: 'media',
    data: {},
    file: { data: bytes, mimetype: 'image/png', name: 'p.png', size: bytes.length },
    overrideAccess: true,
  })
  const note = await payload.create({
    collection: 'notes',
    data: { title: 'A note', slug: 'a-note', image: media.id, _status: 'published' },
    overrideAccess: true,
  })
  ids.note = note.id as number
  // A recording stand-in: the real Payload underneath, every Local API call noted with the arguments the plugin gave.
  spy = new Proxy(payload, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      if (typeof prop === 'string' && LOCAL_API.has(prop)) {
        return (...a: unknown[]) => {
          calls.push({ method: prop, args: a[0] as Record<string, unknown> | undefined })
          return value.apply(target, a)
        }
      }
      return value.bind(target)
    },
  })
}, 60_000)
afterAll(async () => {
  await payload?.db?.destroy?.()
})

const editorRequest = () => new Request('https://x.test/', { headers: { authorization: `JWT ${token}` } })

/** Drives every plugin path that reads through the Local API. */
async function drive() {
  calls.length = 0
  const source = payloadSource(spy, state, async () => ({ name: 'Site' }))
  // Published reads, with the editor's image read by id (the upload read).
  expect(await source.published('notes', 'a-note')).toMatchObject({ title: 'A note' })
  expect(await source.publishedById('notes', ids.note as number)).toMatchObject({ title: 'A note' })
  // An editor's draft read and a related read as an editor, then as a visitor.
  // Each must really reach the Local API: an editor who fails to authenticate would skip these reads and leave the count to the others.
  expect(await source.draft('notes', { slug: 'a-note' }, editorRequest())).toMatchObject({ title: 'A note' })
  expect(await source.related('notes', ids.note as number, { previewing: true, request: editorRequest() })).toMatchObject({
    title: 'A note',
  })
  expect(await source.related('notes', ids.note as number, { previewing: false })).toMatchObject({ title: 'A note' })
  // The preview endpoint's own read of the saved document.
  const endpoint = (payload.config.endpoints ?? []).find((x) => x.path === '/payload-og-image/preview' && x.method === 'post')
  const req = Object.assign(
    new Request('https://x.test/api/payload-og-image/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ collection: 'notes', id: ids.note, doc: { title: 'A note' } }),
    }),
    { user, payload: spy, context: {} },
  )
  expect((await endpoint?.handler(req as never))?.status).toBe(200)
}

describe('Local API calls the plugin makes', () => {
  it('the plugin makes only the calls the audit lists', async () => {
    await drive()
    const used = new Set(calls.map((c) => c.method))
    expect([...used].filter((m) => !AUDITED.has(m))).toEqual([])
    // ...and the audit is not stale: each listed data call is really exercised here.
    expect(used.has('find')).toBe(true)
    expect(used.has('findByID')).toBe(true)
  })
  it('the plugin states overrideAccess: false on every Local API call', async () => {
    await drive()
    const reads = calls.filter((c) => c.method !== 'auth')
    expect(reads.length).toBeGreaterThanOrEqual(6)
    const missing = reads.filter((c) => c.args?.overrideAccess !== false).map((c) => `${c.method} ${JSON.stringify(c.args?.collection)}`)
    expect(missing).toEqual([])
  })
})
