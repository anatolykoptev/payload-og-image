/** Mutation table (production line -> the test that goes RED), against a REAL Payload instance (SQLite). Silent-failure surface: an authed endpoint that renders draft text.
 * - endpoints.ts:56  skip the `req.user` check -> "1: no user -> 401" RED
 * - endpoints.ts:58  skip the editor-collection check -> "2: a user of a non-editor auth collection -> 403" RED (a customer who owns the doc)
 * - endpoints.ts:76  skip the target check -> "11: a collection that is not a target -> 404" RED
 * - endpoints.ts:93  skip the `findByID` access check (no 403 on a missing doc) -> "3: a doc the user may not read -> 403 (foreign doc)" RED
 * - endpoints.ts:88  `findByID` with overrideAccess: true -> "3: ..." RED
 * - endpoints.ts:99  skip the `access.create` check for a body with no id -> "10: no id: the collection create access decides" RED
 * - endpoints.ts:12  `cache-control` other than no-store -> "1", "4" and "a card that would be blank" RED
 * - endpoints.ts:35  restore `return o.id` for an upload-shaped value (an object id survives) -> "an upload-shaped value in the body is never trusted ..." RED
 * - payloadSource.ts:95  keep an object that has no usable id in populateUploads -> "populateUploads: an object with no usable id ..." RED
 * - endpoints.ts  read the body with req.json() / no byte cap -> "a chunked body with no length is capped too -> 413" RED
 * - endpoints.ts  list every missing character -> "hundreds of undrawable characters ..." RED
 * - endpoints.ts  let a throwing access.create propagate -> "a create access that throws is a 403" RED
 * - handler.ts  no placeholder slug -> "a new document with no slug yet still gets a preview" RED; resolve the card twice -> "the card is resolved once per preview" RED
 * - endpoints.ts  an {id, url, label} row treated as an upload (no second upload signal) -> "an {id, url} object is upload-shaped ..." RED (the links row)
 * - handler.ts  emit `render` for a preview draw -> "a preview draw emits no render event" RED
 * - endpoints.ts  `{id, url}` not upload-shaped -> "an {id, url} object is upload-shaped ..." RED
 * - handler.ts:281  render outside `d.gate` -> "8: the gate is full -> 503 with retry-after" RED
 * - handler.ts:277  resolve the doc as it is (not forced to `generated`) -> "6: mode off still shows the would-be generated card" RED
 * - handler.ts  touch the memo or the store from preview() -> "4: ... never touched" RED */
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, getPayload, type Payload } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGate } from '../../src/internal/gate.js'
import { buildRuntime, setTestRuntime } from '../../src/internal/runtime.js'
import { CUSTOM_KEY, type OgState } from '../../src/internal/state.js'
import type { CardStore } from '../../src/internal/types.js'
import { ogImagePlugin } from '../../src/plugin/index.js'
import { populateUploads } from '../../src/plugin/payloadSource.js'
import { defineTarget, defineTemplate } from '../../src/template.js'

const font = () => readFile(new URL('../fixtures/fonts/inter-latin-cyrillic-800.woff', import.meta.url))
const post = defineTemplate<{ title: string; label: string }>({
  id: 'post',
  revision: '1',
  required: (p) => !!p.title.trim(),
  textFields: ['title'],
  render: (p) => ({ type: 'div', props: { children: p.title } }) as never,
})

let payload: Payload
let state: OgState
const tokens: Record<string, string> = {}
const users: Record<string, any> = {}
const rendered: string[] = []
let release: (() => void) | undefined
let hold = false
const putSpy = vi.fn()
const getSpy = vi.fn()
const store: CardStore = {
  get: async (...a: unknown[]) => (getSpy(...a), null),
  put: async (...a: unknown[]) => void putSpy(...a),
} as never
const png = async () =>
  new Uint8Array(
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
      .png()
      .toBuffer(),
  )
