/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a misconfigured plugin that boots and serves nothing, or one that changes the schema.
 * - index.ts:57  no `default` stack required -> "refuses no default stack" RED
 * - index.ts:75  accept a target on a missing collection -> "3: a target whose collection does not exist throws" RED
 * - index.ts:76  accept an unknown template -> "2: a target naming an unknown template throws" RED
 * - index.ts:79  skip the duplicate-kind check -> "4: two targets with the same kind throw" RED
 * - index.ts:122  drop the existing afterChange hooks -> "5: siteGlobals get an afterChange hook ... after the existing hooks" RED
 * - index.ts:127  add a field to a collection -> "6: the plugin is schema-neutral" RED
 * - index.ts:146  skip the glyph self-test -> "throws outside production when a stack cannot draw the sample" RED
 * - index.ts:155  always throw, even in production -> "in production it logs through the event sink instead of throwing" RED
 * - index.ts:131  run the self-test when disabled -> "7: disabled keeps the config valid and runs no start-up checks" RED
 * - index.ts:99  accept a relative store dir -> "refuses a relative store dir" RED */
import { readFile } from 'node:fs/promises'
import type { Config } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { CUSTOM_KEY, type OgState } from '../../src/internal/state.js'
import { type OgImagePluginOptions, ogImagePlugin } from '../../src/plugin/index.js'
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
    collections: [{ slug: 'posts', versions: { drafts: true }, fields: [{ name: 'title', type: 'text' }] }],
    globals: [{ slug: 'site-settings', fields: [{ name: 'businessName', type: 'text' }] }],
  }) as Config
const apply = (o: OgImagePluginOptions, c: Config = baseConfig()) => ogImagePlugin(o)(c)
const stateOf = (c: Config) => c.custom?.[CUSTOM_KEY] as OgState

