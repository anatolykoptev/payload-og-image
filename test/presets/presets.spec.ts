/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a preset that draws outside the safe zone, serves the wrong file, moves a site's URLs or picks the wrong preset gives no error in production.
 * - handler.ts the `:ext` file-name check removed -> "a photo card is served as card.jpg only" RED
 * - expand.ts `fonts: o.fonts ?? ...` made `[...(o.fonts ?? []), ...BUNDLED_FONTS]` -> "a site with fonts of its own keeps its font digest" RED
 * - spec.ts `TEXT.foot.y` 500 -> 560 -> "every box of both layouts stays in the safe zone" RED
 * - target.ts `eligibleHero` ignores HERO_MIN -> "the preset follows the hero" RED
 * - target.ts `choosePreset` ignores `preset: 'text'` -> "the preset follows the hero" RED
 * - fonts.ts one face registration removed (a subset missing) -> "the bundled faces draw ..." RED
 * - layout.ts the `weight` argument of `ctx.font` dropped at a call site (title, name or foot, either layout) -> "a family whose bold face lacks Cyrillic is not the family of a bold preset run" RED
 * - draw.ts `fitRow` drops the lowest priority number instead of the highest -> "fitRow drops whole items" RED */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Config } from 'payload'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { templateContext } from '../../src/internal/draw.js'
import { fontFamilyFor, loadFonts, measureText, missingGlyphs } from '../../src/internal/fonts.js'
import { ogImagePlugin } from '../../src/plugin/index.js'
import { expandPresets } from '../../src/presets/expand.js'
import { FONT_DATA } from '../../src/presets/fontData.js'
import { BUNDLED_FONTS, BUNDLED_STACKS } from '../../src/presets/fonts.js'
import { type PresetProps, photoLayout, textLayout } from '../../src/presets/layout.js'
import { HERO_MIN, IMAGE_BOXES, SLOTS, TEXT_SHAPES, ZONE } from '../../src/presets/spec.js'
import { choosePreset, eligibleHero } from '../../src/presets/target.js'
import { textPreset } from '../../src/presets/templates.js'
import { payloadHeroLoader } from '../../src/render/hero.js'
import { nextOgRenderer } from '../../src/render/nextOg.js'
import { defineTemplate, type TemplateContext } from '../../src/template.js'
import { loadTestFonts } from '../helpers.js'
import { configOf, presetHarness, upload } from './harness.js'

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')
const bundled = loadFonts(BUNDLED_FONTS)
const rowOf = (ctx: TemplateContext) => ctx.fitRow as NonNullable<TemplateContext['fitRow']>
const ctxOf = async (images: Record<string, string[]> = {}) => {
  const { fonts } = await bundled
  return templateContext({ host: 'example.test', fonts, stacks: BUNDLED_STACKS, hero: 'data:x', images: images as never })
}

describe('the bundled faces', () => {
  it('draw Aa’‘“”–—…«»„№ĄŁŐŞțđ and a Cyrillic sample from the stack, and nothing is missing', async () => {
    const { fonts } = await bundled
    const sample = 'Aa’‘“”–—…«»„№ĄŁŐŞțđ Съешь же ещё этих мягких французских булок ЁёЙй'
    expect(missingGlyphs(fonts, BUNDLED_STACKS.default as string[], sample)).toEqual([])
    expect(new Set(fonts.map((f) => `${f.family}|${f.weight}`)).size).toBe(6)
  })
  it('are the very bytes of fonts/ (the embedded module cannot drift from the files that ship with the licence)', () => {
    for (const [file, b64] of Object.entries(FONT_DATA)) {
      expect(sha(Buffer.from(b64, 'base64')), file).toBe(sha(readFileSync(path.resolve('fonts', file))))
    }
    expect(readFileSync(path.resolve('fonts/OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })
})

describe('expansion', () => {
  it('a site with fonts of its own keeps its font digest and stacks: the bundled faces are not added', async () => {
    const own = [{ family: 'Mine', data: async () => readFileSync(path.resolve('test/fixtures/fonts/inter-latin-cyrillic-800.woff')) }]
    const stacks = { default: ['Mine'] }
    const o = expandPresets({ collections: ['posts'], fonts: own, stacks }, configOf())
    expect(o.stacks).toBe(stacks)
    expect((await loadFonts(o.fonts)).digest).toBe((await loadFonts(own)).digest)
    expect(o.fonts.map((f) => f.family)).toEqual(['Mine'])
  })
  it('a site with no fonts gets the bundled ones, a memory store, a site named after the serverURL host, and the presets as templates', async () => {
    const o = expandPresets({ collections: ['posts', { slug: 'people', label: 'Team' }] }, configOf())
    expect(o.stacks).toBe(BUNDLED_STACKS)
    expect(o.store).toEqual({ memory: true })
    expect((await o.site({ payload: {} as never })).name).toBe('example.test')
    expect(o.templates.map((t) => t.id).sort()).toEqual(['payload-og-image:photo', 'payload-og-image:text'])
    expect(Object.keys(o.targets)).toEqual(['posts', 'people'])
    expect(o.targets.people?.path).toBe('/og/:kind/:id/card.:ext') // no slug field: keyed by id
    expect(o.targets.posts?.heroCollection).toBe('media')
  })
  it('refuses what cannot work, by name', () => {
    expect(() => expandPresets({ collections: [] }, configOf())).toThrow(/at least one collection/)
    expect(() => expandPresets({ collections: ['nope'] }, configOf())).toThrow(/"nope", which is not a collection/)
    expect(() => expandPresets({ collections: ['users'] }, configOf())).toThrow(/auth collection/)
    expect(() => expandPresets({ collections: ['media'] }, configOf())).toThrow(/upload collection/)
    expect(() =>
      expandPresets({ collections: ['people2'] }, configOf({ collections: [{ slug: 'people2', fields: [] }] } as never)),
    ).toThrow(/has no title field/)
    expect(() => expandPresets({ collections: [{ slug: 'people', preset: 'photo' }] }, configOf())).toThrow(/needs a hero upload field/)
    expect(() => expandPresets({ collections: [{ slug: 'posts', title: 'nope' }] }, configOf())).toThrow(/is not a text or textarea field/)
    expect(() => expandPresets({ exclude: ['nope'] }, configOf())).toThrow(/exclude names "nope"/)
  })
  it('a custom path must end in .:ext, and a fixed path cannot serve both encodings: refused at start-up for presets and hand-written targets alike', () => {
    const plugin = (o: unknown) => () => ogImagePlugin(o as never)(configOf())
    expect(plugin({ collections: [{ slug: 'posts', path: '/og/:kind/:slug/card.png' }] })).toThrow(/needs :ext/)
    expect(plugin({ collections: [{ slug: 'posts', path: '/og/:ext/:slug/card' }] })).toThrow(
      /must hold :ext only as the end of its file name/,
    )
    expect(plugin({ collections: [{ slug: 'posts', path: '/og/:kind/:slug/card.:ext' }] })).not.toThrow()
    // a hand-written target: a template that is a JPEG under a literal .png path, with a PNG plugin default
    const jpegTemplate = defineTemplate<{ title: string }>({
      id: 'j',
      revision: '1',
      format: 'jpeg',
      render: () => ({ type: 'div', props: {} }) as never,
    })
    const classic = (path: string) => ({
      site: () => ({ name: 'S' }),
      fonts: BUNDLED_FONTS,
      stacks: BUNDLED_STACKS,
      store: { memory: true },
      templates: [jpegTemplate],
      targets: { posts: { path, template: 'j', props: () => ({ title: 't' }) } },
    })
    expect(plugin(classic('/og/:kind/:slug/card.png'))).toThrow(/ends in \.png but the card is a JPEG/)
    expect(plugin(classic('/og/:kind/:slug/card.jpg'))).not.toThrow()
  })
})

describe('the plugin serves every public page on its own', () => {
  const read = (fn: unknown) => ({ access: { read: fn } })
  const config = configOf({
    collections: [
      { slug: 'users', auth: true, fields: [{ name: 'name', type: 'text' }], ...read(() => true) },
      { slug: 'media', upload: { staticDir: '/x' }, fields: [], ...read(() => true) },
      {
        slug: 'posts',
        labels: { plural: 'Blog' },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
        ],
        ...read(() => true),
      },
      { slug: 'pages', fields: [{ name: 'title', type: 'text' }], ...read(() => ({ _status: { equals: 'published' } })) }, // a Where: public
      { slug: 'private', fields: [{ name: 'title', type: 'text' }], ...read(({ req }: { req: { user?: unknown } }) => Boolean(req.user)) },
      { slug: 'nodefault', fields: [{ name: 'title', type: 'text' }] }, // no access.read: Payload's default needs a login
      {
        slug: 'throws',
        fields: [{ name: 'title', type: 'text' }],
        ...read(() => {
          throw new Error('needs payload')
        }),
      },
      { slug: 'later', fields: [{ name: 'title', type: 'text' }], ...read(async () => true) },
      { slug: 'untitled', fields: [{ name: 'body', type: 'text' }], ...read(() => true) },
      {
        slug: 'hiddenTitle',
        admin: { useAsTitle: 'internalName' },
        fields: [{ name: 'internalName', type: 'text', admin: { hidden: true } }],
        ...read(() => true),
      },
      { slug: 'secret', fields: [{ name: 'title', type: 'text' }], ...read(() => true) },
    ],
  } as never)
  it('exactly the public, titled, non-upload, non-auth, non-excluded collections get a card, and the rest are named once, with the reason', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const o = expandPresets({ exclude: ['secret'] }, config)
      expect(Object.keys(o.targets)).toEqual(['posts', 'pages'])
      expect(o.targets.posts?.path).toBe('/og/:kind/:slug/card.:ext')
      expect(o.targets.pages?.path).toBe('/og/:kind/:id/card.:ext')
      expect(warn).toHaveBeenCalledTimes(1)
      const line = String(warn.mock.calls[0]?.[0])
      for (const name of ['private', 'nodefault', 'throws', 'later', 'untitled', 'hiddenTitle']) expect(line, name).toContain(name)
      for (const name of ['posts', 'pages', 'users', 'media', 'secret'])
        expect(line, name).not.toMatch(new RegExp(`(^|; |for )${name} \\(`))
    } finally {
      warn.mockRestore()
    }
  })
  it('collections as an object customises one and adds others; explicit targets win and are untouched; a list is exactly those', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const mine = { path: '/og/:kind/:slug/card.png', template: 'x', props: () => ({}) }
      const o = expandPresets(
        { exclude: ['secret'], collections: { posts: { preset: 'text', label: 'News' }, private: {} }, targets: { pages: mine } } as never,
        config,
      )
      expect(Object.keys(o.targets)).toEqual(['pages', 'posts', 'private'])
      expect(o.targets.pages).toBe(mine)
      expect(Object.keys(expandPresets({ collections: ['posts'] }, config).targets)).toEqual(['posts'])
    } finally {
      warn.mockRestore()
    }
  })
  it('a fresh install with nothing configured boots: no collection qualifies is a line, not a crash', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(expandPresets({}, configOf({ collections: [{ slug: 'users', auth: true, fields: [] }] } as never)).targets).toEqual({})
    } finally {
      warn.mockRestore()
    }
  })
  it('a collection slug of __proto__ is an own target, not dropped by assignment', () => {
    const c = configOf({ collections: [{ slug: '__proto__', fields: [{ name: 'title', type: 'text' }], ...read(() => true) }] } as never)
    const o = expandPresets({}, c)
    expect(Object.hasOwn(o.targets, '__proto__')).toBe(true)
  })
})

