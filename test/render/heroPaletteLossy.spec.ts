/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a JPEG/WebP card whose hero is still cut to 256 colours (banding, no error).
 * - handler.ts `colours: card.template.heroColours ?? lossyColours(card)` -> `card.template.heroColours` -> "a lossy card's hero is drawn truecolour unless palette.hero says otherwise" RED
 * - handler.ts `lossyColours` returns `undefined` for a lossy card -> same test RED
 * - resolve.ts `heroPalette: encoding.format === 'png' ? ... : (i.heroPaletteLossy ?? ...)` -> `i.heroPalette` -> "a lossy card's hero default is part of its version" RED
 * - palette.ts `heroColoursOf` ignores `lossy` -> both of the above RED */
import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocSource, HeroLoader, Renderer } from '../../src/internal/handler.js'
import { buildRuntime, setTestRuntime } from '../../src/internal/runtime.js'
import { createState } from '../../src/internal/state.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { createOgRoute } from '../../src/next/route.js'
import type { OgImagePluginOptions } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts, realCard } from '../helpers.js'

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
    related: async () => null,
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
