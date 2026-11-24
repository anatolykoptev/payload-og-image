/** Mutation table (production line -> the test that goes RED), against a REAL Payload instance (SQLite).
 * - payloadSource.ts:35  drop the published-status filter -> "a drafts-enabled collection with public read still never returns a draft-only doc" RED
 * - payloadSource.ts:68  published read with overrideAccess: true -> "published() respects collection access" RED
 * - payloadSource.ts:134  hand out a draft without an editor -> "draft() never hands a draft to an anonymous request, even where the collection is publicly readable" RED
 * - payloadSource.ts:144  draft read with overrideAccess: true -> "draft() runs with the editor's own access" RED
 * - payloadSource.ts:167  draft site data without an editor check -> "site(request): published/cached site data unless the request carries an editor" RED
 * - payloadSource.ts:38  always pass a select (a half-empty document) -> "a target with no `select` gets every field" RED
 * - payloadSource.ts:39  leave the editor's share-image field out of `select` -> "a target `select` also keeps the root of the editor's share-image field" RED
 * - payloadSource.ts:114  count any authenticated user as an editor -> "editors are users of the admin collection only" and "the `editors` option names the collections whose users are editors" RED
 * - payloadSource.ts:110  hard-code the editor collections -> the same two tests RED
 * - payloadSource.ts:168  do not tell site() who the editor is -> "editors are users of the admin collection only ... site() is told who the editor is" RED
 * - payloadSource.ts:140  leave the share-image root out of a DRAFT read's select -> "a draft read keeps the root of the editor's share-image field" RED
 * - payloadSource.ts:32  read relations at depth 1 -> "reads are depth 0 ...", "related(): ...", "end to end: a target that draws a related title ..." RED
 * - payloadSource.ts:158  related() without the published filter -> "related(): the published document, never a draft-only one" RED
 * - payloadSource.ts:149  related() treats any previewing request as an editor -> same test RED
 * - payloadSource.ts:102  leave the upload fields as bare ids -> "uploads are read by id with the caller's access" RED
 * - payloadSource.ts:103  read an upload with overrideAccess: true -> same test RED (a private upload would be populated) */
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, getPayload, type Payload } from 'payload'
import sharp from 'sharp'
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

const post2 = defineTemplate<{ title: string; label: string }>({
  id: 'post',
  revision: '1',
  textFields: ['title', 'label'],
  stacks: { label: 'default' },
  render: (p) => ({ type: 'div', props: { children: [p.title, p.label] } }) as never,
})
const tinyPng = async () =>
  new Uint8Array(
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
      .png()
      .toBuffer(),
  )