describe("start-up cannot be ended by the site's own access functions or a missing serverURL", () => {
  const titled = (access: unknown) =>
    configOf({
      collections: [
        {
          slug: 'posts',
          access: { read: access },
          fields: [
            { name: 'title', type: 'text' },
            { name: 'slug', type: 'text' },
          ],
        },
      ],
    } as never)
  it('an async access.read that rejects (it needs req.payload) skips the collection and is never an unhandled rejection', async () => {
    const seen: unknown[] = []
    const listener = (e: unknown) => seen.push(e)
    process.on('unhandledRejection', listener)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const o = expandPresets(
        {},
        titled(async () => {
          throw new Error('needs payload')
        }),
      )
      expect(o.targets).toEqual({})
      expect(String(warn.mock.calls[0]?.[0])).toContain('async and cannot be evaluated')
      // a field-level async rule too
      const field = configOf({
        collections: [
          {
            slug: 'posts',
            access: { read: () => true },
            fields: [
              {
                name: 'title',
                type: 'text',
                access: {
                  read: async () => {
                    throw new Error('x')
                  },
                },
              },
            ],
          },
        ],
      } as never)
      expect(expandPresets({ collections: ['posts'] } as never, field)).toBeDefined
      await new Promise((r) => setTimeout(r, 20))
      await new Promise((r) => setImmediate(r))
      expect(seen).toEqual([])
    } catch (e) {
      if (!String((e as Error).message).includes('no title field')) throw e
      await new Promise((r) => setTimeout(r, 20))
      expect(seen).toEqual([])
    } finally {
      process.off('unhandledRejection', listener)
      warn.mockRestore()
    }
  })
  it('a function that throws is told apart from one that denies, in the start-up line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expandPresets(
        {},
        titled(() => {
          throw new Error('needs payload')
        }),
      )
      expect(String(warn.mock.calls[0]?.[0])).toContain('cannot be evaluated when the config is built')
      warn.mockClear()
      expandPresets(
        {},
        titled(() => false),
      )
      expect(String(warn.mock.calls[0]?.[0])).toContain('does not let an anonymous request read it')
    } finally {
      warn.mockRestore()
    }
  })
  it('the plugin boots with no serverURL anywhere, with zero discovered targets and with discovered ones, and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const bare = (c: Config) => ({ ...c, serverURL: undefined }) as Config
      const none = ogImagePlugin({})(bare(configOf({ collections: [{ slug: 'users', auth: true, fields: [] }] } as never)))
      expect(none.custom?.['payload-og-image']?.serverUrl).toBe('http://localhost:3000')
      const some = ogImagePlugin({})(bare(titled(() => true)))
      expect(some.custom?.['payload-og-image']?.serverUrl).toBe('http://localhost:3000')
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('no serverURL is set')).length).toBe(2) // once per install
      // a classic install still needs its origin
      expect(() =>
        ogImagePlugin({
          site: () => ({ name: 'S' }),
          fonts: BUNDLED_FONTS,
          stacks: BUNDLED_STACKS,
          templates: [],
          targets: {},
          store: { memory: true },
        })(bare(configOf())),
      ).toThrow(/absolute `serverURL`/)
      // a serverURL that is set but wrong is still refused
      expect(() => ogImagePlugin({ serverURL: 'not a url' })(configOf())).toThrow(/serverURL must be an http\(s\) origin/)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('restrictions are carried through every container, and into the og overrides', () => {
  const posts = (fields: unknown[]) =>
    configOf({
      collections: [
        { slug: 'posts', access: { read: () => true }, fields },
        { slug: 'media', upload: { staticDir: '/x' }, fields: [] },
      ],
    } as never)
  const title = { name: 'title', type: 'text' }
  it('a title under a hidden tab, a hidden tabs wrapper, a hidden row or a hidden collapsible is not detected', () => {
    const t = (fields: unknown[]) => () => expandPresets({ collections: ['posts'] }, posts(fields))
    expect(t([{ type: 'tabs', tabs: [{ label: 'T', admin: { hidden: true }, fields: [title] }] }])).toThrow(/no title field/)
    expect(t([{ type: 'tabs', tabs: [{ name: 'g', label: 'T', access: { read: () => false }, fields: [title] }] }])).toThrow(
      /no title field/,
    )
    expect(t([{ type: 'tabs', admin: { hidden: true }, tabs: [{ label: 'T', fields: [title] }] }])).toThrow(/no title field/)
    expect(t([{ type: 'row', admin: { hidden: true }, fields: [title] }])).toThrow(/no title field/)
    expect(t([{ type: 'collapsible', label: 'C', admin: { hidden: true }, fields: [title] }])).toThrow(/no title field/)
    expect(t([{ type: 'tabs', tabs: [{ label: 'T', fields: [title] }] }])).not.toThrow()
  })
  it('og.headline and og.subtitle that the collection hides are never drawn; ones that are allowed (or absent) still are', async () => {
    const hidden = posts([
      title,
      { name: 'slug', type: 'text' },
      {
        type: 'group',
        name: 'og',
        fields: [
          { name: 'headline', type: 'text', admin: { hidden: true } },
          { name: 'subtitle', type: 'text' },
        ],
      },
    ])
    const h = await presetHarness({
      config: hidden,
      input: { collections: ['posts'] },
      docs: { a: { id: 1, slug: 'a', title: 'Real title', og: { headline: 'ADMIN ONLY', subtitle: 'Public sub' } } },
    })
    const c = await h.resolve('posts', 'a')
    if (c.kind !== 'generated') throw new Error('expected a generated card')
    expect(c.props.title).toBe('Real title')
    expect(c.props.subtitle).toBe('Public sub')
  })
})

