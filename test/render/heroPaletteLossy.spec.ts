/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a JPEG/WebP card whose hero is still cut to 256 colours (banding, no error).
 * - handler.ts `colours: card.template.heroColours ?? lossyColours(card)` -> `card.template.heroColours` -> "a lossy card's hero is drawn truecolour unless palette.hero says otherwise" RED
 * - handler.ts `lossyColours` returns `undefined` for a lossy card -> same test RED
 * - resolve.ts `heroPalette: encoding.format === 'png' ? ... : (i.heroPaletteLossy ?? ...)` -> `i.heroPalette` -> "a lossy card's hero default is part of its version" RED
 * - palette.ts `heroColoursOf` ignores `lossy` -> both of the above RED
 * - resolve.ts `heroPalette: lossy && template.heroColours === undefined ? ...` -> `lossy ? ...` -> "a template's own heroColours, or shaped-only images, keep a lossy card's version" RED
 * - resolve.ts `imagePalette: lossy && images.some(unshaped) ? ...` -> `lossy ? ...` -> the same test RED */
import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocSource, HeroLoader, Renderer } from '../../src/internal/handler.js'
import { resolveCard } from '../../src/internal/resolve.js'
import { buildRuntime, setTestRuntime } from '../../src/internal/runtime.js'
import { createState } from '../../src/internal/state.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { createOgRoute } from '../../src/next/route.js'
import type { OgImagePluginOptions } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts, realCard, uploadReaderOf, uploadsFrom } from '../helpers.js'

afterEach(() => setTestRuntime(null))

const post = defineTemplate<{ title: string }>({
  id: 'post',
  revision: '1',
  textFields: ['title'],
  render: (p) => ({ type: 'div', props: { children: p.title } }) as never,
})
const doc = { id: 1, slug: 'a', title: 'A', heroImage: { id: 9, url: '/media/h.jpg', updatedAt: 'u1', filename: 'h.jpg' } }

function setup(over: Partial<OgImagePluginOptions>, path = '/og/:kind/:slug/card.png') {
  const source: DocSource = {
    published: async () => doc,
    publishedById: async () => doc,
    draft: async () => null,
    site: async () => ({ name: 'Site' }),
    related: async () => doc.heroImage, // the public read of the hero upload
    uploads: uploadsFrom(async () => doc.heroImage),
  }
  const options: OgImagePluginOptions = {
    site: () => ({ name: 'Site' }),
    fonts: [],
    stacks: { default: ['Inter'] },
    templates: [post],
    targets: {
      posts: defineTarget<any, any>({
        path,
        template: 'post',
        props: ({ doc }: any) => ({ title: doc.title }),
        hero: ({ doc }: any) => doc.heroImage,
        heroCollection: 'media',
      }),
    },
    store: { memory: true },
    ...over,
  }
  const state = createState(options, 'https://x.test')
  state.fonts = loadTestFonts
  const heroLoader = vi.fn<HeroLoader>(async () => 'data:image/png;base64,AAAA')
  const render = vi.fn<Renderer['render']>(async (el: any, a) => realCard(String(el?.props?.children ?? ''), a.encoding?.format ?? 'png'))
  const rt = buildRuntime(state, {} as Payload, {
    source,
    store: memoryStore(),
    renderer: { render },
    heroLoader,
    isDraftRequest: async () => false,
  })
  setTestRuntime(rt)
  return { rt, heroLoader }
}

/** The `colours` the hero loader was asked for when the card was drawn (`'unset'`: left to the loader's own default). */
async function drawnColours(over: Partial<OgImagePluginOptions>, path?: string) {
  const { heroLoader } = setup(over, path)
  const ext = over.format === 'jpeg' ? 'jpg' : (over.format ?? 'png')
  const res = await createOgRoute({ config: {} as never }).GET(new Request(`https://x.test/og/posts/a/card.${ext}`), {
    params: Promise.resolve({ kind: 'posts', slug: 'a' }),
  })
  expect(res.status).toBe(200)
  const where = heroLoader.mock.calls[0]?.[2]
  return where?.colours === undefined ? 'unset' : where.colours
}

const versionOf = async (over: Partial<OgImagePluginOptions>, path?: string) => {
  const { rt } = setup(over, path)
  const m = await rt.resolveForMetadata({ target: 'posts', id: 1 })
  if (m.kind !== 'generated') throw new Error('expected a generated card')
  return m.v
}

