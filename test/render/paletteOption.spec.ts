/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a site that turns the palette off (or down) and gets the default encoding anyway, with no error.
 * - runtime.ts `nextOgRenderer({ palette: cardPaletteOf(o.palette) })` back to `nextOgRenderer()` -> "palette.card reaches the route's renderer" RED
 * - runtime.ts `colours: heroColoursOf(o.palette)` removed from `heroLoaderFor` -> "palette.hero reaches the hero loader" RED
 * - hero.ts `.png(o.colours === false ? {} : ...)` always `{ palette: true }` -> "palette.hero reaches the hero loader" RED
 * - palette.ts `cardPaletteOf` ignores `card: false` -> "palette.card reaches the route's renderer" RED */
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Payload } from 'payload'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import type { DocSource } from '../../src/internal/handler.js'
import { buildRuntime, heroLoaderFor, setTestRuntime } from '../../src/internal/runtime.js'
import { createState } from '../../src/internal/state.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { createOgRoute } from '../../src/next/route.js'
import type { OgImagePluginOptions } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts, uploadsFrom, verifiedUpload } from '../helpers.js'

afterEach(() => setTestRuntime(null))

const post = defineTemplate<{ title: string }>({
  id: 'post',
  revision: '1',
  render: (p) =>
    ({
      type: 'div',
      props: {
        style: { display: 'flex', width: '100%', height: '100%', fontSize: 72, fontFamily: 'Inter', background: '#123456', color: '#fff' },
        children: p.title,
      },
    }) as never,
})

/** The production wiring: no renderer override, so `buildRuntime` builds `nextOgRenderer` itself from the options. */
async function cardBytes(over: Partial<OgImagePluginOptions>): Promise<Uint8Array> {
  const doc = { id: 1, slug: 'a', title: 'Alpha' }
  const source: DocSource = {
    published: async () => doc,
    publishedById: async () => doc,
    draft: async () => null,
    site: async () => ({ name: 'Site' }),
    related: async () => null,
    uploads: uploadsFrom(async () => null),
  }
  const options: OgImagePluginOptions = {
    site: () => ({ name: 'Site' }),
    fonts: [],
    stacks: { default: ['Inter'] },
    templates: [post],
    targets: {
      posts: defineTarget<any, any>({
        path: '/og/:kind/:slug/card.png',
        template: 'post',
        props: ({ doc }: any) => ({ title: doc.title }),
      }),
    },
    store: { memory: true },
    ...over,
  }
  const state = createState(options, 'https://x.test')
  state.fonts = loadTestFonts
  setTestRuntime(buildRuntime(state, {} as Payload, { source, store: memoryStore(), isDraftRequest: async () => false }))
  const res = await createOgRoute({ config: {} as never }).GET(new Request('https://x.test/og/posts/a/card.png'), {
    params: Promise.resolve({ kind: 'posts', slug: 'a' }),
  })
  expect(res.status).toBe(200)
  return new Uint8Array(await res.arrayBuffer())
}

const colourCount = async (png: Buffer) => {
  const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const seen = new Set<number>()
  for (let i = 0; i < data.length; i += 3) seen.add(((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number))
  return seen.size
}

describe('palette.card', () => {
  it("palette.card reaches the route's renderer: default and 16 colours are palette PNGs, false is truecolour and larger", async () => {
    const byDefault = await cardBytes({})
    const truecolour = await cardBytes({ palette: { card: false } })
    const sixteen = await cardBytes({ palette: { card: 16 } })
    expect((await sharp(byDefault).metadata()).isPalette).toBe(true)
    expect((await sharp(truecolour).metadata()).isPalette).toBe(false)
    expect((await sharp(sixteen).metadata()).isPalette).toBe(true)
    expect(truecolour.length).toBeGreaterThan(byDefault.length)
    expect((await cardBytes({ palette: { card: 128, hero: 256 } })).length).toBe(byDefault.length) // spelling out the defaults changes nothing
  })
})

describe('palette.hero', () => {
  it('palette.hero reaches the hero loader: default is a palette PNG, false is truecolour, 16 is at most 16 colours', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'og-palette-'))
    const raw = Buffer.alloc(300 * 300 * 3)
    let s = 1
    for (let i = 0; i < raw.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0
      raw[i] = ((i % 900) >> 2) + ((s >>> 24) % 24)
    }
    await writeFile(
      path.join(dir, 'h.png'),
      await sharp(raw, { raw: { width: 300, height: 300, channels: 3 } })
        .png()
        .toBuffer(),
    )
    const payload = { collections: { media: { config: { upload: { staticDir: dir } } } } } as unknown as Payload
    const hero = verifiedUpload({ id: 1, filename: 'h.png', url: '/m/h.png', updatedAt: 'u' })
    const load = async (palette?: OgImagePluginOptions['palette']) => {
      const url = (await heroLoaderFor(payload, { palette })(hero, { width: 100, height: 100 })) as string
      const png = Buffer.from(url.split(',')[1] as string, 'base64')
      return { png, meta: await sharp(png).metadata() }
    }
    const byDefault = await load()
    const truecolour = await load({ hero: false })
    const sixteen = await load({ hero: 16 })
    expect(byDefault.meta.isPalette).toBe(true)
    expect((await load({ hero: 256 })).png.equals(byDefault.png)).toBe(true) // the default spelled out is the same bytes
    expect(truecolour.meta.isPalette).toBe(false)
    expect(sixteen.meta.isPalette).toBe(true)
    expect(await colourCount(sixteen.png)).toBeLessThanOrEqual(16)
    expect(await colourCount(byDefault.png)).toBeGreaterThan(16)
    expect(truecolour.png.length).toBeGreaterThan(byDefault.png.length)
    expect(byDefault.png.length).toBeGreaterThan(sixteen.png.length)
  })
})