describe('paths and precedence', () => {
  it('an expanded preset path must carry a document key', () => {
    expect(() => expandPresets({ collections: [{ slug: 'posts', path: '/og/posts/card.:ext' }] }, configOf())).toThrow(/needs :slug or :id/)
  })
  it('adding presets does not retire a classic .png route whose own template is a PNG', () => {
    const png = defineTemplate<{ title: string }>({ id: 'png', revision: '1', render: () => ({ type: 'div', props: {} }) as never })
    const o = {
      site: () => ({ name: 'S' }),
      fonts: BUNDLED_FONTS,
      stacks: BUNDLED_STACKS,
      store: { memory: true },
      templates: [png],
      collections: ['posts'],
      targets: {
        classic: { collection: 'people', path: '/og/:kind/:slug/card.png', template: () => 'png', props: () => ({ title: 't' }) },
      },
    }
    expect(() => ogImagePlugin(o as never)(configOf())).not.toThrow()
  })
  it('a collection with an explicit target of its own name, or in exclude, is left alone: no error', () => {
    const mine = { path: '/og/:kind/:slug/card.png', template: 'x', props: () => ({}) }
    const o = expandPresets({ collections: ['posts', 'people'], exclude: ['people'], targets: { posts: mine } } as never, configOf())
    expect(Object.keys(o.targets)).toEqual(['posts'])
    expect(o.targets.posts).toBe(mine)
  })
  it('a share image from another upload collection with the same id is still a deliberate share image on a forced-text card', async () => {
    const config = configOf({
      collections: [
        { slug: 'users', auth: true, fields: [] },
        {
          slug: 'articles',
          fields: [
            { name: 'title', type: 'text' },
            { name: 'slug', type: 'text' },
            { name: 'heroImage', type: 'upload', relationTo: 'media' },
            { type: 'group', name: 'meta', fields: [{ name: 'image', type: 'upload', relationTo: 'photos' }] },
          ],
        },
        { slug: 'media', upload: { staticDir: '/x' }, fields: [] },
        { slug: 'photos', upload: { staticDir: '/y' }, fields: [] },
      ],
    } as never)
    const doc = {
      id: 1,
      slug: 's',
      title: 'Same id',
      heroImage: upload(1, 'hero.jpg', 640, 360),
      meta: { image: upload(1, 'photo.jpg', 1200, 800) },
    }
    const h = await presetHarness({
      config,
      uploads: null,
      input: { collections: { articles: { preset: 'text' } } } as never,
      docs: { s: doc },
    })
    expect((await h.resolve('articles', 's')).kind).toBe('own')
  })
})

describe('what is auto-detected is what the public may see', () => {
  const posts = (fields: unknown[], extra: Record<string, unknown> = {}) =>
    configOf({
      collections: [
        { slug: 'posts', access: { read: () => true }, fields, ...extra },
        { slug: 'media', upload: { staticDir: '/x' }, fields: [] },
      ],
    } as never)
  const title = { name: 'title', type: 'text' }
  it('a hidden title (admin.hidden, hidden, an access.read that says no, a hidden group, hasMany, an internal name) is never drawn: the next candidate, or a named error', () => {
    const t = (config: Config) => expandPresets({ collections: ['posts'] }, config)
    expect(() => t(posts([{ name: 'title', type: 'text', admin: { hidden: true } }]))).toThrow(/no title field.*title is hidden/)
    expect(() => t(posts([{ name: 'title', type: 'text', hidden: true }]))).toThrow(/no title field/)
    expect(() => t(posts([{ name: 'title', type: 'text', access: { read: () => false } }]))).toThrow(/title is not publicly readable/)
    expect(() =>
      t(posts([{ type: 'group', name: 'g', admin: { hidden: true }, fields: [title] }], { admin: { useAsTitle: 'g.title' } })),
    ).toThrow(/no title field/)
    expect(() => t(posts([{ name: 'title', type: 'text', hasMany: true }]))).toThrow(/no title field/)
    expect(() => t(posts([{ name: '_internal', type: 'text' }], { admin: { useAsTitle: '_internal' } }))).toThrow(/no title field/)
    // useAsTitle names an admin-only field, but a public `name` exists: it is used instead
    const ok = t(
      posts(
        [
          { name: 'internalName', type: 'text', admin: { hidden: true } },
          { name: 'name', type: 'text' },
        ],
        { admin: { useAsTitle: 'internalName' } },
      ),
    )
    expect(ok.targets.posts).toBeDefined()
    expect(() =>
      expandPresets(
        { collections: [{ slug: 'posts', title: 'internalName' }] },
        posts([{ name: 'internalName', type: 'text', admin: { hidden: true } }]),
      ),
    ).toThrow(/cannot be drawn on a public card \(hidden\)/)
  })
  it('a hidden or private hero is not detected, and a hidden slug field keys the path by id', () => {
    const heroless = expandPresets(
      { collections: ['posts'] },
      posts([title, { name: 'hero', type: 'upload', relationTo: 'media', admin: { hidden: true } }]),
    )
    expect(heroless.targets.posts?.heroCollection).toBeUndefined()
    const seen = expandPresets(
      { collections: ['posts'] },
      posts([title, { name: 'hero', type: 'upload', relationTo: 'media' }, { name: 'slug', type: 'text', admin: { hidden: true } }]),
    )
    expect(seen.targets.posts?.heroCollection).toBe('media')
    expect(seen.targets.posts?.path).toBe('/og/:kind/:id/card.:ext')
  })
})

