/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a tool that exposes a draft, renders on an audit, or stores under a key the route never reads.
 * - runtime.ts `isDraftRequest: publicOnly ? async () => false : ...` -> `isDraftRequest` (the inspector's handler follows draft mode) -> "og_preview: draft mode is on, the card is still the published one, stored under its version" RED
 * - payloadSource.ts `buildList` drops the `_status: published` filter -> "drafts are never listed" RED
 * - inspect.ts `audit` draws a card (`d.handler.GET`) -> "no renders, no store reads: only stats" RED
 * - inspect.ts `audit` reads the store with `get` instead of `stat` -> same test RED (storeReads moves)
 * - inspect.ts `serve` also draws a second request under another `?v` -> "draws through the route once, stores under the versioned key only ..." RED
 * - tools.ts a catch returns `e.message` -> "a failure is classified and capped: no path or query reaches the caller" RED
 * - tools.ts `limit` not clamped -> "og_audit is bounded" RED */
import { readFile } from 'node:fs/promises'
import type { mcpPlugin } from '@payloadcms/plugin-mcp'
import type { PayloadRequest } from 'payload'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { installTestRuntime } from '../../src/exports/testing.js'
import { ShedError } from '../../src/internal/gate.js'
import { ToolInputError } from '../../src/internal/inspect.js'
import { setTestRuntime } from '../../src/internal/runtime.js'
import { ogImageMcpToolMap } from '../../src/mcp/core.js'
import { ogImageMcpTools } from '../../src/mcp/v3.js'
import type { OgImagePluginOptions } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'

// What each plugin major takes. The suite runs against Payload 3's plugin types and, in the beta job, Payload 4's: a surface
// the installed major does not have is `true`, so one file type-checks on both and each side is checked where it exists.
type PluginOpts = Parameters<typeof mcpPlugin>[0]
type Prop<T, K extends PropertyKey> = K extends keyof T ? T[K] : never
type V3Tools = NonNullable<Prop<NonNullable<Prop<PluginOpts, 'mcp'>>, 'tools'>>
type V4Tools = NonNullable<Prop<PluginOpts, 'tools'>>
type Assignable<Wanted, Ours> = [Wanted] extends [never] ? true : [Ours] extends [Wanted] ? true : never
const _v3: Assignable<V3Tools, ReturnType<typeof ogImageMcpTools>> = true
const _v4: Assignable<V4Tools, ReturnType<typeof ogImageMcpToolMap>> = true
void _v3
void _v4

const font = () => readFile(new URL('../fixtures/fonts/inter-latin-cyrillic-800.woff', import.meta.url))
const card = defineTemplate<{ title: string }>({
  id: 'card',
  revision: '1',
  required: (p) => p.title.trim() !== '',
  textFields: ['title'],
  render: (p, ctx) => createElement('div', { style: { display: 'flex', fontFamily: ctx.font('default', p.title) } }, ctx.hero ?? p.title),
})
const options = (over: Partial<OgImagePluginOptions> = {}): OgImagePluginOptions => ({
  site: async () => ({ name: 'Site' }),
  fonts: [{ family: 'Inter', weight: 800, data: font }],
  stacks: { default: ['Inter'] },
  templates: [card],
  targets: {
    posts: defineTarget<any, any>({
      path: '/og/:kind/:slug/card.png',
      template: 'card',
      props: ({ doc }: any) => ({ title: doc.title }),
      hero: ({ doc }: any) => doc.heroImage,
    }),
  },
  static: {
    'index/blog': { path: '/og/index/blog/card.png', kind: 'index', slug: 'blog', template: 'card', props: () => ({ title: 'Blog' }) },
  },
  store: { memory: true },
  ...over,
})
const hero = (id: number, filename: string) => ({ id, url: `/m/${filename}`, filename, updatedAt: 'u1' })
const docs = () => ({
  published: {
    posts: [
      { id: 1, slug: 'a', title: 'Alpha', meta: { description: 'About alpha' } },
      { id: 2, slug: 'b', title: 'Beta', meta: { description: '  ' } },
      { id: 3, slug: 'c', title: 'Gamma' },
      { id: 4, slug: 'with-hero', title: 'Hero', meta: { description: 'x' }, heroImage: hero(9, 'h.png') },
      { id: 5, slug: 'broken-hero', title: 'Broken', meta: { description: 'x' }, heroImage: hero(10, 'missing.png') },
    ],
  },
  drafts: {
    posts: [
      { id: 1, slug: 'a', title: 'Alpha DRAFT' }, // a draft of a published document
      { id: 99, slug: 'secret', title: 'Never published' }, // a document that exists only as a draft
    ],
  },
  globals: {},
})
const req = { payload: { config: {} } } as unknown as PayloadRequest
afterEach(() => setTestRuntime(null))

type Content = { type: string; text?: string; data?: string; mimeType?: string }
const run = async (
  name: 'og_card' | 'og_audit' | 'og_preview',
  args: Record<string, unknown>,
  o?: Parameters<typeof ogImageMcpTools>[0],
) => {
  const tool = ogImageMcpTools(o).find((t) => t.name === name)
  if (!tool) throw new Error(`no tool ${name}`)
  const out = (await tool.handler(args, req, undefined)) as { content: Content[]; isError?: boolean }
  const json = JSON.parse(out.content.find((c) => c.type === 'text')?.text ?? 'null')
  return { json, content: out.content, isError: out.isError === true }
}

describe('og_card', () => {
  it('names the card, its version and whether it is stored; a lookup draws nothing', async () => {
    const rt = installTestRuntime(options(), docs())
    const before = await run('og_card', { target: 'posts', slug: 'a' })
    expect(before.json).toMatchObject({
      found: true,
      scope: 'posts',
      kind: 'generated',
      stored: null,
      reason: expect.stringMatching(/^not_stored/),
    })
    expect(before.json.card.url).toMatch(/^https:\/\/example\.test\/og\/posts\/a\/card\.png\?v=[0-9a-f]{12}$/)
    expect(rt.renders()).toBe(0)
    const res = await rt.runtime.handler().GET(new Request(before.json.card.url), { params: Promise.resolve({ kind: 'posts', slug: 'a' }) })
    const bytes = (await res.arrayBuffer()).byteLength
    expect(res.headers.get('etag')).toBe(`"${before.json.card.v}"`) // the tool's version is the route's
    const after = await run('og_card', { target: 'posts', id: 1 })
    expect(after.json.stored).toEqual({ bytes })
    expect(after.json.reason).toBeUndefined()
    // By the card's own path or URL, and a static card by its key.
    expect((await run('og_card', { path: `/og/posts/a/card.png?v=zzz` })).json.card.v).toBe(before.json.card.v)
    expect((await run('og_card', { path: before.json.card.url })).json.card.v).toBe(before.json.card.v)
    expect((await run('og_card', { static: 'index/blog' })).json).toMatchObject({ found: true, scope: 'static', kind: 'generated' })
  })

  it('a document that is only a draft is not found, and a published one shows its published card', async () => {
    const rt = installTestRuntime(options(), docs())
    expect((await run('og_card', { target: 'posts', slug: 'secret' })).json).toEqual({ found: false, reason: 'no published document' })
    expect((await run('og_card', { target: 'posts', id: 99 })).json.found).toBe(false)
    rt.draftMode(true, true) // an editor in draft mode: the tool is for the public all the same
    const published = (await run('og_card', { target: 'posts', slug: 'a' })).json
    rt.draftMode(false)
    expect((await run('og_card', { target: 'posts', slug: 'a' })).json.card.v).toBe(published.card.v)
  })

  it('reports the hero: transparent, its ground, and a file that cannot be read', async () => {
    installTestRuntime(options(), docs(), { transparentHero: (h) => h.id === 9 })
    const ok = (await run('og_card', { target: 'posts', slug: 'with-hero' })).json
    expect(ok.hero).toEqual({ id: 9, filename: 'h.png', transparent: true, ground: null, readable: true })
    const flat = installTestRuntime(options({ heroBackground: '#336699' }), docs(), { transparentHero: () => true })
    void flat
    expect((await run('og_card', { target: 'posts', slug: 'with-hero' })).json.hero).toMatchObject({
      transparent: false,
      ground: '#336699',
    })
    const broken = (await run('og_card', { target: 'posts', slug: 'broken-hero' })).json
    expect(broken.hero.readable).toBe(false)
    expect(broken.reason).toMatch(/^hero_unreadable/)
  })

  it('says what it could not find, and what to give', async () => {
    installTestRuntime(options(), docs())
    expect((await run('og_card', {})).isError).toBe(true)
    expect((await run('og_card', { target: 'nope', slug: 'a' })).json.reason).toMatch(/no target "nope"/)
    expect((await run('og_card', { path: '/blog/a' })).json.reason).toMatch(/no card route or page is known for "\/blog\/a"/)
    const mapped = await run(
      'og_card',
      { path: '/blog/a' },
      { locate: (p) => (p.startsWith('/blog/') ? { target: 'posts', slug: p.slice(6) } : null) },
    )
    expect(mapped.json).toMatchObject({ found: true, slug: 'a' })
  })
})

describe('keys other than the slug', () => {
  const keyed = () =>
    options({
      targets: {
        ...options().targets,
        items: defineTarget<any, any>({
          path: '/og/:kind/:id/card.png',
          template: 'card',
          props: ({ doc }: any) => ({ title: doc.title }),
        }),
        codes: defineTarget<any, any>({
          path: '/og/codes/:slug/card.png',
          slugField: 'code',
          template: 'card',
          props: ({ doc }: any) => ({ title: doc.title }),
        }),
      },
    })
  const keyedDocs = () => ({
    ...docs(),
    published: {
      ...docs().published,
      // A card path's `:id` carries the slug: the document whose slug is "7" is id 3, and id 7 has another slug.
      items: [
        { id: 3, slug: '7', title: 'Seven by slug' },
        { id: 7, slug: 'x', title: 'Id seven' },
      ],
      codes: [{ id: 1, code: 'abc', title: 'Coded' }],
    },
  })
  it('a card path with :id is looked up by its slug, as the route does', async () => {
    const rt = installTestRuntime(keyed(), keyedDocs())
    const r = (await run('og_card', { path: '/og/items/7/card.png' })).json
    expect(r).toMatchObject({ found: true, scope: 'items', slug: '7' })
    const res = await rt.runtime.handler().GET(new Request(r.card.url), { params: Promise.resolve({ kind: 'items', slug: '7' }) })
    expect(res.headers.get('etag')).toBe(`"${r.card.v}"`) // the route serves that very document
    expect((await run('og_card', { path: '/og/items/x/card.png' })).json.card.v).not.toBe(r.card.v) // by slug "x", not by id
  })
  it("an audit row's slug follows the target's slugField", async () => {
    installTestRuntime(keyed(), keyedDocs())
    expect((await run('og_audit', { scope: 'codes' })).json.rows[0]).toMatchObject({ id: 1, slug: 'abc' })
  })
})

describe('failures', () => {
  it('a failure is classified and capped: no path or query reaches the caller; a full queue is a retry; a bad input is said', async () => {
    const logged: unknown[] = []
    const failing = {
      payload: { config: {}, logger: { error: (o: unknown) => logged.push(o) } },
    } as unknown as PayloadRequest
    const boom = (e: Error) =>
      setTestRuntime({
        inspect: {
          card: async () => Promise.reject(e),
          scopes: async () => Promise.reject(e),
          audit: async () => Promise.reject(e),
          serve: async () => Promise.reject(e),
          locate: () => null,
        },
      } as never)
    const call = async (name: 'og_card' | 'og_audit' | 'og_preview', args: Record<string, unknown>) => {
      const tool = ogImageMcpTools().find((t) => t.name === name)
      const out = (await (tool as NonNullable<typeof tool>).handler(args, failing, undefined)) as { content: Content[]; isError?: boolean }
      return { text: out.content[0]?.text as string, isError: out.isError === true }
    }
    boom(new Error('ENOENT: no such file /srv/app/.secret/store.png; SELECT * FROM users'))
    for (const [name, args] of [
      ['og_card', { target: 'posts', slug: 'a' }],
      ['og_audit', {}],
      ['og_preview', { target: 'posts', slug: 'a' }],
    ] as const) {
      const r = await call(name, args as never)
      expect(r.isError).toBe(true)
      expect(r.text).toContain('internal_error')
      expect(r.text).not.toMatch(/srv|SELECT|ENOENT/)
    }
    expect(logged).toHaveLength(3) // the detail stays in the server log
    boom(new ShedError())
    expect((await call('og_audit', {})).text).toMatch(/busy/)
    boom(new ToolInputError('no scope "x"'))
    expect((await call('og_audit', { scope: 'x' })).text).toContain('no scope')
  })
})

describe('og_audit', () => {
  it('lists the scopes, then pages of rows; drafts are never listed', async () => {
    installTestRuntime(options(), docs())
    const scopes = (await run('og_audit', {})).json.scopes
    expect(scopes).toEqual([
      { scope: 'posts', kind: 'target', total: 5 }, // five published documents: the two drafts are not counted
      { scope: 'static', kind: 'static', total: 1 },
    ])
    const page1 = (await run('og_audit', { scope: 'posts', limit: 3 })).json
    const page2 = (await run('og_audit', { scope: 'posts', limit: 3, page: 2 })).json
    const slugs = [...page1.rows, ...page2.rows].map((r: { slug: string }) => r.slug)
    expect(slugs).toEqual(['a', 'b', 'c', 'with-hero', 'broken-hero'])
    expect(slugs).not.toContain('secret')
    expect([page1.hasNext, page2.hasNext]).toEqual([true, false])
    expect(page1.rows[0].url).toMatch(/\/og\/posts\/a\/card\.png\?v=[0-9a-f]{12}$/)
    expect(page1.rows[0]).toMatchObject({ kind: 'generated', stored: false, bytes: null })
    // A draft's words never reach a row: the version is the published document's.
    const a = (await run('og_card', { target: 'posts', slug: 'a' })).json
    expect(page1.rows[0].v).toBe(a.card.v)
    expect((await run('og_audit', { scope: 'static' })).json.rows).toHaveLength(1)
  })

  it('no renders, no store reads: only stats', async () => {
    const rt = installTestRuntime(options(), docs())
    await rt.runtime
      .handler()
      .GET(new Request('https://example.test/og/posts/a/card.png'), { params: Promise.resolve({ kind: 'posts', slug: 'a' }) })
    const renders = rt.renders()
    const reads = rt.storeReads()
    const audit = (await run('og_audit', { scope: 'posts', limit: 100 }, { describedBy: 'meta.description' })).json
    expect([rt.renders(), rt.storeReads(), rt.stored().length]).toEqual([renders, reads, 1])
    expect(audit.rows.find((r: { slug: string }) => r.slug === 'a')).toMatchObject({
      stored: true,
      bytes: expect.any(Number),
      hasDescription: true,
    })
    expect(audit.summary).toMatchObject({ rows: 5, stored: 1, notStored: 4, downgraded: null, missingDescription: 2 })
    // `b` has a blank description and `c` none: the SEO gap.
    expect(audit.rows.filter((r: { hasDescription: boolean }) => !r.hasDescription).map((r: { slug: string }) => r.slug)).toEqual([
      'b',
      'c',
    ])
  })

  it('checkHeroes finds a card that would be drawn without its hero', async () => {
    installTestRuntime(options(), docs())
    const audit = (await run('og_audit', { scope: 'posts', checkHeroes: true })).json
    expect(audit.summary.downgraded).toBe(1)
    expect(audit.rows.find((r: { downgraded: boolean }) => r.downgraded)).toMatchObject({ slug: 'broken-hero' })
  })

  it('is bounded: a page holds at most 100 rows, whatever is asked', async () => {
    const many = docs()
    many.published.posts = Array.from({ length: 130 }, (_, i) => ({ id: 100 + i, slug: `p-${i}`, title: `P${i}` })) as never
    installTestRuntime(options(), many)
    expect((await run('og_audit', { scope: 'posts', limit: 100000 })).json.rows).toHaveLength(100)
    expect((await run('og_audit', { scope: 'posts', limit: -5, page: 0 })).json.limit).toBe(1)
    expect((await run('og_audit', { scope: 'nope' })).isError).toBe(true)
  })
})

describe('og_preview', () => {
  it('draws through the route once, stores under the versioned key only, then reads the store', async () => {
    const rt = installTestRuntime(options(), docs())
    const want = (await run('og_card', { target: 'posts', slug: 'a' })).json.card
    const first = await run('og_preview', { target: 'posts', slug: 'a' })
    const image = first.content.find((c) => c.type === 'image') as Content
    expect(image.mimeType).toBe('image/png')
    expect([...Buffer.from(image.data as string, 'base64').subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(first.json).toMatchObject({ status: 'png', v: want.v, source: 'render', wasStored: false })
    expect(rt.stored()).toEqual([{ pageId: want.pageId, v: want.v }]) // that key, and no other
    const second = await run('og_preview', { target: 'posts', slug: 'a' })
    expect(second.json).toMatchObject({ source: expect.stringMatching(/^(memo|store)$/), wasStored: true })
    expect(rt.renders()).toBe(1)
    expect(rt.stored()).toHaveLength(1)
  })

  it('draft mode is on, the card is still the published one, stored under its version', async () => {
    const rt = installTestRuntime(options(), docs())
    rt.draftMode(true, true)
    const r = await run('og_preview', { target: 'posts', slug: 'a' })
    expect(r.json.source).toBe('render') // not `draft`: a draft is never what a tool shows
    expect(rt.stored()).toHaveLength(1)
    rt.draftMode(false)
    // The same bytes as the public route draws for the published document.
    const publicRes = await rt.runtime.handler().GET(new Request(r.json.url), { params: Promise.resolve({ kind: 'posts', slug: 'a' }) })
    const viaTool = Buffer.from((r.content.find((c) => c.type === 'image') as Content).data as string, 'base64')
    expect(Buffer.from(await publicRes.arrayBuffer()).equals(viaTool)).toBe(true)
    expect((await run('og_preview', { target: 'posts', slug: 'secret' })).json.status).toBe('not_found')
    expect(rt.stored()).toHaveLength(1) // the draft-only document drew and stored nothing
  })

  it('goes through the queue: a full gate is a refusal to retry, not a bypass', async () => {
    const rt = installTestRuntime(options({ gate: { concurrency: 1, queue: 0 } }), docs())
    const release = rt.holdRenders()
    const held = run('og_preview', { target: 'posts', slug: 'a' }) // takes the one slot
    for (let i = 0; i < 50 && rt.gateStats().active < 1; i++) await new Promise((r) => setImmediate(r))
    const refused = await run('og_preview', { target: 'posts', slug: 'b' })
    expect(refused.json).toMatchObject({ status: 'shed', retryAfter: '5' })
    expect(refused.isError).toBe(false) // an answer to act on, not a failure
    release()
    expect((await held).json.status).toBe('png')
    expect(rt.renders()).toBe(2 - 1) // the shed request never reached the renderer
  })

  it('describes a card over the size limit instead of sending it', async () => {
    installTestRuntime(options(), docs())
    const r = await run('og_preview', { target: 'posts', slug: 'a' }, { maxPreviewBytes: 10 })
    expect(r.content.some((c) => c.type === 'image')).toBe(false)
    expect(r.json.image).toMatch(/not sent/)
  })
})

describe('ogImageMcpToolMap (Payload 4)', () => {
  it('offers the same tools with JSON Schema inputs that name the same arguments as the zod ones', () => {
    const map = ogImageMcpToolMap()
    const v3 = ogImageMcpTools()
    expect(Object.keys(map)).toEqual(v3.map((t) => t.name))
    for (const t of v3) {
      const m = map[t.name] as ReturnType<typeof ogImageMcpToolMap>[string]
      expect(m.description).toBe(t.description)
      expect(m.input).toMatchObject({ type: 'object', additionalProperties: false })
      expect(Object.keys(m.input.properties).sort()).toEqual(Object.keys(t.parameters).sort())
    }
    expect(Object.keys(ogImageMcpToolMap({ tools: ['card'] }))).toEqual(['og_card'])
  })

  it('answers what the v3 tools answer, image part included', async () => {
    const rt = installTestRuntime(options(), docs())
    const map = ogImageMcpToolMap()
    const call = (name: string, input: Record<string, unknown>) =>
      (map[name] as ReturnType<typeof ogImageMcpToolMap>[string]).handler({ input, req })
    const card = await call('og_card', { target: 'posts', slug: 'a' })
    expect(JSON.parse((card.content[0] as { text: string }).text)).toEqual((await run('og_card', { target: 'posts', slug: 'a' })).json)
    expect(rt.renders()).toBe(0)
    const preview = await call('og_preview', { target: 'posts', slug: 'a' })
    expect(preview.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' })
    expect(rt.stored()).toHaveLength(1)
    const audit = await call('og_audit', { scope: 'posts', limit: 2 })
    expect(JSON.parse((audit.content[0] as { text: string }).text)).toMatchObject({ scope: 'posts', limit: 2, total: 5 })
    expect((await call('og_audit', { scope: 'nope' })).isError).toBe(true)
  })

  it('access: a signed-in MCP user by default, or what the site says; nobody anonymous', async () => {
    const tool = ogImageMcpToolMap().og_card as ReturnType<typeof ogImageMcpToolMap>[string]
    expect(await tool.access({ req: { user: { id: 1 } } as never })).toBe(true)
    expect(await tool.access({ req: {} as never })).toBe(false)
    const custom = ogImageMcpToolMap({ access: ({ req }) => (req.user as { role?: string } | null)?.role === 'seo' })
      .og_audit as ReturnType<typeof ogImageMcpToolMap>[string]
    expect(await custom.access({ req: { user: { role: 'seo' } } as never })).toBe(true)
    expect(await custom.access({ req: { user: { role: 'other' } } as never })).toBe(false)
  })
})
