/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a schema change nobody asked for, and a select that hides the og data.
 * - fields.ts:63  add the group even when `fields.enabled` is false -> "disabled: the schema is exactly 0.1" RED
 * - fields.ts:67  touch a collection that is not a target -> "only target collections get the group" RED
 * - fields.ts:67  add the group twice (no `has og` check) -> "a collection that already carries og is left alone" RED
 * - payloadSource.ts:39  leave `og` out of the select -> "a target select always keeps og" RED
 * - index.ts:131  accept `fields.position` other than sidebar/tab -> "refuses a fields.position that is neither" RED */
import { readFile } from 'node:fs/promises'
import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { type OgImagePluginOptions, ogFields, ogImagePlugin } from '../../src/plugin/index.js'
import { buildFind } from '../../src/plugin/payloadSource.js'
import { defineTarget, defineTemplate } from '../../src/template.js'

const font = (n: string) => () => readFile(new URL(`../fixtures/fonts/${n}`, import.meta.url))
const post = defineTemplate<{ title: string }>({ id: 'post', revision: '1', textFields: ['title'], render: () => null as never })
const posts = defineTarget<any, any>({
  path: '/og/:kind/:slug/card.png',
  template: 'post',
  props: ({ doc }: any) => ({ title: doc.title }),
})
const options = (over: Partial<OgImagePluginOptions> = {}): OgImagePluginOptions => ({
  site: () => ({ name: 'Site' }),
  fonts: [{ family: 'Inter', weight: 800, data: font('inter-latin-cyrillic-800.woff') }],
  stacks: { default: ['Inter'] },
  templates: [post],
  targets: { posts },
  store: { memory: true },
  ...over,
})
const baseConfig = (): Config =>
  ({
    serverURL: 'https://x.test',
    collections: [
      { slug: 'posts', versions: { drafts: true }, fields: [{ name: 'title', type: 'text' }] },
      { slug: 'pages', fields: [{ name: 'title', type: 'text' }] },
    ],
  }) as Config
const apply = (o: OgImagePluginOptions, c: Config = baseConfig()) => ogImagePlugin(o)(c)
const fieldsOf = (c: Config, slug: string) => (c.collections ?? []).find((x) => x.slug === slug)?.fields as any[]

describe('ogFields()', () => {
  it('is one group `og` with mode (default inherit), headline and subtitle, in the sidebar', () => {
    const [group, ...rest] = ogFields() as any[]
    expect(rest).toEqual([])
    expect(group).toMatchObject({ type: 'group', name: 'og', admin: { position: 'sidebar' } })
    const [mode, headline, subtitle] = group.fields
    expect(mode).toMatchObject({ name: 'mode', type: 'select', defaultValue: 'inherit' })
    expect(mode.options.map((o: { value: string }) => o.value)).toEqual(['inherit', 'generated', 'custom', 'off'])
    expect(headline).toMatchObject({ name: 'headline', type: 'text' })
    expect(subtitle).toMatchObject({ name: 'subtitle', type: 'text' })
  })
})

