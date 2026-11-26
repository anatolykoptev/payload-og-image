import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Config } from 'payload'
import sharp from 'sharp'
import { loadFonts } from '../../src/internal/fonts.js'
import { createGate } from '../../src/internal/gate.js'
import { createCardHandler, type RouteContext } from '../../src/internal/handler.js'
import { createMemo } from '../../src/internal/memo.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import type { OgImagePluginInput } from '../../src/plugin/index.js'
import { expandPresets } from '../../src/presets/expand.js'
import { fallbackTemplate } from '../../src/render/fallback.js'
import { payloadHeroLoader } from '../../src/render/hero.js'
import { nextOgRenderer } from '../../src/render/nextOg.js'
import { uploadsFrom } from '../helpers.js'

/** A config as a site writes it: posts with a hero and a sub line, an `authors` collection with no slug, a media collection. */
export const configOf = (extra: Partial<Config> = {}): Config =>
  ({
    serverURL: 'https://www.example.test',
    collections: [
      { slug: 'users', auth: true, fields: [] },
      {
        slug: 'posts',
        labels: { singular: 'Post', plural: 'Blog' },
        admin: { useAsTitle: 'title' },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
          { name: 'excerpt', type: 'textarea' },
          { name: 'author', type: 'text' },
          { name: 'heroImage', type: 'upload', relationTo: 'media' },
        ],
      },
      { slug: 'people', fields: [{ name: 'name', type: 'text' }] },
      { slug: 'media', upload: { staticDir: '/unused' }, fields: [] },
    ],
    ...extra,
  }) as unknown as Config

export const upload = (id: number, filename: string, width: number, height: number, mimeType = 'image/jpeg') => ({
  id,
  filename,
  url: `/media/${filename}`,
  width,
  height,
  mimeType,
  updatedAt: '2026-01-01T00:00:00.000Z',
})

/** A photograph-like gradient with detail, and a square mark with transparency. */
export async function writeImages(dir: string) {
  const noise = Buffer.alloc(1200 * 800 * 3)
  for (let i = 0; i < noise.length; i += 3) {
    const px = (i / 3) % 1200
    const py = Math.floor(i / 3 / 1200)
    noise[i] = 40 + Math.round((px / 1200) * 120) + ((px * 7 + py * 3) % 23)
    noise[i + 1] = 70 + Math.round((py / 800) * 110) + ((px + py * 5) % 17)
    noise[i + 2] = 130 + Math.round(((px + py) / 2000) * 90)
  }
  await writeFile(
    path.join(dir, 'hero.jpg'),
    await sharp(noise, { raw: { width: 1200, height: 800, channels: 3 } })
      .jpeg()
      .toBuffer(),
  )
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><path d="M150 40 C60 120 60 280 150 360" stroke="#8FB4FF" stroke-width="38" fill="none" stroke-linecap="round"/><path d="M250 40 C340 120 340 280 250 360" stroke="#ffffff" stroke-width="38" fill="none" stroke-linecap="round"/></svg>`
  await writeFile(path.join(dir, 'logo.png'), await sharp(Buffer.from(svg)).png().toBuffer())
  // A black wordmark on transparent (about 12:1 trimmed), and a square icon on an opaque white JPEG.
  const word = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="100"><rect x="10" y="30" width="480" height="40" fill="#000"/></svg>`
  await writeFile(path.join(dir, 'wordmark.png'), await sharp(Buffer.from(word)).png().toBuffer())
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#fff"/><circle cx="150" cy="150" r="100" fill="#4f8cff"/></svg>`
  await writeFile(path.join(dir, 'icon.jpg'), await sharp(Buffer.from(icon)).jpeg().toBuffer())
}

export type Harness = Awaited<ReturnType<typeof presetHarness>>

export async function presetHarness(o: {
  input?: OgImagePluginInput
  docs: Record<string, Record<string, unknown>>
  site?: Record<string, unknown>
  config?: Config
  /** More uploads by id, with their files written into `dir` by the caller. */
  extraUploads?: Record<number, unknown>
  /** The site's only upload collection; `null`: the site has none. */
  uploads?: string | null
}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'og-preset-'))
  await writeImages(dir)
  const input = { collections: ['posts'], ...o.input } as OgImagePluginInput
  const config = o.config ?? configOf()
  const options = expandPresets(input, config)
  const drawn: string[] = []
  const related = async (collection: string, id: string | number) =>
    collection === 'media'
      ? (({ ...o.extraUploads } as Record<string, unknown>)[String(id)] ??
        (
          {
            1: upload(1, 'hero.jpg', 1200, 800),
            2: upload(2, 'logo.png', 400, 400, 'image/png'),
            3: upload(3, 'wordmark.png', 500, 100, 'image/png'),
            4: upload(4, 'icon.jpg', 300, 300),
          } as Record<string, unknown>
        )[String(id)] ??
        null)
      : null
  const real = nextOgRenderer()
  const handler = createCardHandler({
    targets: options.targets,
    statics: {},
    templates: new Map(options.templates.map((t) => [t.id, t])),
    fonts: () => loadFonts(options.fonts),
    stacks: options.stacks,
    serverUrl: 'https://www.example.test',
    source: {
      published: async (_: string, s: string) => o.docs[s] ?? null,
      publishedById: async () => null,
      draft: async () => null,
      site: async () => ({ name: 'Example', ...o.site }),
      related,
      uploads: uploadsFrom(related),
    },
    store: memoryStore(),
    renderer: {
      render: async (el: unknown, a: Parameters<ReturnType<typeof nextOgRenderer>['render']>[1]) => {
        drawn.push(JSON.stringify(el))
        return real.render(el as never, a)
      },
    },
    heroLoader: payloadHeroLoader({ staticDirs: async () => [dir] }),
    uploadCollection: o.uploads === null ? undefined : (o.uploads ?? 'media'),
    gate: createGate(),
    memo: createMemo(),
    events: { emit: () => {} },
    isDraftRequest: async () => false,
    fallback: fallbackTemplate,
  } as never)
  const ctx = (params: Record<string, string>): RouteContext => ({ params: Promise.resolve(params) })
  return {
    dir,
    options,
    drawn,
    handler,
    resolve: (target: string, slug: string) => handler.resolve({ target, doc: o.docs[slug] as never }, { previewing: false }),
    get: (url: string, params: Record<string, string>) => handler.GET(new Request(url), ctx(params)),
  }
}
