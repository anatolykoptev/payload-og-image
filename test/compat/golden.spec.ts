/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a change that moves a card URL or its bytes for a site that never opted in gives no error, only a re-render of every card.
 * - version.ts `imageTail` returns a tail for an empty `images` list (not undefined) -> "a card without `images` keeps the URL and the bytes it had before named images" RED (every case)
 * - hero.ts `load` ignores the site's ground when `keepAlpha` is absent -> the same test RED ("posts clear #f1f3ef": the flattened hero's bytes) */
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { createGate } from '../../src/internal/gate.js'
import { createCardHandler } from '../../src/internal/handler.js'
import { createMemo } from '../../src/internal/memo.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { payloadHeroLoader } from '../../src/render/hero.js'
import { nextOgRenderer } from '../../src/render/nextOg.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts } from '../helpers.js'

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

const card = defineTemplate<{ title: string }>({
  id: 'card',
  revision: '1',
  textFields: ['title'],
  required: (p) => !!p.title,
  render: (p, ctx) =>
    ({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          width: 1200,
          height: 630,
          background: '#223344',
          color: '#fff',
          fontSize: 64,
          fontFamily: ctx.font('title', p.title),
        },
        children: [
          { type: 'span', props: { children: p.title } },
          ...(ctx.hero ? [{ type: 'img', props: { src: ctx.hero, width: 300, height: 300 } }] : []),
        ],
      },
    }) as never,
})
const fallback = defineTemplate<{ site: string }>({
  id: 'fb',
  revision: '1',
  render: () => ({ type: 'div', props: { children: 'fb' } }) as never,
})

let dir: string
const upload = (id: number, filename: string) => ({ id, filename, url: `/media/${filename}`, updatedAt: '2026-01-01T00:00:00.000Z' })
const docs: Record<string, Record<string, unknown>> = {}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'og-golden-'))
  const opaque = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#c0392b' } })
    .png()
    .toBuffer()
  const clear = await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 20, g: 120, b: 200, alpha: 0.4 } } })
    .png()
    .toBuffer()
  await writeFile(path.join(dir, 'opaque.png'), opaque)
  await writeFile(path.join(dir, 'clear.png'), clear)
  docs.plain = { id: 1, slug: 'plain', title: 'No picture here' }
  docs.opaque = { id: 2, slug: 'opaque', title: 'An opaque hero', hero: upload(11, 'opaque.png') }
  docs.clear = { id: 3, slug: 'clear', title: 'A see-through hero', hero: upload(12, 'clear.png') }
})

const build = (over: { heroBackground?: string; heroFlattened?: boolean } = {}) =>
  createCardHandler({
    targets: {
      posts: defineTarget<any, any>({
        path: '/og/:kind/:slug/card.png',
        template: 'card',
        props: ({ doc }: any) => ({ title: doc.title }),
        hero: ({ doc }: any) => doc.hero,
        heroCollection: 'media',
      }),
      jpegs: defineTarget<any, any>({
        path: '/og/:kind/:slug/card.jpg',
        template: 'card',
        format: 'jpeg',
        props: ({ doc }: any) => ({ title: doc.title }),
        hero: ({ doc }: any) => doc.hero,
        heroCollection: 'media',
      }),
    },
    statics: {},
    templates: new Map([['card', card]]),
    fonts: loadTestFonts,
    stacks: { title: ['Inter'], default: ['Inter'] },
    serverUrl: 'https://x.test',
    source: {
      published: async (_: string, s: string) => docs[s] ?? null,
      publishedById: async () => null,
      draft: async () => null,
      site: async () => ({ name: 'Site' }),
      related: async () => null,
    },
    store: memoryStore(),
    renderer: nextOgRenderer(),
    heroLoader: payloadHeroLoader({ staticDirs: async () => [dir], background: over.heroBackground }),
    heroBackground: over.heroBackground,
    heroFlattened: over.heroFlattened,
    gate: createGate(),
    memo: createMemo(),
    events: { emit: () => {} },
    isDraftRequest: async () => false,
    fallback,
  } as never)

type Row = { slug: string; target: 'posts' | 'jpegs'; ground?: string }
const rows: Row[] = [
  { slug: 'plain', target: 'posts' },
  { slug: 'opaque', target: 'posts' },
  { slug: 'clear', target: 'posts' },
  { slug: 'clear', target: 'posts', ground: '#f1f3ef' },
  { slug: 'opaque', target: 'jpegs' },
]

/** Captured from `main` before named images existed: the URL's `v` and the sha256 of the served bytes. */
const GOLDEN: Record<string, { v: string; sha256: string }> = {
  'posts/plain/-': { v: '1e121f6adc86', sha256: 'b9a7d6ef917d4d3cba192550a4a07e31ecd49d15a50170eae57dab02ea608da7' },
  'posts/opaque/-': { v: 'bd28280fe470', sha256: '012c0e749fade5c35acfc552c977472fc86f5c8adffd2e69f643d05d47d4c091' },
  'posts/clear/-': { v: '8bde567508a6', sha256: 'b7e8eca1d619778ed570c61d63826826dd2858b4d84f8012b5ab6ea45b9e0205' },
  'posts/clear/#f1f3ef': { v: '01bfa3780148', sha256: '761aabfb1fa70c153b457a2608111dc9af6269c94dcbb1013a39b481987763ba' },
  'jpegs/opaque/-': { v: '758c9f78f611', sha256: '11ac48a5337f4a3622c4a70a90335c7bea1d0cc090bd7c9ea0f276217396cd64' },
}

describe('a card without `images` keeps the URL and the bytes it had before named images', () => {
  it.each(rows)('$target $slug (site ground: $ground)', async (row) => {
    const h = build(row.ground ? { heroBackground: row.ground, heroFlattened: true } : {})
    const resolved = await h.resolve({ target: row.target, doc: docs[row.slug] as never }, { previewing: false })
    if (resolved.kind !== 'generated') throw new Error('expected a generated card')
    const res = await h.GET(new Request(resolved.url), { params: Promise.resolve({ kind: row.target, slug: row.slug }) })
    expect(res.status).toBe(200)
    const got = { v: resolved.v, sha256: sha(new Uint8Array(await res.arrayBuffer())) }
    const key = `${row.target}/${row.slug}/${row.ground ?? '-'}`
    if (process.env.OG_PRINT_GOLDEN) console.log(`GOLDEN ${key} ${JSON.stringify(got)}`)
    expect(got).toEqual(GOLDEN[key])
  })
})