describe('scoped editor image, and no collection that cannot draw', () => {
  const articles = configOf({
    collections: [
      { slug: 'users', auth: true, fields: [] },
      {
        slug: 'articles',
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
          { type: 'group', name: 'meta', fields: [{ name: 'image', type: 'upload', relationTo: 'media' }] },
        ],
      },
      {
        slug: 'plain',
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
        ],
      },
      { slug: 'media', upload: { staticDir: '/x' }, fields: [] },
    ],
  } as never)
  const big = upload(1, 'hero.jpg', 1200, 800)
  it('a collection with meta.image does not give the whole plugin a seoImage: the option stays unset and only that target honours it', () => {
    const o = expandPresets(
      { collections: ['articles'], targets: { classic: { path: '/og/:kind/:slug/card.png', template: 'x', props: () => ({}) } } } as never,
      articles,
    )
    expect(o.seoImage).toBeUndefined()
    expect(o.targets.articles?.seoImage?.path).toBe('meta.image')
    expect(o.targets.classic?.seoImage).toBeUndefined()
  })
  it('a classic target next to a preset keeps drawing its generated card for a document with an eligible meta.image', async () => {
    const classic = defineTemplate<{ title: string }>({
      id: 'classic',
      revision: '1',
      render: () => ({ type: 'div', props: { style: { display: 'flex' }, children: 'x' } }) as never,
    })
    const h = await presetHarness({
      config: articles,
      input: {
        collections: ['articles'],
        templates: [classic],
        targets: {
          classicposts: {
            collection: 'plain',
            path: '/og/:kind/:slug/card.png',
            template: 'classic',
            props: ({ doc }: { doc: { title: string } }) => ({ title: doc.title }),
          },
        },
      } as never,
      docs: { a: { id: 1, slug: 'a', title: 'A', meta: { image: big } } },
    })
    const c = await h.handler.resolve(
      { target: 'classicposts', doc: { id: 1, slug: 'a', title: 'A', meta: { image: big } } },
      { previewing: false },
    )
    expect(c.kind).toBe('generated')
  })
  it('a hero that is also the editor image stays a generated card when the text preset is forced: the identity is compared, not whether the text card draws it', async () => {
    const doc = { id: 1, slug: 'a', title: 'A forced text card', meta: { image: big } }
    for (const preset of ['text', 'auto'] as const) {
      const h = await presetHarness({ config: articles, input: { collections: { articles: { preset } } } as never, docs: { a: doc } })
      const c = await h.resolve('articles', 'a')
      expect(c.kind, preset).toBe('generated')
      if (c.kind === 'generated') expect(c.template.id).toBe(preset === 'text' ? 'payload-og-image:text' : 'payload-og-image:photo')
    }
  })
  it('a separate editor image that is the very upload of the hero is still no deliberate share image', async () => {
    const withHero = configOf({
      collections: [
        {
          slug: 'articles',
          fields: [
            { name: 'title', type: 'text' },
            { name: 'slug', type: 'text' },
            { name: 'heroImage', type: 'upload', relationTo: 'media' },
            { type: 'group', name: 'meta', fields: [{ name: 'image', type: 'upload', relationTo: 'media' }] },
          ],
        },
        { slug: 'media', upload: { staticDir: '/x' }, fields: [] },
      ],
    } as never)
    const same = {
      id: 1,
      slug: 's',
      title: 'Same',
      heroImage: upload(1, 'hero.jpg', 640, 360),
      meta: { image: upload(1, 'hero.jpg', 640, 360) },
    }
    const other = {
      id: 2,
      slug: 'o',
      title: 'Other',
      heroImage: upload(1, 'hero.jpg', 640, 360),
      meta: { image: upload(2, 'logo.png', 400, 400, 'image/png') },
    }
    const h = await presetHarness({ config: withHero, input: { collections: ['articles'] }, docs: { s: same, o: other } })
    expect((await h.resolve('articles', 's')).kind).toBe('generated') // the small hero draws text, and is still the hero
    expect((await h.resolve('articles', 'o')).kind).toBe('own') // a different upload the editor chose: the classic rule
  })
  it('a text card on a site with no upload collection (or no logo) resolves and draws: no collection is needed for an image nobody gave', async () => {
    const noUploads = configOf({
      collections: [
        {
          slug: 'posts',
          access: { read: () => true },
          fields: [
            { name: 'title', type: 'text' },
            { name: 'slug', type: 'text' },
          ],
        },
      ],
    } as never)
    const h = await presetHarness({
      config: noUploads,
      uploads: null,
      input: { collections: ['posts'] },
      docs: { a: { id: 1, slug: 'a', title: 'No uploads here' } },
    })
    const c = await h.resolve('posts', 'a')
    expect(c.kind).toBe('generated')
    const res = await h.get('https://www.example.test/og/posts/a/card.png', { kind: 'posts', slug: 'a', file: 'card.png' })
    expect(res.status).toBe(200)
  })
})

describe('an image nobody gave needs no upload collection', () => {
  it('a target that names a logo and a mark with no upload behind them still resolves on a site with no upload collection', async () => {
    const noUploads = configOf({
      collections: [
        {
          slug: 'posts',
          access: { read: () => true },
          fields: [
            { name: 'title', type: 'text' },
            { name: 'slug', type: 'text' },
          ],
        },
      ],
    } as never)
    const h = await presetHarness({
      config: noUploads,
      uploads: null,
      input: {
        collections: ['posts'],
        targets: {
          custom: {
            collection: 'posts',
            path: '/og/:kind/:slug/card.png',
            template: 'payload-og-image:text',
            props: ({ doc }: { doc: { title: string } }) => ({ title: doc.title, site: 'S' }),
            images: () => ({ logo: undefined, mark: undefined, partner: null }),
          },
        },
      } as never,
      docs: { a: { id: 1, slug: 'a', title: 'No uploads' } },
    })
    const c = await h.handler.resolve({ target: 'custom', doc: { id: 1, slug: 'a', title: 'No uploads' } as never }, { previewing: false })
    expect(c.kind).toBe('generated')
  })
})