describe('fields option', () => {
  it('enabled: a target collection gets the og group at the sidebar', () => {
    const c = apply(options({ fields: { enabled: true } }))
    expect(fieldsOf(c, 'posts')).toEqual([{ name: 'title', type: 'text' }, ...ogFields()])
  })
  it('enabled with position sidebar equals the default', () => {
    expect(apply(options({ fields: { enabled: true, position: 'sidebar' } })).collections).toEqual(
      apply(options({ fields: { enabled: true } })).collections,
    )
  })
  it('position tab appends a "Share card" tab holding the group, not at the sidebar', () => {
    const c = apply(options({ fields: { enabled: true, position: 'tab' } }))
    const added = fieldsOf(c, 'posts').at(-1)
    expect(added.type).toBe('tabs')
    expect(added.tabs.at(-1).label).toBe('Share card')
    const group = added.tabs.at(-1).fields[0]
    expect(group).toMatchObject({ type: 'group', name: 'og' })
    expect(group.admin?.position).toBeUndefined()
    expect(fieldsOf(c, 'posts')[0]).toEqual({ name: 'title', type: 'text' })
  })
  it('position tab joins an existing top-level tabs field instead of adding another', () => {
    const cfg = baseConfig()
    ;(cfg.collections as any[])[0].fields.push({ type: 'tabs', tabs: [{ label: 'SEO', fields: [] }] })
    const f = fieldsOf(apply(options({ fields: { enabled: true, position: 'tab' } }), cfg), 'posts')
    expect(f.filter((x) => x.type === 'tabs')).toHaveLength(1)
    expect(f.at(-1).tabs.map((t: { label: string }) => t.label)).toEqual(['SEO', 'Share card'])
  })
  it('disabled: the schema is exactly 0.1', () => {
    const before = baseConfig()
    const off = apply(options({ fields: { enabled: false } }), baseConfig())
    const absent = apply(options(), baseConfig())
    expect(off.collections).toEqual(before.collections)
    expect(absent.collections).toEqual(before.collections)
  })
  it('only target collections get the group', () => {
    const c = apply(options({ fields: { enabled: true } }))
    expect(fieldsOf(c, 'pages')).toEqual([{ name: 'title', type: 'text' }])
  })
  it('a target on another collection (target.collection) gets it', () => {
    const t = defineTarget<any, any>({ ...posts, collection: 'pages', path: '/og/:kind/:slug/card.png' })
    const c = apply(options({ targets: { articles: t }, fields: { enabled: true } }))
    expect(fieldsOf(c, 'pages').at(-1)).toMatchObject({ name: 'og' })
    expect(fieldsOf(c, 'posts')).toEqual([{ name: 'title', type: 'text' }])
  })
  it('a collection that already carries og (placed by hand) is left alone, top level or in a tab', () => {
    const top = baseConfig()
    ;(top.collections as any[])[0].fields.push(...ogFields())
    expect(fieldsOf(apply(options({ fields: { enabled: true } }), top), 'posts').filter((f) => f.name === 'og')).toHaveLength(1)
    const tabbed = baseConfig()
    ;(tabbed.collections as any[])[0].fields.push({ type: 'tabs', tabs: [{ label: 'SEO', fields: ogFields() }] })
    const after = fieldsOf(apply(options({ fields: { enabled: true } }), tabbed), 'posts')
    expect(JSON.stringify(after).match(/"name":"og"/g)).toHaveLength(1)
  })
  it('never adds a collection, a global, an endpoint or a job', () => {
    const before = baseConfig()
    const c = apply(options({ fields: { enabled: true } }))
    expect((c.collections ?? []).map((x) => x.slug)).toEqual((before.collections ?? []).map((x) => x.slug))
    expect(c.globals).toBeUndefined()
    expect(c.endpoints).toBeUndefined()
    expect(c.jobs).toBeUndefined()
  })
  it('does not mutate the config it was given', () => {
    const cfg = baseConfig()
    const snapshot = JSON.stringify(cfg)
    apply(options({ fields: { enabled: true } }), cfg)
    expect(JSON.stringify(cfg)).toBe(snapshot)
  })
  it('refuses a malformed fields option', () => {
    expect(() => apply(options({ fields: { enabled: 'yes' } as never }))).toThrow(/fields\.enabled/)
    expect(() => apply(options({ fields: 'on' as never }))).toThrow(/options\.fields/)
  })
  it('refuses a fields.position that is neither sidebar nor tab', () => {
    expect(() => apply(options({ fields: { enabled: true, position: 'top' as never } }))).toThrow(/fields\.position/)
  })
})

describe('buildFind', () => {
  const payload = { collections: {} } as never
  it('a target select always keeps og, or the editor overrides would be dropped', () => {
    const t = defineTarget<any, any>({ ...posts, select: { title: true } })
    expect((buildFind(payload, 'posts', t, { slug: 'a' }) as any).select).toMatchObject({ title: true, slug: true, og: true })
  })
  it('no select stays no select (every field is read)', () => {
    expect(buildFind(payload, 'posts', posts, { slug: 'a' })).not.toHaveProperty('select')
  })
})
