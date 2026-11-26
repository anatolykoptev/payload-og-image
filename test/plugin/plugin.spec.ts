/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a misconfigured plugin that boots and serves nothing, or one that changes the schema.
 * - index.ts:78-79  drop the credentials check / the path-query-fragment check -> "refuses a serverURL option with credentials" (and path, query, fragment) RED
 * - index.ts:80  keep the origin as given (no `u.origin`) -> "normalises options.serverURL to its origin" RED
 * - internal/colour.ts:8  accept any 3-8 digit hex -> "a 5-digit hero background", "... with alpha" RED
 * - internal/colour.ts:8  accept a colour name -> "a named hero background" RED
 * - index.ts:71  ignore `options.serverURL` (use the config's only) -> "ogImagePlugin: serverURL option > builds card URLs on options.serverURL" RED
 * - index.ts:64  no `default` stack required -> "refuses no default stack" RED
 * - index.ts `assertUploadCollections` not called from onInit (or checking `config.collections` at apply time instead of the registry) -> "3b: heroCollection and imageCollections must name upload collections of the FINAL config, checked at init" RED
 * - index.ts:82  accept a target on a missing collection -> "3: a target whose collection does not exist throws" RED
 * - index.ts:83  accept an unknown template -> "2: a target naming an unknown template throws" RED
 * - index.ts:85  skip the duplicate-kind check -> "4: two targets with the same kind throw" RED
 * - index.ts:137  drop the existing afterChange hooks -> "5: siteGlobals get an afterChange hook ... after the existing hooks" RED
 * - index.ts `withUploadPurge` not applied to an upload collection (or hooks not chained after the existing ones) -> "an upload collection purges the cards that drew an upload on change and on delete" RED
 * - index.ts `idOf(doc, previousDoc)` -> `doc.id` only -> "... a hook before ours may return a projection with no id" part of the same test RED
 * - index.ts:142  add a field to a collection -> "6: the plugin is schema-neutral" RED
 * - index.ts:161  skip the glyph self-test -> "throws outside production when a stack cannot draw the sample" RED
 * - index.ts:170  always throw, even in production -> "in production it logs through the event sink instead of throwing" RED
 * - index.ts:146  run the self-test when disabled -> "7: disabled keeps the config valid and runs no start-up checks" RED
 * - index.ts:105  accept a relative store dir -> "refuses a relative store dir" RED
 * - index.ts:115  accept a crawler sample outside (0, 1] -> "refuses a crawler sample of 0 / above 1 / NaN" RED
 * - index.ts:111  accept `editors` naming a collection that is not an auth collection -> "refuses editors naming a non-auth collection" RED
 * - index.ts:108  skip validating `admission` -> "refuses a bad admission gate" RED */
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
  it('3b: heroCollection and imageCollections must name upload collections of the FINAL config, checked at init', async () => {
    const withTarget = (over: Record<string, unknown>) => options({ targets: { posts: defineTarget<any, any>({ ...posts, ...over }) } })
    // What Payload hands onInit: every collection of the final, sanitized config.
    const init = (c: Config) =>
      c.onInit?.({ collections: Object.fromEntries((c.collections ?? []).map((x) => [x.slug, { config: x }])) } as never)
    const laterPlugin = (c: Config): Config => ({
      ...c,
      collections: [...(c.collections ?? []), { slug: 'media', upload: true, fields: [] }, { slug: 'authors', fields: [] }],
    })
    // A later plugin adds the upload collection: applying ours does not refuse, and init passes.
    const ok = laterPlugin(apply(withTarget({ heroCollection: 'media', imageCollections: { logo: 'media' } })))
    await expect(init(ok)).resolves.toBeUndefined()
    // A slug that is not an upload collection in the final config fails, named.
    await expect(init(laterPlugin(apply(withTarget({ heroCollection: 'authors' }))))).rejects.toThrow(
      /target "posts" heroCollection "authors" is not an upload collection/,
    )
    await expect(init(laterPlugin(apply(withTarget({ heroCollection: 'ghost' }))))).rejects.toThrow(
      /heroCollection "ghost" is not an upload/,
    )
    await expect(init(laterPlugin(apply(withTarget({ imageCollections: { logo: 'authors' } }))))).rejects.toThrow(
      /imageCollections\.logo "authors" is not an upload collection/,
    )
    await expect(init(laterPlugin(apply(withTarget({ imageCollections: { logo: 'constructor' } }))))).rejects.toThrow(/"constructor"/)
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
  it('6: the plugin is schema-neutral: no fields, jobs, hooks or access are added, and its one endpoint is the admin-only /stats', () => {
    const before = baseConfig()
    const after = apply(options(), baseConfig())
    expect(after.collections).toEqual(before.collections)
    expect(after.globals).toEqual(before.globals)
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), 'custom', 'endpoints', 'onInit'].sort())
    expect((after.endpoints ?? []).map((e) => `${e.method} ${e.path}`)).toEqual(['get /payload-og-image/stats']) // the one admin-only read endpoint
    expect(after.jobs).toBeUndefined()
  })
  it('an upload collection purges the cards that drew an upload on change and on delete, after its own hooks; other collections are untouched', async () => {
    const mine = vi.fn()
    const base = baseConfig()
    base.collections = [...(base.collections ?? []), { slug: 'media', upload: true, fields: [], hooks: { afterChange: [mine] } }] as never
    const c = apply(options(), base)
    expect(c.collections?.[0]).toBe(base.collections?.[0])
    const purge = vi.spyOn(stateOf(c).uploads, 'purge').mockResolvedValue(1)
    const hooks = c.collections?.[1]?.hooks
    const change = (hooks?.afterChange ?? []) as Array<(a: unknown) => unknown>
    expect(change).toHaveLength(2)
    expect(change[0]).toBe(mine)
    await change[1]?.({ doc: { id: 9, updatedAt: '2026-02-01T00:00:00.000Z' }, previousDoc: { id: 9 } })
    await ((hooks?.afterDelete ?? []) as Array<(a: unknown) => unknown>)[0]?.({ id: 7, doc: { id: 7 } })
    expect(purge.mock.calls).toEqual([
      ['media', 9, { updatedAt: '2026-02-01T00:00:00.000Z' }],
      ['media', 7, { deleted: true }],
    ])
    // A draft save purges but sets no floor: the published version keeps its older updatedAt.
    purge.mockClear()
    await change[1]?.({ doc: { id: 9, _status: 'draft', updatedAt: '2026-03-01T00:00:00.000Z' }, previousDoc: { id: 9 } })
    expect(purge.mock.calls).toEqual([['media', 9, undefined]])
    // A hook before ours may return a projection with no id: Payload's own previousDoc still names the upload.
    purge.mockClear()
    await change[1]?.({ doc: { title: 'projected' }, previousDoc: { id: 9 } })
    expect(purge.mock.calls).toEqual([['media', 9, undefined]])
    // A failing purge never fails the editor's save: it is an event.
    purge.mockRejectedValue(new Error('disk gone'))
    await expect(change[1]?.({ doc: { id: 9 } })).resolves.toBeUndefined()
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
    ['a bad admission gate', { admission: { queue: -1 } }, /gate queue/],
    ['editors naming a non-auth collection', { editors: ['posts'] }, /editors names "posts", which is not an auth collection/],
    ['a crawler sample of 0', { crawlerEvents: { sample: 0 } }, /crawlerEvents\.sample/],
    ['a crawler sample above 1', { crawlerEvents: { sample: 2 } }, /crawlerEvents\.sample/],
    ['a NaN crawler sample', { crawlerEvents: { sample: Number.NaN } }, /crawlerEvents\.sample/],
    ['a url as an image host', { allowedImageHosts: ['https://cdn.test'] }, /bare hostname/],
    ['a css injection as the hero background', { heroBackground: 'red; background:url(x)' }, /heroBackground must be #rgb or #rrggbb/],
    ['a 5-digit hero background', { heroBackground: '#12345' }, /heroBackground must be #rgb or #rrggbb/],
    ['a hero background with alpha (#rrggbbaa)', { heroBackground: '#11223344' }, /heroBackground must be #rgb or #rrggbb/],
    ['a hero background with alpha (#rgba)', { heroBackground: '#1234' }, /heroBackground must be #rgb or #rrggbb/],
    ['a named hero background', { heroBackground: 'red' }, /heroBackground must be #rgb or #rrggbb/],
    ['a non-hex digit in the hero background', { heroBackground: '#12g456' }, /heroBackground must be #rgb or #rrggbb/],
    ['a non-string hero background', { heroBackground: 5 as never }, /heroBackground must be #rgb or #rrggbb/],
    ['a palette of 1 colour', { palette: { card: 1 } }, /palette\.card must be false or an integer from 2 to 256/],
    ['a palette above 256 colours', { palette: { hero: 257 } }, /palette\.hero must be false or an integer from 2 to 256/],
    ['a fractional palette', { palette: { card: 16.5 } }, /palette\.card must be false or an integer/],
    ['a palette of true', { palette: { hero: true as never } }, /palette\.hero must be false or an integer/],
    ['a palette that is not an object', { palette: 16 as never }, /palette must be an object/],
    ['an unknown palette key', { palette: { cards: 16 } as never }, /palette\.cards is not an option/],
    ['a serverURL option with credentials', { serverURL: 'https://u:p@cards.test' }, /options\.serverURL must be an http\(s\) origin/],
    ['a serverURL option with a path', { serverURL: 'https://cards.test/app' }, /options\.serverURL must be an http\(s\) origin/],
    ['a serverURL option with a query', { serverURL: 'https://cards.test/?a=1' }, /options\.serverURL must be an http\(s\) origin/],
    ['a serverURL option with a fragment', { serverURL: 'https://cards.test/#x' }, /options\.serverURL must be an http\(s\) origin/],
    ['a serverURL option that is not http(s)', { serverURL: 'ftp://cards.test' }, /options\.serverURL must be an http\(s\) origin/],
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
  ])('refuses %s', (_, over, message) => expect(() => apply(options(over as Partial<OgImagePluginOptions>))).toThrow(message))
  it('refuses a config with no absolute serverURL', () => {
    expect(() => apply(options(), { ...baseConfig(), serverURL: '' })).toThrow(/absolute `serverURL`/)
    expect(() => apply(options(), { ...baseConfig(), serverURL: 'ftp://x' })).toThrow(/absolute `serverURL`/)
  })
})

describe('ogImagePlugin: serverURL option', () => {
  it('builds card URLs on options.serverURL, so the Payload config needs none of its own', () => {
    const cfg = { ...baseConfig(), serverURL: '' }
    const out = ogImagePlugin(options({ serverURL: 'https://cards.test' }))(cfg) as { custom: Record<string, { serverUrl: string }> }
    expect(Object.values(out.custom)[0]?.serverUrl).toBe('https://cards.test')
  })
  it('normalises options.serverURL to its origin (a trailing slash or default port is dropped)', () => {
    for (const given of ['https://cards.test/', 'https://cards.test:443', 'HTTPS://Cards.Test']) {
      const out = ogImagePlugin(options({ serverURL: given }))({ ...baseConfig(), serverURL: '' }) as {
        custom: Record<string, { serverUrl: string }>
      }
      expect(Object.values(out.custom)[0]?.serverUrl, given).toBe('https://cards.test')
    }
  })
  it('keeps the config fallback as it was (no origin rule on config.serverURL)', () => {
    const out = ogImagePlugin(options())({ ...baseConfig(), serverURL: 'https://x.test/base' }) as {
      custom: Record<string, { serverUrl: string }>
    }
    expect(Object.values(out.custom)[0]?.serverUrl).toBe('https://x.test/base')
  })
  it('refuses a relative options.serverURL even when the config has an absolute one', () => {
    expect(() => apply(options({ serverURL: '/relative' }))).toThrow(/options\.serverURL must be an http\(s\) origin/)
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