describe('a [file] catch-all serves every card under its own name only', () => {
  it('a classic PNG card is 404 as card.jpg and 200 as card.png when the route has a file param; a fixed route (no file param) keeps answering as before', async () => {
    const classic = defineTemplate<{ title: string }>({
      id: 'classic',
      revision: '1',
      render: () => ({ type: 'div', props: { style: { display: 'flex', width: 1200, height: 630 }, children: 'x' } }) as never,
    })
    const h = await presetHarness({
      input: {
        collections: ['posts'],
        templates: [classic],
        targets: {
          classic: {
            collection: 'posts',
            path: '/og/:kind/:slug/card.png',
            template: 'classic',
            props: ({ doc }: { doc: { title: string } }) => ({ title: doc.title }),
          },
        },
      } as never,
      docs: { hello: { id: 1, slug: 'hello', title: 'Hello' } },
    })
    const ask = (name: string, params: Record<string, string>) =>
      h.get(`https://www.example.test/og/classic/hello/${name}`, { kind: 'classic', slug: 'hello', ...params })
    expect((await ask('card.png', { file: 'card.png' })).status).toBe(200)
    expect((await ask('card.jpg', { file: 'card.jpg' })).status).toBe(404)
    expect((await ask('anything.png', { file: 'anything.png' })).status).toBe(404)
    expect((await ask('card.jpg', {})).status).toBe(200) // a fixed route: no param, its pathname is its own
  })
})

describe('what the template never draws cannot move the URL', () => {
  it('a slot over its maxChars, or blank, gives the same version as none (normalised before hashing)', async () => {
    const docs = (pill?: string) => ({ a: { id: 1, slug: 'a', title: 'Same card', pill } })
    const v = async (pill?: string) => {
      const h = await presetHarness({
        input: {
          collections: ['posts'],
          targets: {
            custom: {
              collection: 'posts',
              path: '/og/:kind/:slug/card.png',
              template: 'payload-og-image:text',
              props: ({ doc }: { doc: { title: string; pill?: string } }) => ({ title: doc.title, site: 'S', pill: doc.pill }),
            },
          },
        } as never,
        docs: docs(pill),
      })
      const c = await h.handler.resolve({ target: 'custom', doc: docs(pill).a as never }, { previewing: false })
      return c.kind === 'generated' ? c.v : 'none'
    }
    const none = await v(undefined)
    expect(await v('x'.repeat(SLOTS.pill.maxChars + 1))).toBe(none)
    expect(await v('   ')).toBe(none)
    expect(await v('Fits')).not.toBe(none)
  })
  it('a hand-built context without fitRow says what is missing', async () => {
    const { fonts } = await bundled
    const ctx = templateContext({ host: 'x.test', fonts, stacks: BUNDLED_STACKS, hero: null })
    const { fitRow: _gone, ...bare } = ctx
    expect(() => textLayout({ title: 'T', site: 'S' }, bare)).toThrow(/need ctx\.fitRow/)
  })
})

describe('what is measured is what is drawn', () => {
  // A narrow upright face that has no Cyrillic, and a wide one that has both: a mixed run is drawn entirely in the wide one (a single face draws it).
  it('measureText follows the family the renderer picks for the run and the weight it draws, within kerning, through the real renderer', async () => {
    const { fonts } = await loadTestFonts()
    const stack = ['Archivo', 'Inter']
    const text = 'П mmmm wwww Mmmm wwww'
    const size = 56
    const family = fontFamilyFor(fonts, stack, text)
    expect(family).toBe('Inter')
    const png = await nextOgRenderer().render(
      {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            width: 1200,
            height: 120,
            background: '#000',
            color: '#fff',
            fontFamily: family,
            fontSize: size,
            whiteSpace: 'nowrap',
            padding: 0,
          },
          children: text,
        },
      } as never,
      { width: 1200, height: 120, fonts },
    )
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
    let right = 0
    for (let x = 0; x < info.width; x++) for (let y = 0; y < info.height; y++) if ((data[y * info.width + x] as number) > 100) right = x
    const measured = measureText(fonts, stack, text, size, { weight: 800 })
    expect(measured).toBeGreaterThanOrEqual(right * 0.98)
    expect(measured).toBeLessThanOrEqual(right * 1.06)
  })
  it('a family whose bold face lacks Cyrillic is not the family of a bold preset run (titles, the name, the foot), but is of a regular one', async () => {
    // Family F: its regular face (Inter) draws Cyrillic, its bold face (Archivo) does not. Inter is the next family of the stack.
    const { fonts: base } = await loadTestFonts()
    const archivo = base.find((f) => f.family === 'Archivo') as (typeof base)[number]
    const inter = base.find((f) => f.family === 'Inter') as (typeof base)[number]
    const fonts = [...base, { ...inter, family: 'F', weight: 400 }, { ...archivo, family: 'F', weight: 700 }]
    const ctx = templateContext({ host: 'example.test', fonts, stacks: { default: ['F', 'Inter'] }, hero: null })
    const ru = 'Привет мир'
    const p: PresetProps = { title: ru, site: ru, label: ru, subtitle: ru, meta: ru }
    const text = textLayout(p, ctx)
    expect(text.title.family).toBe('Inter') // bold: F's bold face cannot draw it
    expect(text.name?.family).toBe('Inter') // 700
    expect(text.label?.family).toBe('F') // 400
    expect(text.sub?.family).toBe('F') // 400
    const photo = photoLayout(p, ctx)
    expect(photo.title.family).toBe('Inter') // bold
    const feet = [...text.foot, ...photo.facts]
    expect(feet.filter((f) => /[А-я]/.test(f.text)).length).toBeGreaterThan(0)
    for (const f of feet.filter((f) => /[А-я]/.test(f.text))) expect(f.family, f.text).toBe(f.weight === 700 ? 'Inter' : 'F') // a Latin run (the domain) is drawn by either
    // And the other way: family G has Cyrillic only in its bold face, so a regular run (sub line, label, foot text) goes to the next family.
    const other = [...base, { ...archivo, family: 'G', weight: 400 }, { ...inter, family: 'G', weight: 700 }]
    const ctxG = templateContext({ host: 'example.test', fonts: other, stacks: { default: ['G', 'Inter'] }, hero: null })
    const g = textLayout(p, ctxG)
    expect(g.title.family).toBe('G')
    expect(g.label?.family).toBe('Inter')
    expect(g.sub?.family).toBe('Inter')
    for (const f of [...g.foot, ...photoLayout(p, ctxG).facts].filter((f) => /[А-я]/.test(f.text)))
      expect(f.family, f.text).toBe(f.weight === 700 ? 'G' : 'Inter')
  })
  it('a title set in custom faces whose regular and bold widths differ stays in its box on the drawn card', async () => {
    const { fonts } = await loadTestFonts()
    const stacks = { default: ['Archivo', 'Inter'] }
    const t = { ...(await loadTestFonts()) }
    const ctx = templateContext({ host: 'example.test', fonts: t.fonts, stacks, hero: null })
    const p: PresetProps = { title: 'Привет world: измеряем ширину заголовка и рисуем его по-настоящему', site: 'S' }
    const l = textLayout(p, ctx)
    const png = await nextOgRenderer().render(textPreset.render(p, ctx) as never, { width: 1200, height: 630, fonts })
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
    const rect = l.title.rect
    let right = 0
    let bottom = 0
    for (let y = rect.y; y < Math.min(630, rect.y + rect.h + 60); y++)
      for (let x = rect.x; x < 1200; x++)
        if ((data[y * info.width + x] as number) > 150) {
          right = Math.max(right, x)
          bottom = Math.max(bottom, y)
        }
    expect(right).toBeLessThanOrEqual(rect.x + rect.w + 4)
    expect(bottom).toBeLessThanOrEqual(rect.y + rect.h + 8)
  })
})

