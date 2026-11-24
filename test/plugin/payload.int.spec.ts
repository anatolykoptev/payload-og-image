/** Mutation table (production line -> the test that goes RED), against a REAL Payload instance (SQLite).
 * - payloadSource.ts:24  drop the published-status filter -> "a drafts-enabled collection with public read still never returns a draft-only doc" RED
 * - payloadSource.ts:56  published read with overrideAccess: true -> "published() respects collection access" RED
 * - payloadSource.ts:61  hand out a draft without an editor -> "draft() never hands a draft to an anonymous request, even where the collection is publicly readable" RED
 * - payloadSource.ts:68  draft read with overrideAccess: true -> "draft() runs with the editor's own access" RED
 * - payloadSource.ts:72  draft site data without an editor check -> "site(request): published/cached site data unless the request carries an editor" RED
 * - payloadSource.ts:25  always pass a select (a half-empty document) -> "a target with no `select` gets every field" RED */
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildRuntime } from '../../src/internal/runtime.js'
import { CUSTOM_KEY, type OgState } from '../../src/internal/state.js'
import { ogImagePlugin } from '../../src/plugin/index.js'
import { payloadSource } from '../../src/plugin/payloadSource.js'
import { defineTarget, defineTemplate } from '../../src/template.js'

const font = () => readFile(new URL('../fixtures/fonts/inter-latin-cyrillic-800.woff', import.meta.url))
const post = defineTemplate<{ title: string; label: string }>({
  id: 'post',
  revision: '1',
  textFields: ['title'],
  render: (p) => ({ type: 'div', props: { children: p.title } }) as never,
})

let payload: Payload
let state: OgState
let editorHeaders: Headers
let siteName = 'Site One'

beforeAll(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'og-int-'))
  const config = await buildConfig({
    secret: 'test-secret-test-secret',
    serverURL: 'https://x.test',
    db: sqliteAdapter({ client: { url: `file:${path.join(dir, 'db.sqlite')}` } }),
    editor: lexicalEditor(),
    collections: [
      { slug: 'users', auth: true, fields: [] },
      // Public read of everything: only the published-status filter keeps a draft-only note out.
      {
        slug: 'notes',
        versions: { drafts: true },
        access: { read: () => true },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
        ],
      },
      // Drafts exist, but no one (editor included) may read this collection through access control.
      {
        slug: 'locked',
        versions: { drafts: true },
        access: { read: () => false, create: () => true },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
        ],
      },
      // Nobody may read it without logging in: an `overrideAccess: true` read would leak it.
      {
        slug: 'secrets',
        access: { read: ({ req: { user } }) => Boolean(user) },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
        ],
      },
      {
        slug: 'posts',
        versions: { drafts: true },
        // Public readers see published posts only; any logged-in user sees everything.
        access: { read: ({ req: { user } }) => (user ? true : { _status: { equals: 'published' } }) },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
          { name: 'extra', type: 'text' },
        ],
      },
    ],
    globals: [{ slug: 'site-settings', fields: [{ name: 'businessName', type: 'text' }], access: { read: () => true } }],
    plugins: [
      ogImagePlugin({
        site: async () => ({ name: siteName }),
        fonts: [{ family: 'Inter', weight: 800, data: font }],
        stacks: { default: ['Inter'] },
        templates: [post],
        targets: {
          posts: defineTarget<any, any>({
            path: '/og/:kind/:slug/card.png',
            template: 'post',
            props: ({ doc }: any) => ({ title: doc.title, label: 'Blog' }),
          }),
        },
        store: { memory: true },
      }),
    ],
  })
  payload = await getPayload({ config })
  state = payload.config.custom?.[CUSTOM_KEY] as OgState
  await payload.create({ collection: 'users', data: { email: 'ed@x.test', password: 'pw-pw-pw-pw' } })
  const login = await payload.login({ collection: 'users', data: { email: 'ed@x.test', password: 'pw-pw-pw-pw' } })
  editorHeaders = new Headers({ authorization: `JWT ${login.token}` })
  await payload.create({ collection: 'notes', data: { title: 'Draft-only note', slug: 'n', _status: 'draft' } })
  await payload.create({ collection: 'locked', data: { title: 'Locked draft', slug: 'l', _status: 'draft' }, overrideAccess: true })
  await payload.create({ collection: 'secrets', data: { title: 'Hidden', slug: 's' } })
  await payload.create({ collection: 'posts', data: { title: 'Published A', slug: 'a', extra: 'x', _status: 'published' } })
  await payload.create({ collection: 'posts', data: { title: 'Only draft B', slug: 'b', _status: 'draft' } })
  const a = (await payload.find({ collection: 'posts', where: { slug: { equals: 'a' } }, limit: 1 })).docs[0]
  await payload.update({ collection: 'posts', id: a?.id as number, data: { title: 'Draft A2', _status: 'draft' }, draft: true })
}, 60_000)
afterAll(async () => {
  await payload?.db?.destroy?.()
})