const renderer = {
  render: async (el: unknown) => {
    rendered.push(JSON.stringify(el))
    if (hold) await new Promise<void>((r) => (release = r))
    return png()
  },
}
const ids: Record<string, number> = {}
const seenDocs: Record<string, any>[] = []
const heroSpy = vi.fn(async () => null)

beforeAll(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'og-prev-'))
  const config = await buildConfig({
    secret: 'test-secret-test-secret',
    serverURL: 'https://x.test',
    db: sqliteAdapter({ client: { url: `file:${path.join(dir, 'db.sqlite')}` } }),
    editor: lexicalEditor(),
    collections: [
      { slug: 'users', auth: true, fields: [] },
      { slug: 'customers', auth: true, fields: [] },
      { slug: 'media', access: { read: () => true }, upload: { staticDir: path.join(dir, 'media') }, fields: [] },
      {
        slug: 'notes',
        access: { read: () => true },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
        ],
      },
      {
        slug: 'posts',
        versions: { drafts: true },
        // Only the owner reads a post; only ed1 may create one.
        access: {
          read: ({ req: { user } }) => (user ? { ownerEmail: { equals: (user as { email: string }).email } } : false),
          create: ({ req: { user } }) => (user as { email?: string } | null)?.email === 'ed1@x.test',
        },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
          { name: 'ownerEmail', type: 'text' },
          { name: 'meta', type: 'group', fields: [{ name: 'image', type: 'upload', relationTo: 'media' }] },
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
            props: ({ doc, overrides }: any) => (seenDocs.push(doc), { title: overrides?.headline ?? doc.title ?? '', label: 'Blog' }),
            hero: ({ doc }: any) => doc.extra ?? doc.gallery?.[0],
          }),
        },
        seoImage: { path: 'meta.image' },
        fields: { enabled: true },
        store: { memory: true },
      }),
    ],
  })
  payload = await getPayload({ config })
  state = payload.config.custom?.[CUSTOM_KEY] as OgState
  for (const [coll, email] of [
    ['users', 'ed1@x.test'],
    ['users', 'ed2@x.test'],
    ['customers', 'cu@x.test'],
  ] as const) {
    await payload.create({ collection: coll, data: { email, password: 'pw-pw-pw-pw' } })
    const l = await payload.login({ collection: coll, data: { email, password: 'pw-pw-pw-pw' } })
    tokens[email] = l.token as string
    users[email] = l.user
  }
  const mk = async (slug: string, data: Record<string, unknown>) =>
    (
      (await payload.create({
        collection: 'posts',
        data: { slug, ownerEmail: 'ed1@x.test', _status: 'draft', ...data },
        overrideAccess: true,
      })) as any
    ).id
  ids.plain = await mk('plain', { title: 'Plain title' })
  ids.theirs = await mk('theirs', { title: 'Customer owned', ownerEmail: 'cu@x.test' })
  ids.off = await mk('off', { title: 'Off title', og: { mode: 'off' } })
  const svg = await payload.create({
    collection: 'media',
    data: {},
    file: {
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
      mimetype: 'image/svg+xml',
      name: 's.svg',
      size: 70,
    },
  })
  ids.custom = await mk('custom', { title: 'Custom title', og: { mode: 'custom' }, meta: { image: svg.id } })
  setTestRuntime(buildRuntime(state, payload, { renderer, store, heroLoader: heroSpy }))
}, 60_000)
afterAll(async () => {
  setTestRuntime(null)
  await payload?.db?.destroy?.()
})