/** A PNG data URL of the given size (only its header and size matter to a layout). */
const pngOf = async (w: number, h: number) =>
  `data:image/png;base64,${(
    await sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } } })
      .png()
      .toBuffer()
  ).toString('base64')}`
const sizeOf = async (url: string) => {
  const m = await sharp(Buffer.from(url.split(',')[1] as string, 'base64')).metadata()
  return { w: m.width as number, h: m.height as number }
}

describe('logos are contained, trimmed and tinted, never cropped', () => {
  const shaped = async (file: string, shape: 'logo' | 'mark', box: { width: number; height: number }) => {
    const h = await presetHarness({ docs: {} })
    const loader = payloadHeroLoader({ staticDirs: async () => [h.dir] })
    return loader({ id: 1, filename: file, updatedAt: 'u' }, box, { keepAlpha: true, shape: TEXT_SHAPES[shape] })
  }
  it('a 12:1 black wordmark keeps its whole width at its aspect and is drawn in the ink: not a square cut, not black on dark', async () => {
    const url = (await shaped('wordmark.png', 'logo', IMAGE_BOXES.logo)) as string
    const { w, h } = await sizeOf(url)
    expect(w).toBe(IMAGE_BOXES.logo.width)
    expect(w / h).toBeGreaterThan(10)
    const { data } = await sharp(Buffer.from(url.split(',')[1] as string, 'base64'))
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect([data[0], data[1], data[2], data[3]]).toEqual([0xee, 0xf0, 0xf2, 255]) // the opaque pixels were black: now COLOURS.ink
  })
  it('a square icon on an opaque white JPEG loses its white margin, stays square and keeps its colour', async () => {
    const url = (await shaped('icon.jpg', 'logo', IMAGE_BOXES.logo)) as string
    const { w, h } = await sizeOf(url)
    expect(Math.abs(w - h)).toBeLessThanOrEqual(1)
    expect(h).toBeLessThanOrEqual(IMAGE_BOXES.logo.height)
    const { data, info } = await sharp(Buffer.from(url.split(',')[1] as string, 'base64'))
      .raw()
      .toBuffer({ resolveWithObject: true })
    const mid = ((info.height >> 1) * info.width + (info.width >> 1)) * info.channels
    expect(data[mid + 2]).toBeGreaterThan(data[mid] as number) // blue, not the ink
  })
  it('the logo on the right is declined (and the card is not downgraded for it) when its trimmed aspect is no mark', async () => {
    expect(await shaped('wordmark.png', 'mark', IMAGE_BOXES.mark)).toBe('')
    expect(((await shaped('icon.jpg', 'mark', IMAGE_BOXES.mark)) as string).startsWith('data:image/png')).toBe(true)
    const h = await presetHarness({
      input: { collections: [{ slug: 'posts' }], siteName: 'S' },
      docs: { a: { id: 1, slug: 'a', title: 'A wide wordmark' } },
      site: { logo: 3 },
    })
    const c = await h.resolve('posts', 'a')
    if (c.kind !== 'generated') throw new Error('expected a generated card')
    const res = await h.get(c.url, { kind: 'posts', slug: 'a', file: 'card.png' })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-og-cache')).toBe('render') // declined by its shape is not a failure: never 'downgraded'
  })
})

describe('the head, the right side and the title ladder', () => {
  const square = () => pngOf(88, 88)
  it('a wide logo stands alone: contained at 44 high, no site name beside it, the label stays', async () => {
    const ctx = await ctxOf({ logo: [await pngOf(440, 88)] })
    const l = textLayout({ title: 'T', site: 'OxFoundry', label: 'Blog' }, ctx)
    expect(l.logo).toMatchObject({ w: 220, h: 44 })
    expect(l.name).toBeUndefined()
    expect(l.label?.text).toBe('Blog')
  })
  it('a square logo is followed by a partner logo after a 16 px gap, then the name; the partner is at most 44 x 160', async () => {
    const ctx = await ctxOf({ logo: [await square()], partner: [await pngOf(640, 88)] })
    const l = textLayout({ title: 'T', site: 'OxFoundry', label: 'Blog' }, ctx)
    expect(l.logo).toMatchObject({ w: 44, h: 44 })
    expect(l.partner?.x).toBe((l.logo?.x as number) + 44 + 16)
    expect(l.partner?.w).toBeLessThanOrEqual(160)
    expect(l.name?.text).toBe('OxFoundry')
  })
  it('the logo on the right is contained in its 400 box at (736, 115), centred, and never clipped', async () => {
    const ctx = await ctxOf({ logo: [await square()], mark: [await pngOf(400, 260)] })
    const l = textLayout({ title: 'A short title', site: 'S' }, ctx)
    expect(l.art).toBe('mark')
    expect(l.colW).toBe(900)
    expect(l.mark).toEqual({ x: 736, y: 115 + 70, w: 400, h: 260 })
    expect((l.mark as { x: number; w: number }).x + (l.mark as { w: number }).w).toBeLessThanOrEqual(1200)
  })
  it('a 42-character title beside a square logo stays large: 84 px or more on two lines', async () => {
    const ctx = await ctxOf({ logo: [await square()], mark: [await pngOf(400, 400)] })
    const l = textLayout({ title: 'OxPulse: encrypted calls for a bad network', site: 'S' }, ctx)
    expect(l.art).toBe('mark')
    expect(l.title.lines).toBe(2)
    expect(l.title.size).toBeGreaterThanOrEqual(84)
  })
  it('a title that does not fit whole beside the art drops the art and is fitted on the plain ladder; the uploaded art too', async () => {
    const long =
      'A very long headline that keeps going well past what four lines of forty-four pixel type can hold beside a logo, and then some more words to be sure it overflows'
    const short = 'OxPulse: encrypted calls for a bad network'
    for (const img of [{ mark: [await pngOf(480, 480)] }, { art: [await pngOf(540, 630)] }] as Record<string, string[]>[]) {
      const ctx = await ctxOf(img)
      const withArt = textLayout({ title: short, site: 'S' }, ctx)
      expect(withArt.art).not.toBeNull()
      expect(withArt.title.text).toBe(short) // whole, no ellipsis next to art
      const dropped = textLayout({ title: long, site: 'S' }, ctx)
      expect(dropped.art).toBeNull()
      expect(dropped.colW).toBe(900)
      expect(dropped.mark).toBeUndefined()
    }
  })
  it('a 160-character title is whole on the plain ladder (down to 44 px, six lines) before any ellipsis', async () => {
    const title = 'Word '.repeat(31).trim() // 154 chars
    const l = textLayout({ title, site: 'S' }, await ctxOf())
    expect(l.title.text).toBe(title)
  })
  it('the foot shows the domain without a leading www.', async () => {
    const { fonts } = await bundled
    const ctx = templateContext({ host: 'www.example.test', fonts, stacks: BUNDLED_STACKS, hero: null })
    expect(textLayout({ title: 'T', site: 'S' }, ctx).foot[0]?.text).toBe('example.test')
  })
  it('artOpacity: unset is the template default and no part of the props; set it is, and a value outside 0 to 1 is refused', async () => {
    const v = async (input: Record<string, unknown>) => {
      const h = await presetHarness({
        input: { collections: ['posts'], ...input } as never,
        docs: { a: { id: 1, slug: 'a', title: 'Opacity' } },
      })
      const c = await h.resolve('posts', 'a')
      return c.kind === 'generated' ? { v: c.v, props: c.props } : undefined
    }
    const base = await v({})
    expect(base?.props).not.toHaveProperty('artOpacity')
    const set = await v({ artOpacity: 1 })
    expect(set?.props.artOpacity).toBe(1)
    expect(set?.v).not.toBe(base?.v)
    expect(() => expandPresets({ artOpacity: 1.5 } as never, configOf())).toThrow(/artOpacity must be a number from 0 to 1/)
  })
})