describe('ogImagePlugin: config transform', () => {
  it('1: stores its state in config.custom and chains onInit', async () => {
    const earlier = vi.fn()
    const c = apply(options(), { ...baseConfig(), onInit: earlier })
    expect(stateOf(c).options.targets).toHaveProperty('posts')
    await c.onInit?.({} as never)
    expect(earlier).toHaveBeenCalledTimes(1)
  })
  it('2: a target naming an unknown template throws, naming both', () => {
    expect(() => apply(options({ targets: { posts: defineTarget<any, any>({ ...posts, template: 'ghost' }) } }))).toThrow(
      /target "posts" names the unknown template "ghost"/,
    )
  })
  it('3: a target whose collection does not exist throws', () => {
    expect(() => apply(options({ targets: { articles: posts } }))).toThrow(
      /target "articles" names the collection "articles", which does not exist/,
    )
    expect(() => apply(options({ targets: { x: defineTarget<any, any>({ ...posts, collection: 'nope' }) } }))).toThrow(/collection "nope"/)
  })
  it('4: two targets with the same kind throw', () => {
    const c = { ...baseConfig(), collections: [...(baseConfig().collections ?? []), { slug: 'pages', fields: [] }] } as Config
    expect(() =>
      apply(
        options({
          targets: { posts: defineTarget<any, any>({ ...posts, kind: 'k' }), pages: defineTarget<any, any>({ ...posts, kind: 'k' }) },
        }),
        c,
      ),
    ).toThrow(/share the kind "k"/)
  })
  it('5: siteGlobals get an afterChange hook that drops the cached site(), after the existing hooks', async () => {
    const mine = vi.fn()
    const base = baseConfig()
    base.globals = [{ slug: 'site-settings', fields: [], hooks: { afterChange: [mine] } }] as never
    const c = apply(options({ siteGlobals: ['site-settings'] }), base)
    const invalidate = vi.spyOn(stateOf(c), 'invalidateSite')
    const hooks = (c.globals?.[0]?.hooks?.afterChange ?? []) as Array<() => unknown>
    expect(hooks).toHaveLength(2)
    expect(hooks[0]).toBe(mine)
    await hooks[1]?.()
    expect(invalidate).toHaveBeenCalledTimes(1)
    // and a real cached site() reloads after it
    let name = 'Old'
    const st = stateOf(apply(options({ siteGlobals: ['site-settings'], site: () => ({ name }) })))
    const { cachedSite } = await import('../../src/internal/site.js')
    st.siteCache = cachedSite(async () => ({ name }))
    expect((await st.siteCache.get()).name).toBe('Old')
    name = 'New'
    st.invalidateSite()
    expect((await st.siteCache.get()).name).toBe('New')
  })
  it('a global that is not a site global is left alone, and a missing one throws', () => {
    const c = apply(options({ siteGlobals: [] }))
    expect(c.globals?.[0]?.hooks).toBeUndefined()
    expect(() => apply(options({ siteGlobals: ['nope'] }))).toThrow(/global "nope", which does not exist/)
  })
  it('6: the plugin is schema-neutral: no fields, endpoints, jobs, hooks or access are added', () => {
    const before = baseConfig()
    const after = apply(options(), baseConfig())
    expect(after.collections).toEqual(before.collections)
    expect(after.globals).toEqual(before.globals)
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), 'custom', 'onInit'].sort())
    expect(after.endpoints).toBeUndefined()
    expect(after.jobs).toBeUndefined()
  })
  it('7: disabled keeps the config valid and runs no start-up checks', async () => {
    const c = apply(options({ disabled: true, fonts: [{ family: 'Inter', data: async () => new Uint8Array(8) }] }))
    await expect(c.onInit?.({} as never)).resolves.toBeUndefined()
  })
  it.each([
    ['no site function', { site: undefined as never }, /options\.site must be a function/],
    ['no fonts', { fonts: [] }, /at least one font face/],
    ['a stack naming an unregistered family', { stacks: { default: ['Nope'] } }, /family "Nope", which no registered font provides/],
    ['no default stack', { stacks: { title: ['Inter'] } }, /needs a "default" stack/],
    ['duplicate template ids', { templates: [post, post] }, /two templates share the id "post"/],
    ['neither store', { store: {} as never }, /exactly one of/],
    ['both stores', { store: { dir: '/x', memory: true } as never }, /exactly one of/],
    ['a relative store dir', { store: { dir: 'cards' } }, /absolute path/],
    ['a bad gate', { gate: { concurrency: 0 } }, /gate concurrency/],
    ['a bad crawler sample', { crawlerEvents: { sample: 0 } }, /crawlerEvents\.sample/],
    ['a url as an image host', { allowedImageHosts: ['https://cdn.test'] }, /bare hostname/],
    ['a css injection as a brand colour', { brand: { ink: 'red; background:url(x)' } }, /brand\.ink/],
    [
      'a static card colliding with a target kind',
      { static: { a: { path: '/og/x.png', kind: 'posts', slug: 'a', template: 'post', props: () => ({}) } } },
      /collides with a target kind/,
    ],
    [
      'a static card with a dot slug',
      { static: { a: { path: '/og/x.png', kind: 'index', slug: '..', template: 'post', props: () => ({}) } } },
      /unusable slug/,
    ],
    [
      'a static card with an unknown template',
      { static: { a: { path: '/og/x.png', kind: 'index', slug: 'a', template: 'ghost', props: () => ({}) } } },
      /unknown template "ghost"/,
    ],
    ['a target depth that is not an integer', { targets: { posts: defineTarget<any, any>({ ...posts, depth: 1.5 }) } }, /depth/],
  ])('refuses %s', (_, over, message) => expect(() => apply(options(over as Partial<OgImagePluginOptions>))).toThrow(message))
  it('refuses a config with no absolute serverURL', () => {
    expect(() => apply(options(), { ...baseConfig(), serverURL: '' })).toThrow(/absolute `serverURL`/)
    expect(() => apply(options(), { ...baseConfig(), serverURL: 'ftp://x' })).toThrow(/absolute `serverURL`/)
  })
})

describe('ogImagePlugin: start-up self-test (onInit)', () => {
  const run = (o: OgImagePluginOptions) => apply(o).onInit?.({} as never)
  it('passes with fonts that draw the required sample', async () => {
    await expect(run(options({ requiredSample: 'Aa' }))).resolves.toBeUndefined()
  })
  it('throws outside production when a stack cannot draw the sample, naming the stack and the glyphs', async () => {
    await expect(run(options({ requiredSample: 'Aa🚀' }))).rejects.toThrow(/stack "default" cannot draw "🚀"/)
  })
  it('throws outside production for WOFF2, naming the family', async () => {
    const woff2 = options({ fonts: [{ family: 'Inter', data: async () => new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]) }] })
    await expect(run(woff2)).rejects.toThrow(/"Inter" is WOFF2/)
  })
  it('in production it logs through the event sink instead of throwing', async () => {
    const events: Array<{ detail?: { message?: string } }> = []
    vi.stubEnv('NODE_ENV', 'production')
    try {
      await expect(run(options({ requiredSample: 'Aa🚀', onEvent: (e) => events.push(e) }))).resolves.toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
    }
    expect(events[0]?.detail?.message).toMatch(/start-up check failed.*🚀/)
  })
})