let payload: Payload
let state: OgState
let editorHeaders: Headers
let customerHeaders: Headers
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
      // A second auth collection: its users are customers, never editors.
      { slug: 'customers', auth: true, fields: [] },
      // Uploads: one anyone may read, one only a logged-in user may.
      { slug: 'media', access: { read: () => true }, upload: { staticDir: path.join(dir, 'media') }, fields: [] },
      {
        slug: 'privateMedia',
        access: { read: ({ req: { user } }) => Boolean(user) },
        upload: { staticDir: path.join(dir, 'private') },
        fields: [],
      },
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
          { name: 'related', type: 'relationship', relationTo: 'notes' },
          { name: 'heroImage', type: 'upload', relationTo: 'media' },
          { name: 'meta', type: 'group', fields: [{ name: 'image', type: 'upload', relationTo: 'media' }] },
          { name: 'secretImage', type: 'upload', relationTo: 'privateMedia' },
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
  await payload.create({ collection: 'customers', data: { email: 'cu@x.test', password: 'pw-pw-pw-pw' } })
  const cl = await payload.login({ collection: 'customers', data: { email: 'cu@x.test', password: 'pw-pw-pw-pw' } })
  customerHeaders = new Headers({ authorization: `JWT ${cl.token}` })
  await payload.create({ collection: 'locked', data: { title: 'Locked draft', slug: 'l', _status: 'draft' }, overrideAccess: true })
  await payload.create({ collection: 'secrets', data: { title: 'Hidden', slug: 's' } })
  await payload.create({ collection: 'posts', data: { title: 'Published A', slug: 'a', extra: 'x', _status: 'published' } })
  await payload.create({ collection: 'posts', data: { title: 'Only draft B', slug: 'b', _status: 'draft' } })
  const a = (await payload.find({ collection: 'posts', where: { slug: { equals: 'a' } }, limit: 1 })).docs[0]
  await payload.update({ collection: 'posts', id: a?.id as number, data: { title: 'Draft A2', _status: 'draft' }, draft: true })
  const draftNote = await payload.create({ collection: 'notes', data: { title: 'Draft-only note', slug: 'n', _status: 'draft' } })
  const pubNote = await payload.create({ collection: 'notes', data: { title: 'Published note', slug: 'pn', _status: 'published' } })
  await payload.create({
    collection: 'posts',
    data: { title: 'Points at a draft', slug: 'rel-draft', related: draftNote?.id as number, _status: 'published' },
  })
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#123456' } })
    .png()
    .toBuffer()
  const file = (name: string) => ({ data: png, mimetype: 'image/png', name, size: png.length })
  const hero = await payload.create({ collection: 'media', data: {}, file: file('h.png') })
  const secret = await payload.create({ collection: 'privateMedia', data: {}, file: file('s.png'), overrideAccess: true })
  await payload.create({
    collection: 'posts',
    data: {
      title: 'With uploads',
      slug: 'with-uploads',
      heroImage: hero.id,
      meta: { image: hero.id },
      secretImage: secret.id,
      _status: 'published',
    },
  })
  await payload.create({
    collection: 'posts',
    data: { title: 'Points at a published note', slug: 'rel-pub', related: pubNote.id, _status: 'published' },
  })
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
  it("a target `select` also keeps the root of the editor's share-image field, or the editor's image would be dropped", async () => {
    const t = defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({}), select: { title: true } })
    const restricted = payloadSource(
      payload,
      { ...state, options: { ...state.options, targets: { posts: t }, seoImage: { path: 'extra.deep' } } } as OgState,
      async () => ({ name: 'S' }),
    )
    const doc = await restricted.published('posts', 'a')
    expect(doc).toHaveProperty('extra') // selected because `extra.deep` is the SEO image path
    expect(doc).toHaveProperty('title')
  })
  it('reads are depth 0: a relation is a bare id, whatever defaultPopulate says, so a draft-only related document cannot reach a published card', async () => {
    const draftRel = await src().published('posts', 'rel-draft')
    expect(typeof draftRel?.related).toBe('number') // a bare id, not a populated document
    expect(JSON.stringify(draftRel)).not.toContain('Draft-only note')
    const pubRel = await src().published('posts', 'rel-pub')
    expect(typeof pubRel?.related).toBe('number')
    const id = (draftRel as { id: number }).id
    expect(JSON.stringify(await src().publishedById('posts', id))).not.toContain('Draft-only note')
  })
  it('related(): the published document, never a draft-only one (defaultPopulate: { title } on the drafts collection changes nothing)', async () => {
    const draftRel = (await src().published('posts', 'rel-draft')) as { related: number }
    const pubRel = (await src().published('posts', 'rel-pub')) as { related: number }
    expect(await src().related('notes', draftRel.related, { previewing: false })).toBeNull()
    expect(await src().related('notes', pubRel.related, { previewing: false })).toMatchObject({ title: 'Published note' })
    // an anonymous request in draft mode is still the public
    expect(await src().related('notes', draftRel.related, { previewing: true, request: anon })).toBeNull()
    // an editor previewing sees the draft
    expect(await src().related('notes', draftRel.related, { previewing: true, request: editor() })).toMatchObject({
      title: 'Draft-only note',
    })
    // a customer is not an editor
    expect(
      await src().related('notes', draftRel.related, {
        previewing: true,
        request: new Request('https://x.test/x', { headers: customerHeaders }),
      }),
    ).toBeNull()
    // a collection the public may not read, or an id that does not exist: null, never a throw
    expect(await src().related('secrets', 1, { previewing: false })).toBeNull()
    expect(await src().related('notes', 999999, { previewing: false })).toBeNull()
  })
  it('end to end: a target that draws a related title shows the published one and never the draft-only one', async () => {
    const targets = {
      posts: defineTarget<any, any>({
        path: '/og/:kind/:slug/card.png',
        template: 'post',
        props: async ({ doc, related }: any) => ({
          title: doc.title,
          label: doc.related ? ((await related('notes', doc.related))?.title ?? '') : '',
        }),
      }),
    }
    const labelOf = async (slug: string) => {
      const seen: string[] = []
      const rt = buildRuntime({ ...state, options: { ...state.options, targets, templates: [post2] } } as OgState, payload, {
        renderer: {
          render: async (el: any) => {
            seen.push(JSON.stringify(el))
            return tinyPng()
          },
        },
        isDraftRequest: async () => false,
      })
      await rt.handler().GET(new Request(`https://x.test/og/posts/${slug}/card.png`), { params: Promise.resolve({ kind: 'posts', slug }) })
      return seen.join('')
    }
    expect(await labelOf('rel-pub')).toContain('Published note')
    expect(await labelOf('rel-draft')).not.toContain('Draft-only note')
  })
  it("uploads are read by id with the caller's access: the hero and a grouped share image are populated; an upload the public may not read is null", async () => {
    const doc = await src().published('posts', 'with-uploads')
    expect(doc?.heroImage).toMatchObject({ filename: 'h.png' })
    expect(doc?.meta?.image).toMatchObject({ filename: 'h.png' })
    expect(doc?.secretImage).toBeNull()
    const asEditor = await src().draft('posts', { slug: 'with-uploads' }, editor())
    expect(asEditor?.secretImage).toMatchObject({ filename: 's.png' }) // an editor may read it
  })
  it('editors are users of the admin collection only: a customer from another auth collection never gets a draft or draft site data', async () => {
    const asCustomer = new Request('https://x.test/x', { headers: customerHeaders })
    expect(await src().draft('posts', { slug: 'a' }, asCustomer)).toBeNull()
    expect(await src().draft('notes' in state.options.targets ? 'notes' : 'posts', { slug: 'a' }, asCustomer)).toBeNull()
    const seen: unknown[] = []
    const probe = payloadSource(
      payload,
      {
        ...state,
        options: {
          ...state.options,
          site: async (a: { draft?: boolean; user?: unknown }) => {
            seen.push(a)
            return { name: a.draft ? 'DRAFT' : 'Pub' }
          },
        },
      } as OgState,
      async () => ({ name: 'Pub' }),
    )
    expect((await probe.site(asCustomer)).name).toBe('Pub')
    const asEditor = await probe.site(editor())
    expect(asEditor.name).toBe('DRAFT')
    expect((seen.at(-1) as { user?: { collection?: string } }).user?.collection).toBe('users') // site() is told who the editor is
  })
  it('the `editors` option names the collections whose users are editors', async () => {
    const asCustomer = new Request('https://x.test/x', { headers: customerHeaders })
    const customersEdit = payloadSource(
      payload,
      { ...state, options: { ...state.options, editors: ['customers'] } } as OgState,
      async () => ({ name: 'S' }),
    )
    expect((await customersEdit.draft('posts', { slug: 'a' }, asCustomer))?.title).toBe('Draft A2')
    expect(await customersEdit.draft('posts', { slug: 'a' }, editor())).toBeNull() // now the admin user is not one
  })
  it("a draft read keeps the root of the editor's share-image field even with a restrictive select", async () => {
    const t = defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({}), select: { title: true } })
    const restricted = payloadSource(
      payload,
      { ...state, options: { ...state.options, targets: { posts: t }, seoImage: { path: 'extra.deep' } } } as OgState,
      async () => ({ name: 'S' }),
    )
    expect(await restricted.draft('posts', { slug: 'a' }, editor())).toHaveProperty('extra')
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