describe('payloadSource against a real Payload', () => {
  const src = () => payloadSource(payload, state, async () => ({ name: siteName }))
  const anon = new Request('https://x.test/x')
  const editor = () => new Request('https://x.test/x', { headers: editorHeaders })

  it('published(): the published version only, never a draft or a draft-only doc', async () => {
    expect((await src().published('posts', 'a'))?.title).toBe('Published A')
    expect(await src().published('posts', 'b')).toBeNull()
    expect(await src().published('posts', 'nope')).toBeNull()
  })
  it('publishedById(): the same document by id', async () => {
    const a = (await src().published('posts', 'a')) as { id: number }
    expect((await src().publishedById('posts', a.id))?.title).toBe('Published A')
  })
  it('a target with no `select` gets every field (a half-empty doc would be a blank title)', async () => {
    const doc = await src().published('posts', 'a')
    expect(doc).toMatchObject({ title: 'Published A', slug: 'a', extra: 'x' })
  })
  it('a target `select` restricts the fields, and always keeps the slug field', async () => {
    const t = defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({}), select: { title: true } })
    const restricted = payloadSource(payload, { ...state, options: { ...state.options, targets: { posts: t } } } as OgState, async () => ({
      name: 'S',
    }))
    const doc = await restricted.published('posts', 'a')
    expect(doc).toMatchObject({ title: 'Published A', slug: 'a' })
    expect(doc).not.toHaveProperty('extra')
  })
  it('a drafts-enabled collection with public read still never returns a draft-only doc (the status filter)', async () => {
    const t = defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({}) })
    const notes = payloadSource(payload, { ...state, options: { ...state.options, targets: { notes: t } } } as OgState, async () => ({
      name: 'S',
    }))
    expect(await notes.published('notes', 'n')).toBeNull()
  })
  it('draft() never hands a draft to an anonymous request, even where the collection is publicly readable', async () => {
    const t = defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({}) })
    const notes = payloadSource(payload, { ...state, options: { ...state.options, targets: { notes: t } } } as OgState, async () => ({
      name: 'S',
    }))
    expect(await notes.draft('notes', { slug: 'n' }, new Request('https://x.test/x'))).toBeNull()
    expect((await notes.draft('notes', { slug: 'n' }, new Request('https://x.test/x', { headers: editorHeaders })))?.title).toBe(
      'Draft-only note',
    )
  })
  it('draft() runs with the editor’s own access: a collection the editor cannot read yields nothing', async () => {
    const t = defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({}) })
    const locked = payloadSource(payload, { ...state, options: { ...state.options, targets: { locked: t } } } as OgState, async () => ({
      name: 'S',
    }))
    const got = await locked
      .draft('locked', { slug: 'l' }, new Request('https://x.test/x', { headers: editorHeaders }))
      .catch(() => 'denied')
    expect(got === null || got === 'denied').toBe(true)
  })
  it('published() respects collection access: a collection the public cannot read returns nothing', async () => {
    const t = defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({}) })
    const secrets = payloadSource(payload, { ...state, options: { ...state.options, targets: { secrets: t } } } as OgState, async () => ({
      name: 'S',
    }))
    const got = await secrets.published('secrets', 's').catch(() => 'denied')
    expect(got === null || got === 'denied').toBe(true)
  })
  it('draft(): null for an anonymous request, the latest draft for an authenticated editor', async () => {
    expect(await src().draft('posts', { slug: 'a' }, anon)).toBeNull()
    expect((await src().draft('posts', { slug: 'a' }, editor()))?.title).toBe('Draft A2')
    expect((await src().draft('posts', { slug: 'b' }, editor()))?.title).toBe('Only draft B')
    expect(
      await src().draft('posts', { slug: 'a' }, new Request('https://x.test/x', { headers: { authorization: 'JWT garbage' } })),
    ).toBeNull()
  })
  it('site(request): published/cached site data unless the request carries an editor', async () => {
    siteName = 'Site One'
    expect((await src().site(anon)).name).toBe('Site One')
    expect((await src().site()).name).toBe('Site One')
    const draftSite = payloadSource(
      payload,
      {
        ...state,
        options: { ...state.options, site: async ({ draft }: { draft?: boolean }) => ({ name: draft ? 'DRAFT NAME' : 'Published' }) },
      } as OgState,
      async () => ({ name: 'Published' }),
    )
    expect((await draftSite.site(anon)).name).toBe('Published') // a draft-mode cookie alone draws no draft text
    expect((await draftSite.site(editor())).name).toBe('DRAFT NAME')
  })
  it('end to end through the real runtime: published words, draft words only for the editor, never stored', async () => {
    const rt = buildRuntime(state, payload, {
      renderer: {
        render: async () =>
          new Uint8Array(
            await (await import('sharp'))
              .default({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
              .png()
              .toBuffer(),
          ),
      },
      isDraftRequest: async (r) => r.headers.has('x-draft'),
    })
    const ctx = { params: Promise.resolve({ kind: 'posts', slug: 'a' }) }
    const pub = await rt.handler().GET(new Request('https://x.test/og/posts/a/card.png'), ctx)
    expect([pub.status, pub.headers.get('x-og-cache')]).toEqual([200, 'render'])
    const draftHeaders = new Headers(editorHeaders)
    draftHeaders.set('x-draft', '1')
    const d = await rt.handler().GET(new Request('https://x.test/og/posts/a/card.png', { headers: draftHeaders }), ctx)
    expect([d.headers.get('cache-control'), d.headers.get('x-og-cache')]).toEqual(['no-store', 'draft'])
    expect(d.headers.get('etag')).not.toBe(pub.headers.get('etag')) // different words, different version
    const meta = await rt.resolveForMetadata({ target: 'posts', id: ((await src().published('posts', 'a')) as { id: number }).id })
    expect(meta.kind === 'generated' && `"${meta.v}"`).toBe(pub.headers.get('etag'))
    expect(
      (await rt.handler().GET(new Request('https://x.test/og/posts/b/card.png'), { params: Promise.resolve({ kind: 'posts', slug: 'b' }) }))
        .status,
    ).toBe(404)
  })
})