describe('the photo card ends in one brand lockup', () => {
  it('the logo, the partner and the name sit at the end of the fact row, right-aligned, never dropped; a wide logo has no name; the label is translucent', async () => {
    const ctx = await ctxOf({ logo: [await pngOf(72, 72)], partner: [await pngOf(240, 72)] })
    const l = photoLayout({ title: 'A photo title', site: 'OxFoundry', label: 'Blog' }, ctx)
    const name = l.facts.find((f) => f.key === 'lockup')
    expect(name).toBeDefined()
    expect((name as { rect: { x: number; w: number } }).rect.x + (name as { rect: { w: number } }).rect.w).toBe(1136)
    expect((l.partner?.x as number) + (l.partner?.w as number)).toBeLessThan((name as { rect: { x: number } }).rect.x)
    expect((l.logo?.x as number) + (l.logo?.w as number)).toBeLessThan(l.partner?.x as number)
    expect(l.logo?.h).toBeLessThanOrEqual(36)
    expect(l.facts.find((f) => f.key === 'label')?.kind).toBe('pill') // the label stands in for a missing pill
    const wide = photoLayout({ title: 'T', site: 'OxFoundry' }, await ctxOf({ logo: [await pngOf(300, 60)] }))
    expect(wide.logo?.w).toBe(150)
    expect(wide.facts.some((f) => f.key === 'lockup')).toBe(false)
    // a full row drops the name and keeps the logo
    const full = photoLayout({ title: 'T', site: 'OxFoundry', pill: 'P'.repeat(28), pill2: 'Q'.repeat(24), caption: 'C'.repeat(48) }, ctx)
    expect(full.facts.some((f) => f.key === 'lockup')).toBe(false)
    expect(full.logo).toBeDefined()
  })
})

describe('the sub line is whole or absent', () => {
  it('a sub line that would need an ellipsis is dropped, never cut', async () => {
    const ctx = await ctxOf()
    expect(textLayout({ title: 'T', site: 'S', subtitle: 'Short enough.' }, ctx).sub?.text).toBe('Short enough.')
    expect(textLayout({ title: 'T', site: 'S', subtitle: 'A sentence that goes on and on, '.repeat(12) }, ctx).sub).toBeUndefined()
  })
})

// @ts-expect-error `{ targets }` alone is neither the classic options nor the presets: a type error, not a start-up failure
const _incomplete: Parameters<typeof ogImagePlugin>[0] = { targets: {} }
void _incomplete

describe('the preset follows the hero', () => {
  const auto = { preset: 'auto' as const, hero: { path: 'heroImage', collection: 'media' } }
  const big = upload(1, 'a.jpg', 1200, 800)
  it('1200x800 -> photo; 640x360 -> text; an SVG -> text; preset text with a hero -> text; no hero field -> text', () => {
    expect(choosePreset(auto, { heroImage: big })).toBe('photo')
    expect(choosePreset(auto, { heroImage: upload(1, 'a.jpg', 640, 360) })).toBe('text')
    expect(choosePreset(auto, { heroImage: upload(1, 'a.svg', 1200, 800, 'image/svg+xml') })).toBe('text')
    expect(choosePreset(auto, { heroImage: { ...big, url: '' } })).toBe('text')
    expect(choosePreset(auto, {})).toBe('text')
    expect(choosePreset({ ...auto, preset: 'text' }, { heroImage: big })).toBe('text')
    expect(choosePreset({ preset: 'photo', hero: undefined }, { heroImage: big })).toBe('text')
    expect(eligibleHero(upload(1, 'a.jpg', HERO_MIN.width, HERO_MIN.height))).toBe(true)
    expect(eligibleHero(upload(1, 'a.jpg', HERO_MIN.width - 1, HERO_MIN.height))).toBe(false)
    expect(eligibleHero(upload(1, 'a.jpg', HERO_MIN.width, HERO_MIN.height - 1))).toBe(false)
  })
  it('og.mode is unchanged: off -> no card, generated -> the card, with the preset the hero picks', async () => {
    const docs = {
      off: { id: 1, slug: 'off', title: 'Off', og: { mode: 'off' }, heroImage: big },
      gen: { id: 2, slug: 'gen', title: 'Gen', og: { mode: 'generated' }, heroImage: big },
    }
    const h = await presetHarness({ docs })
    expect((await h.resolve('posts', 'off')).kind).toBe('none')
    const gen = await h.resolve('posts', 'gen')
    expect(gen.kind === 'generated' && gen.template.id).toBe('payload-og-image:photo')
  })
})

describe('the route serves a card under its own file name only', () => {
  const docs = {
    photo: { id: 1, slug: 'photo', title: 'A photo card', heroImage: upload(1, 'hero.jpg', 1200, 800) },
    plain: { id: 2, slug: 'plain', title: 'A text card' },
  }
  it('a photo card is served as card.jpg only: card.png is 404, and the advertised URL ends .jpg with image/jpeg', async () => {
    const h = await presetHarness({ docs })
    const c = await h.resolve('posts', 'photo')
    if (c.kind !== 'generated') throw new Error('expected a generated card')
    expect(c.url).toMatch(/\/og\/posts\/photo\/card\.jpg\?v=[0-9a-f]{12}$/)
    expect(c.type).toBe('image/jpeg')
    const ok = await h.get(c.url, { kind: 'posts', slug: 'photo', file: 'card.jpg' })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/jpeg')
    expect((await sharp(new Uint8Array(await ok.arrayBuffer())).metadata()).format).toBe('jpeg')
    for (const wrong of ['card.png', 'card.webp', 'card.jpeg', 'other.jpg'])
      expect(
        (await h.get(`https://www.example.test/og/posts/photo/${wrong}`, { kind: 'posts', slug: 'photo', file: wrong })).status,
        wrong,
      ).toBe(404)
  })
  it('a text card is served as card.png only, whatever the route params say', async () => {
    const h = await presetHarness({ docs })
    const c = await h.resolve('posts', 'plain')
    if (c.kind !== 'generated') throw new Error('expected a generated card')
    expect(c.url).toMatch(/\/card\.png\?v=/)
    expect((await h.get(c.url, { kind: 'posts', slug: 'plain' })).status).toBe(200) // no `file` param at all: the pathname decides
    // a lying param does not help: the name is read from the request path
    expect(
      (await h.get('https://www.example.test/og/posts/plain/card.jpg', { kind: 'posts', slug: 'plain', file: 'card.png' })).status,
    ).toBe(404)
  })
})