const endpoint = () => {
  const e = (payload.config.endpoints ?? []).find((x) => x.path === '/payload-og-image/preview' && x.method === 'post')
  if (!e) throw new Error('the preview endpoint is not registered')
  return e
}
const call = (as: string | null, body: unknown, over: { raw?: BodyInit; chunked?: boolean } = {}) => {
  const init: RequestInit & { duplex?: 'half' } = {
    method: 'POST',
    headers: as ? { authorization: `JWT ${tokens[as]}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: over.raw ?? JSON.stringify(body),
  }
  if (over.raw instanceof ReadableStream) init.duplex = 'half'
  const req = Object.assign(new Request('https://x.test/api/payload-og-image/preview', init), {
    user: as ? users[as] : null,
    payload,
    context: {},
  })
  return endpoint().handler(req as never)
}
const warningsOf = (r: Response) => JSON.parse(r.headers.get('x-og-warnings') ?? 'null')

describe('POST /api/payload-og-image/preview', () => {
  beforeEach(() => heroSpy.mockClear())
  it('1: no user -> 401, nothing rendered', async () => {
    const before = rendered.length
    const r = await call(null, { collection: 'posts', id: ids.plain, doc: {} })
    expect(r.status).toBe(401)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(rendered.length).toBe(before)
  })
  it('2: a user of a non-editor auth collection -> 403', async () => {
    const r = await call('cu@x.test', { collection: 'posts', id: ids.plain, doc: {} })
    expect(r.status).toBe(403)
    // Even a document the customer could read through the collection's own access: drafts are for editors.
    expect((await call('cu@x.test', { collection: 'posts', id: ids.theirs, doc: {} })).status).toBe(403)
  })
  it('3: a doc the user may not read -> 403 (foreign doc), nothing rendered', async () => {
    const before = rendered.length
    const r = await call('ed2@x.test', { collection: 'posts', id: ids.plain, doc: { title: 'Stolen' } })
    expect(r.status).toBe(403)
    expect(rendered.length).toBe(before)
    expect((await call('ed2@x.test', { collection: 'posts', id: 99999, doc: {} })).status).toBe(403) // no such doc: same answer
  })
  it('4: a valid editor -> 200 PNG, no-store, and the memo and the store are never touched', async () => {
    const memoGet = vi.spyOn(state.memo, 'get')
    const r = await call('ed1@x.test', { collection: 'posts', id: ids.plain, doc: { title: 'Plain title' } })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/png')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(0)
    expect(warningsOf(r)).toEqual({
      missing: [],
      missingCount: 0,
      overBudget: false,
      customIneligible: false,
      customTooSmall: false,
      modeOff: false,
    })
    expect(memoGet).not.toHaveBeenCalled()
    expect(putSpy).not.toHaveBeenCalled()
    expect(getSpy).not.toHaveBeenCalled()
    memoGet.mockRestore()
  })
  it('the body is merged over the saved draft: an unsaved headline is drawn, the rest comes from the draft', async () => {
    rendered.length = 0
    await call('ed1@x.test', { collection: 'posts', id: ids.plain, doc: { og: { headline: 'Unsaved headline' } } })
    expect(rendered.at(-1)).toContain('Unsaved headline')
    rendered.length = 0
    await call('ed1@x.test', { collection: 'posts', id: ids.plain, doc: {} })
    expect(rendered.at(-1)).toContain('Plain title')
  })
  it('4b: a title with an emoji -> x-og-warnings.missing lists it (header is ASCII)', async () => {
    const r = await call('ed1@x.test', { collection: 'posts', id: ids.plain, doc: { title: 'Launch 🚀 day' } })
    expect(r.status).toBe(200)
    expect(warningsOf(r).missing).toEqual(['🚀'])
    expect(/^[\x20-\x7e]*$/.test(r.headers.get('x-og-warnings') ?? '')).toBe(true)
  })
  it('6: mode off still shows the would-be generated card, with modeOff: true', async () => {
    const r = await call('ed1@x.test', { collection: 'posts', id: ids.off, doc: {} })
    expect(r.status).toBe(200)
    expect(warningsOf(r).modeOff).toBe(true)
  })
  it('7: a custom SVG image -> customIneligible: true (a generated card is drawn)', async () => {
    const r = await call('ed1@x.test', { collection: 'posts', id: ids.custom, doc: {} })
    expect(r.status).toBe(200)
    expect(warningsOf(r).customIneligible).toBe(true)
  })
  it('10: no id: the collection create access decides', async () => {
    expect((await call('ed1@x.test', { collection: 'posts', doc: { title: 'New one', slug: 'new' } })).status).toBe(200)
    expect((await call('ed2@x.test', { collection: 'posts', doc: { title: 'New one', slug: 'new' } })).status).toBe(403)
  })
  it('11: a collection that is not a target -> 404; a malformed body -> 400; an oversize body -> 413', async () => {
    expect((await call('ed1@x.test', { collection: 'notes', doc: { title: 'x' } })).status).toBe(404)
    expect((await call('ed1@x.test', { collection: 'media', doc: {} })).status).toBe(404)
    expect((await call('ed1@x.test', { collection: 'nope', doc: {} })).status).toBe(404)
    expect((await call('ed1@x.test', { collection: 'posts', doc: 'x' })).status).toBe(400)
    expect((await call('ed1@x.test', { collection: 'posts', doc: [] })).status).toBe(400)
    expect((await call('ed1@x.test', { collection: { $ne: 1 }, doc: {} })).status).toBe(400)
    expect((await call('ed1@x.test', { collection: 'posts', id: { $ne: 1 }, doc: {} })).status).toBe(400)
    expect((await call('ed1@x.test', null)).status).toBe(400)
    expect((await call('ed1@x.test', { collection: 'posts', id: ids.plain, doc: { title: 'x'.repeat(300_000) } })).status).toBe(413)
    expect((await call('ed1@x.test', null, { raw: 'not json' })).status).toBe(400)
  })
  it('a card that would be blank -> 404 no-store (nothing to preview)', async () => {
    const r = await call('ed1@x.test', { collection: 'posts', id: ids.plain, doc: { title: '   ' } })
    expect(r.status).toBe(404)
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
  it('an upload-shaped value in the body is never trusted, at a known path or anywhere else: nothing is read from disk', async () => {
    const fake = { filename: 'secret.png', id: 1, url: '/x', mimeType: 'image/png' }
    const before = seenDocs.length
    const r = await call('ed1@x.test', {
      collection: 'posts',
      id: ids.plain,
      doc: {
        extra: { filename: 'x', id: fake, url: '/x', mimeType: 'image/png' }, // an id that is itself an object
        gallery: [{ filename: 'a', id: { filename: 'secret.png' } }, { url: '/y', mimeType: 'image/png', id: fake }, fake],
        meta: { image: { filename: 'y', id: { id: fake } } }, // a known upload path
        blocks: [{ blockType: 'b', image: { filename: 'z', id: fake } }],
      },
    })
    expect(r.status).toBe(200)
    const doc = seenDocs.slice(before).at(-1) as Record<string, any>
    expect(JSON.stringify(doc)).not.toContain('secret.png')
    expect(doc.extra).toBeUndefined()
    expect(doc.gallery.every((g: unknown) => g === undefined || g === null || typeof g === 'number')).toBe(true)
    expect(doc.meta.image ?? null).toBeNull()
    expect(heroSpy).not.toHaveBeenCalled()
  })
  it('populateUploads: an object with no usable id at a known upload path becomes null, never kept', async () => {
    const doc: Record<string, any> = { meta: { image: { filename: 'secret.png', id: { filename: 'secret.png' }, url: '/x' } } }
    await populateUploads(payload, 'posts', doc, users['ed1@x.test'])
    expect(doc.meta.image).toBeNull()
  })
  it('a new document with no slug yet still gets a preview (a placeholder slug, for drawing only)', async () => {
    const r = await call('ed1@x.test', { collection: 'posts', doc: { title: 'Brand new' } })
    expect(r.status).toBe(200)
    expect(putSpy).not.toHaveBeenCalled()
    expect(getSpy).not.toHaveBeenCalled()
    expect((await call('ed1@x.test', { collection: 'posts', doc: { title: 'Brand new', slug: '  ' } })).status).toBe(200)
  })
  it('a preview draw emits no render event (the counters stay about served cards)', async () => {
    const before = state.events.counters().render ?? 0
    expect((await call('ed1@x.test', { collection: 'posts', id: ids.plain, doc: {} })).status).toBe(200)
    expect(state.events.counters().render ?? 0).toBe(before)
  })
  it('the card is resolved once per preview whatever the mode (props() runs once)', async () => {
    for (const id of [ids.plain, ids.off, ids.custom]) {
      const before = seenDocs.length
      expect((await call('ed1@x.test', { collection: 'posts', id, doc: {} })).status).toBe(200)
      expect(seenDocs.length - before).toBe(1)
    }
  })
  it('an {id, url} object is upload-shaped (a plain id or nothing); a bare {url} such as a link is kept', async () => {
    const before = seenDocs.length
    await call('ed1@x.test', {
      collection: 'posts',
      id: ids.plain,
      doc: {
        extra: { id: 7, url: 'https://x.test/a.png', width: 10, height: 5 },
        other: { id: { id: 1 }, url: '/y', updatedAt: 'u' },
        links: [{ id: 3, url: 'https://example.com/a', label: 'A' }],
        link: { url: 'https://example.com/page', label: 'Go' },
      },
    })
    const doc = seenDocs.slice(before).at(-1) as Record<string, any>
    expect(doc.extra).toBe(7)
    expect(doc.other).toBeUndefined()
    expect(doc.links).toEqual([{ id: 3, url: 'https://example.com/a', label: 'A' }]) // an ordinary row with an id and a url is kept
    expect(doc.link).toEqual({ url: 'https://example.com/page', label: 'Go' })
  })
  it('an upload-shaped value with a plain id becomes that id (and the hero, an id, draws nothing)', async () => {
    const before = seenDocs.length
    await call('ed1@x.test', { collection: 'posts', id: ids.plain, doc: { extra: { filename: 'x', id: 5 } } })
    expect((seenDocs.slice(before).at(-1) as Record<string, any>).extra).toBe(5)
    expect(heroSpy).not.toHaveBeenCalled()
  })
  it('a chunked body with no length is capped too -> 413', async () => {
    let sent = 0
    const stream = new ReadableStream({
      pull(c) {
        if (sent++ >= 400) return c.close()
        c.enqueue(new TextEncoder().encode(`${'x'.repeat(1024)}`))
      },
    })
    const r = await call('ed1@x.test', null, { raw: stream })
    expect(r.status).toBe(413)
    expect(sent).toBeLessThan(400) // it stopped reading
  })
  it('hundreds of undrawable characters: the header lists 50 and counts the rest, and stays small', async () => {
    const title = `A ${Array.from({ length: 500 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('')}`
    const r = await call('ed1@x.test', { collection: 'posts', id: ids.plain, doc: { title } })
    expect(r.status).toBe(200)
    const w = warningsOf(r)
    expect(w.missing).toHaveLength(50)
    expect(w.missingCount).toBe(500)
    expect((r.headers.get('x-og-warnings') ?? '').length).toBeLessThan(8 * 1024)
  })
  it('a create access that throws is a 403, not a 500', async () => {
    const cfg = (payload.collections as any).posts.config.access
    const keep = cfg.create
    cfg.create = () => {
      throw new Error('boom')
    }
    try {
      expect((await call('ed1@x.test', { collection: 'posts', doc: { title: 'x' } })).status).toBe(403)
    } finally {
      cfg.create = keep
    }
  })
  it('8: the gate is full -> 503 with retry-after', async () => {
    setTestRuntime(
      buildRuntime({ ...state, gate: createGate({ concurrency: 1, queue: 0 }) } as OgState, payload, {
        renderer,
        store,
        heroLoader: heroSpy,
      }),
    )
    hold = true
    const first = call('ed1@x.test', { collection: 'posts', id: ids.plain, doc: {} })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const second = await call('ed1@x.test', { collection: 'posts', id: ids.plain, doc: {} })
    expect(second.status).toBe(503)
    expect(second.headers.get('retry-after')).toBe('5')
    hold = false
    release?.()
    expect((await first).status).toBe(200)
    setTestRuntime(buildRuntime(state, payload, { renderer, store, heroLoader: heroSpy }))
  })
})