describe('palette.hero default follows the output format', () => {
  it("a lossy card's hero is drawn truecolour unless palette.hero says otherwise; PNG keeps the loader default", async () => {
    expect(await drawnColours({})).toBe('unset') // PNG: the loader's 256-colour default
    expect(await drawnColours({ format: 'jpeg' }, '/og/:kind/:slug/card.jpg')).toBe(false)
    expect(await drawnColours({ format: 'webp' }, '/og/:kind/:slug/card.webp')).toBe(false)
    // An explicit value wins, in both directions.
    expect(await drawnColours({ format: 'jpeg', palette: { hero: 256 } }, '/og/:kind/:slug/card.jpg')).toBe(256)
    expect(await drawnColours({ format: 'jpeg', palette: { hero: 16 } }, '/og/:kind/:slug/card.jpg')).toBe(16)
  })

  it("a lossy card's hero default is part of its version; PNG and an explicit 256 are not", async () => {
    const png = await versionOf({})
    const jpg = '/og/:kind/:slug/card.jpg'
    const byDefault = await versionOf({ format: 'jpeg' }, jpg)
    const explicitFalse = await versionOf({ format: 'jpeg', palette: { hero: false } }, jpg)
    const explicit256 = await versionOf({ format: 'jpeg', palette: { hero: 256 } }, jpg)
    expect(byDefault).toBe(explicitFalse) // the same bytes, so the same version
    expect(explicit256).not.toBe(byDefault) // 256 colours is a different drawing
    expect(await versionOf({ palette: { hero: 256 } })).toBe(png) // PNG's default spelled out moves nothing
  })
})

describe('the lossy palette tag follows what each image path reads', () => {
  const t = (over: Record<string, unknown>) =>
    defineTemplate<{ title: string }>({
      id: 'gal',
      revision: '1',
      textFields: ['title'],
      imageBoxes: { logo: { width: 80, height: 40 } },
      render: () => ({ type: 'div', props: {} }) as never,
      ...over,
    })
  const upload = { id: 5, url: '/media/5.png', filename: '5.png', updatedAt: 'u' }
  const versionFor = async (template: ReturnType<typeof t>, o: { lossy: boolean; paletteHero?: 256 }, withHero: boolean) => {
    const { fonts, digest } = await loadTestFonts()
    const lossyTag = o.paletteHero ? undefined : 'false'
    const r = await resolveCard({
      targetName: 'posts',
      target: defineTarget<any, any>({
        path: o.lossy ? '/og/:kind/:slug/card.jpg' : '/og/:kind/:slug/card.png',
        template: 'gal',
        props: ({ doc }: any) => ({ title: doc.title }),
        images: () => ({ logo: 5 }),
        ...(withHero ? { hero: () => ({ id: 9, url: '/media/9.jpg', updatedAt: 'u' }) } : {}),
      }),
      doc: { id: 1, slug: 'a', title: 'A' },
      site: { name: 'S' },
      host: 'x.test',
      serverUrl: 'https://x.test',
      templates: new Map([['gal', template]]),
      fonts,
      fontsDigest: digest,
      stacks: { default: ['Inter'] },
      uploadCollection: 'media',
      uploads: uploadReaderOf(async () => upload),
      format: o.lossy ? 'jpeg' : undefined,
      heroPalette: undefined,
      heroPaletteLossy: lossyTag,
    } as never)
    if (r.kind !== 'generated') throw new Error('expected a generated card')
    return r.v
  }

  it("a template's own heroColours, or shaped-only images, keep a lossy card's version; an unshaped image or a hero takes the new tag", async () => {
    const shaped = t({ imageShapes: { logo: { trim: true } } })
    const plain = t({})
    const own = t({ heroColours: false })
    // Shaped-only images, no hero: nothing reads the lossy default, so the card's version is the one it always had (an explicit 256, the old no-tag value).
    expect(await versionFor(shaped, { lossy: true }, false)).toBe(await versionFor(shaped, { lossy: true, paletteHero: 256 }, false))
    // A hero the template gave its own palette: likewise.
    expect(await versionFor(t({ heroColours: false, imageShapes: { logo: { trim: true } } }), { lossy: true }, true)).toBe(
      await versionFor(t({ heroColours: false, imageShapes: { logo: { trim: true } } }), { lossy: true, paletteHero: 256 }, true),
    )
    // An unshaped named image, or a hero with no palette of its own, reads the default: the new tag moves the version.
    expect(await versionFor(plain, { lossy: true }, false)).not.toBe(await versionFor(plain, { lossy: true, paletteHero: 256 }, false))
    expect(await versionFor(plain, { lossy: true }, true)).not.toBe(await versionFor(plain, { lossy: true, paletteHero: 256 }, true))
    expect(await versionFor(own, { lossy: true }, false)).not.toBe(await versionFor(own, { lossy: true, paletteHero: 256 }, false)) // own colours, but the unshaped logo still reads it
    // PNG: untouched by any of it.
    expect(await versionFor(plain, { lossy: false }, true)).toBe(await versionFor(plain, { lossy: false, paletteHero: 256 }, true))
  })
})