// The prepared images are palette PNGs whose bytes differ between platforms (their identity is in `v`); the element tree around them is the same everywhere.
const IMAGE = /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g

describe('goldens: the two presets keep their URL and what they draw', () => {
  const docs = {
    text: { id: 1, slug: 'text', title: 'OxPulse: encrypted calls for a bad network', excerpt: 'Calls that keep working.' },
    photo: {
      id: 2,
      slug: 'photo',
      title: 'Как мы переписали систему доставки',
      excerpt: 'Подзаголовок',
      heroImage: upload(1, 'hero.jpg', 1200, 800),
    },
  }
  const GOLDEN: Record<string, { v: string; drawn: string }> = {
    'text/-': { v: 'f29ae70a0621', drawn: '0aa2da980b982f0b391bdc3c476072f883597d6830a6da5ce7bd07414fc40332' },
    'text/logo': { v: '0cab04db6665', drawn: 'e4e8d6949ec5b941d0a4d7149afed664a6adf45e54d471ba6ec1f266b27e3982' },
    'photo/-': { v: '8a460bda065e', drawn: '17f9955d454687cfd7c45801e96a7cb9e9f95c4df55da3396387e1f861c0ad66' },
  }
  it.each([
    ['text', undefined],
    ['text', 2],
    ['photo', undefined],
  ] as const)('%s (logo %s)', async (slug, logo) => {
    const h = await presetHarness({
      input: { collections: [{ slug: 'posts', subtitle: 'excerpt' }], siteName: 'OxFoundry' },
      docs,
      site: logo ? { logo } : {},
    })
    const c = await h.resolve('posts', slug)
    if (c.kind !== 'generated') throw new Error('expected a generated card')
    const res = await h.get(c.url, { kind: 'posts', slug, file: c.url.split('?')[0]?.split('/').pop() as string })
    expect(res.status).toBe(200)
    const m = await sharp(new Uint8Array(await res.arrayBuffer())).metadata()
    expect([m.format, m.width, m.height]).toEqual([slug === 'photo' ? 'jpeg' : 'png', 1200, 630])
    expect({ v: c.v, drawn: sha(Buffer.from((h.drawn.at(-1) as string).replace(IMAGE, 'data:IMG'))) }).toEqual(
      GOLDEN[`${slug}/${logo ? 'logo' : '-'}`],
    )
  })
})

const titles = [
  'A',
  'Short title',
  'OxPulse: encrypted calls for a bad network',
  'Как мы переписали систему доставки на новую архитектуру и почему это заняло почти полгода вместо трёх недель',
  'Łódź, Şişli, Ţară, Đà Lạt: ąęłńóśźż ĄĘŁŃÓŚŹŻ — ÇĞİÖŞÜ '.repeat(3),
  'x'.repeat(200),
  `${'word '.repeat(40)}end`,
]
const slotsAtMax = Object.fromEntries(Object.entries(SLOTS).map(([k, s]) => [k, 'W'.repeat(s.maxChars)]))
const inZone = (r: { x: number; y: number; w: number; h: number }) =>
  r.x >= ZONE.x0 && r.x + r.w <= ZONE.x1 && r.y >= ZONE.y0 && r.y + r.h <= ZONE.y1

describe('safe zone', () => {
  it('every box of both layouts stays in the safe zone, over 1-200 character titles in RU/EN/latin-ext, every slot at maxChars, logo and art on and off', async () => {
    const sq = await pngOf(88, 88)
    const wideLogo = await pngOf(440, 88)
    const images: Record<string, string[]>[] = [
      {},
      { logo: [sq] },
      { logo: [wideLogo] },
      { logo: [sq], partner: [await pngOf(320, 88)] },
      { logo: [wideLogo], partner: [await pngOf(320, 88)] },
      { logo: [sq], mark: [await pngOf(480, 480)] },
      { logo: [sq], art: [await pngOf(540, 630)] },
      { art: [await pngOf(540, 630)] },
      { logo: ['x'], mark: ['x'] },
    ]
    let boxes = 0
    for (const img of images) {
      const ctx = await ctxOf(img)
      for (const title of titles) {
        for (const extra of [
          {},
          { subtitle: 'Sub line '.repeat(12), label: 'Label', byline: 'A. Writer' },
          {
            ...slotsAtMax,
            subtitle: 'Подзаголовок '.repeat(8),
            label: 'Длинная метка раздела',
            byline: 'Имя Фамилия Отчество',
            site: 'S'.repeat(80),
          },
          { site: 'A very long site name that cannot possibly fit the head of the card' },
        ] as Partial<PresetProps>[]) {
          const p: PresetProps = { title, site: 'OxFoundry', ...extra }
          for (const l of [textLayout(p, ctx), photoLayout(p, ctx)]) {
            for (const b of l.boxes) {
              boxes += 1
              expect(inZone(b), `${JSON.stringify(b)} for ${JSON.stringify([img, title.slice(0, 20), Object.keys(extra)])}`).toBe(true)
            }
          }
        }
      }
    }
    expect(boxes).toBeGreaterThan(500)
  })
  it('the text column narrows to 640 beside uploaded art and widens to 900 without', async () => {
    const p: PresetProps = { title: 'A title long enough to take a few lines of the card, to see the column', site: 'S' }
    const art = textLayout(p, await ctxOf({ art: ['x'] }))
    const plain = textLayout(p, await ctxOf({}))
    expect(art.colW).toBe(640)
    expect(plain.colW).toBe(900)
    expect(art.title.rect.x + art.title.rect.w).toBeLessThanOrEqual(736 - 16)
  })
})

describe('fitRow drops whole items, never cuts one', () => {
  it('drops the highest priority number first, keeps priority 0, and answers each remaining item uncut', async () => {
    const ctx = await ctxOf()
    const item = (key: string, text: string, priority: number) => ({ key, text, stack: 'default', size: 24, priority })
    const all = [
      item('lead', 'example.test', 0),
      item('a', 'First pill text', 1),
      item('b', 'Second pill', 3),
      item('c', 'A caption that is long', 4),
    ]
    const wide = rowOf(ctx)(all, 2000)
    expect(wide.map((i) => i.key)).toEqual(['lead', 'a', 'b', 'c'])
    const total = (r: { width: number }[]) => r.reduce((s, i) => s + i.width, 0) + 16 * (r.length - 1)
    const narrow = rowOf(ctx)(all, total(wide) - 1)
    expect(narrow.map((i) => i.key)).toEqual(['lead', 'a', 'b'])
    expect(narrow.map((i) => i.text)).toEqual(['example.test', 'First pill text', 'Second pill'])
    const tight = rowOf(ctx)(all, 1)
    expect(tight.map((i) => i.key)).toEqual(['lead'])
    expect(rowOf(ctx)([item('e', '  ', 1)], 500)).toEqual([])
  })
  it('a slot over maxChars is dropped whole by the layout', async () => {
    const ctx = await ctxOf()
    const l = textLayout({ title: 'T', site: 'S', pill: 'x'.repeat(SLOTS.pill.maxChars + 1), badge: 'NEW' }, ctx)
    expect(l.foot.map((f) => f.key)).toEqual(['lead', 'badge'])
  })
})

it('loadTestFonts still loads (the fixtures the existing specs use are untouched)', async () => {
  expect((await loadTestFonts()).fonts.length).toBe(2)
})
