/** Mutation table (production line -> the test that goes RED, each run in a scratch copy). Silent-failure surface: a photo set that leaks an unpublished image, ships a location,
 * enlarges a small photo, or keeps serving old pixels under an old URL after the focal point moved.
 * - internal/version.ts `photoVersion` without `focalOf(i.upload)` -> "moving only the focal point changes every URL and the pixels" RED
 * - internal/resolve.ts `resolvePhotos` without `fillUploads` + `heroOf` (taking the document's own upload object) -> "a draft-only hero gives no set to the public ..." RED (and 12 more)
 * - internal/photo.ts `Math.min(PHOTO_SET.capWidth, crop.width)` -> `PHOTO_SET.capWidth` (enlarging) -> "a 900 px photograph gives crops of at most 900 px ..." RED
 * - render/encode.ts `toJpeg` adding `.withMetadata()` -> "no EXIF, GPS or profile ships ..." RED
 * - render/photo.ts the `.rotate()` dropped -> "no EXIF, GPS or profile ships ..." (upright size) RED
 * - handler.ts the produced-size comparison in `servePhoto` dropped -> "a record that disagrees with its file is served briefly and never stored" RED
 * - presets/target.ts `p.seo?.path !== p.hero.path` dropped -> "a hero that is the share image field gives no set" RED
 * - internal/resolve.ts `photosEnabled` without the `.:ext` test -> "a fixed-file card path has no set ..." RED
 * - render/hero.ts `prepare` extracting a window 40 px off the shared one -> "the card still draws a hero by the same window ..." RED */
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Config } from 'payload'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadFonts } from '../../src/internal/fonts.js'
import { createGate } from '../../src/internal/gate.js'
import { createCardHandler, type HeroLoader, type RouteContext } from '../../src/internal/handler.js'
import { createMemo } from '../../src/internal/memo.js'
import { PHOTO_SET } from '../../src/internal/photo.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import type { OgEvent } from '../../src/internal/types.js'
import { uploadFieldsOf } from '../../src/internal/uploads.js'
import type { OgImagePluginInput } from '../../src/plugin/index.js'
import { expandPresets } from '../../src/presets/expand.js'
import { fallbackTemplate } from '../../src/render/fallback.js'
import { payloadHeroLoader } from '../../src/render/hero.js'
import { defineTarget } from '../../src/template.js'
import { uploadsFrom } from '../helpers.js'
import { configOf } from '../presets/harness.js'

/** A photograph-like image: a gradient with detail that differs everywhere, so a shifted window shows. */
const pixels = (w: number, h: number) => {
  const raw = Buffer.alloc(w * h * 3)
  for (let i = 0; i < raw.length; i += 3) {
    const x = (i / 3) % w
    const y = Math.floor(i / 3 / w)
    raw[i] = (x * 255) / w
    raw[i + 1] = (y * 255) / h
    raw[i + 2] = 128 + 100 * Math.sin(x / 61) * Math.cos(y / 43)
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
}

const media = (id: number, filename: string, width: number, height: number, extra: Record<string, unknown> = {}) => ({
  id,
  filename,
  url: `/media/${filename}`,
  width,
  height,
  mimeType: 'image/jpeg',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

let dir: string
const files: Record<string, Buffer> = {}
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'og-photo-'))
  files['big.jpg'] = await pixels(2400, 1600).jpeg({ quality: 92 }).toBuffer()
  files['small.jpg'] = await pixels(900, 600).jpeg().toBuffer()
  files['tiny.jpg'] = await pixels(500, 400).jpeg().toBuffer()
  // A phone photograph: stored landscape with a quarter-turn EXIF orientation, a Display P3 profile and a GPS fix.
  files['phone.jpg'] = await pixels(1800, 1200)
    .withMetadata({
      orientation: 6,
      icc: 'p3',
      exif: { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '37/1 46/1 29/1', GPSLongitudeRef: 'W', GPSLongitude: '122/1 25/1 9/1' } },
    })
    .jpeg()
    .toBuffer()
  files['alpha.png'] = await sharp({ create: { width: 1300, height: 800, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer()
  files['drawing.jpg'] = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900"><rect width="1400" height="900" fill="#08f"/></svg>`,
  )
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(dir, name), bytes)
})

const UPLOADS = (): Record<number, Record<string, any>> => ({
  1: { ...media(1, 'big.jpg', 2400, 1600), _status: 'published' },
  2: { ...media(2, 'big.jpg', 2400, 1600), _status: 'draft' }, // exists only as a draft: the public cannot read it
  3: { ...media(3, 'small.jpg', 900, 600), _status: 'published' },
  4: { ...media(4, 'tiny.jpg', 500, 400), _status: 'published' },
  5: { ...media(5, 'phone.jpg', 1800, 1200), _status: 'published' }, // the record holds the stored (unrotated) size, as Payload writes it
  6: { ...media(6, 'alpha.png', 1300, 800, { mimeType: 'image/png' }), _status: 'published' },
  7: { ...media(7, 'drawing.jpg', 1400, 900), _status: 'published' }, // an SVG under a JPEG record
  8: { ...media(8, 'big.jpg', 2400, 1600, { focalX: 20, focalY: 70 }), _status: 'published' },
  9: { ...media(9, 'big.jpg', 2400, 1600, { mimeType: 'image/svg+xml' }), _status: 'published' },
  // The record says 2000 x 1500, the file is 900 x 600.
  10: { ...media(10, 'small.jpg', 2000, 1500), _status: 'published' },
})

type Docs = Record<string, Record<string, any>>

async function harness(
  o: {
    input?: OgImagePluginInput
    docs?: Docs
    drafts?: Docs
    config?: Config
    uploads?: Record<number, Record<string, any>>
    loader?: (real: HeroLoader) => HeroLoader
    jpeg?: { quality: number }
    heroBackground?: string
    targets?: Record<string, import('../../src/template.js').Target>
  } = {},
) {
  const input = { collections: ['posts'], ...o.input } as OgImagePluginInput
  const config = o.config ?? configOf()
  const expanded = expandPresets(input, config)
  const options = { ...expanded, targets: o.targets ?? expanded.targets }
  const docs: Docs = o.docs ?? { a: { id: 10, slug: 'a', title: 'A', heroImage: 1 } }
  const uploads = o.uploads ?? UPLOADS()
  const events: OgEvent[] = []
  const puts: Array<{ pageId: string; v: string; format?: string }> = []
  const base = memoryStore()
  const store = {
    get: base.get,
    stat: base.stat,
    async put(p: string, v: string, b: Uint8Array, format?: never) {
      puts.push({ pageId: p, v, format })
      await base.put(p, v, b)
    },
  }
  let drawn = 0
  const real = payloadHeroLoader({ staticDirs: async () => [dir] })
  const heroLoader = o.loader ? o.loader(real) : real
  const read = async (_c: string, id: string | number, ctx?: { previewing?: boolean }) => {
    const hit = uploads[Number(id)]
    return hit && (ctx?.previewing === true || hit._status === 'published') ? { ...hit } : null
  }
  const handler = createCardHandler({
    targets: options.targets,
    statics: {},
    templates: new Map(options.templates.map((t) => [t.id, t])),
    fonts: () => loadFonts(options.fonts),
    stacks: options.stacks,
    serverUrl: 'https://www.example.test',
    source: {
      published: async (_t: string, slug: string) => docs[slug] ?? null,
      publishedById: async (_t: string, id: string | number) => Object.values(docs).find((d) => String(d.id) === String(id)) ?? null,
      draft: async (_t: string, key: { slug?: string }, request: Request) =>
        request.headers.get('x-editor') ? (o.drafts?.[key.slug as string] ?? null) : null,
      site: async () => ({ name: 'Example' }),
      related: read,
      uploads: uploadsFrom(read),
    },
    store: store as never,
    renderer: {
      render: async () => {
        drawn += 1
        throw new Error('a photo is never drawn by the card renderer')
      },
    },
    heroLoader,
    uploadCollection: 'media',
    uploadFields: (collection: string) =>
      uploadFieldsOf((config.collections?.find((c) => c.slug === collection) as { fields?: never } | undefined)?.fields),
    jpeg: o.jpeg,
    heroBackground: o.heroBackground,
    gate: createGate(),
    memo: createMemo(),
    events: { emit: (e: OgEvent) => events.push(e) },
    isDraftRequest: async (r: Request) => r.headers.get('x-draft') === '1',
    fallback: fallbackTemplate,
  } as never)
  const ctx = (params: Record<string, string>): RouteContext => ({ params: Promise.resolve(params) })
  const photos = (slug = 'a', target = 'posts', previewing = false) =>
    handler.photos({ target, doc: (previewing ? (o.drafts ?? docs) : docs)[slug] as never }, { previewing })
  /** A request for a file beside the card, as the `[file]` route receives it. */
  const get = (url: string, headers: Record<string, string> = {}, slug = 'a') => {
    const file = new URL(url).pathname.split('/').pop() as string
    return handler.GET(new Request(url, { headers }), ctx({ kind: 'posts', slug, file }))
  }
  return { handler, options, docs, events, puts, drawn: () => drawn, photos, get, uploads }
}

const firstUrl = async (h: { photos: () => Promise<{ images: Array<{ url: string }> } | null> }) => {
  const url = (await h.photos())?.images[0]?.url
  if (!url) throw new Error('expected a photo set')
  return url
}

const decoded = async (res: Response) => {
  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, meta: await sharp(bytes).metadata() }
}

describe('the photo set on the card route', () => {
  it('serves each size as a JPEG of exactly the advertised dimensions, through the card route and never the card renderer', async () => {
    const h = await harness()
    const set = await h.photos()
    expect(set?.images.map((i) => [i.name, i.width, i.height])).toEqual([
      ['16x9', 1200, 675],
      ['4x3', 1200, 900],
      ['1x1', 1200, 1200],
    ])
    for (const image of set?.images ?? []) {
      expect(image.url).toMatch(new RegExp(`^https://www\\.example\\.test/og/posts/a/photo-${image.name}\\.jpg\\?v=[0-9a-f]{12}$`))
      const res = await h.get(image.url)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/jpeg')
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable, no-transform')
      expect(res.headers.get('etag')).toBe(`"${image.v}"`)
      const { meta } = await decoded(res)
      expect([meta.width, meta.height]).toEqual([image.width, image.height])
    }
    expect(h.drawn()).toBe(0)
    // a second request is the memo's, a conditional one is a 304
    const wide = set?.images[0]
    expect((await h.get(wide?.url as string)).headers.get('x-og-cache')).toBe('memo')
    expect((await h.get(wide?.url as string, { 'if-none-match': `"${wide?.v}"` })).status).toBe(304)
    // one page id per size: the disk store keeps a few versions per page id, so the three must not share one
    expect(new Set(h.puts.map((p) => p.pageId)).size).toBe(3)
    expect(h.puts.every((p) => p.format === 'jpeg')).toBe(true)
  })

  it('the card itself is untouched: its file name is still its own', async () => {
    const h = await harness()
    expect((await h.get('https://www.example.test/og/posts/a/photo-2x1.jpg')).status).toBe(404)
  })

  it('a 900 px photograph gives crops of at most 900 px, and none is enlarged', async () => {
    const h = await harness({ docs: { a: { id: 10, slug: 'a', title: 'A', heroImage: 3 } } })
    const set = await h.photos()
    expect(set?.images.map((i) => [i.name, i.width, i.height])).toEqual([
      ['16x9', 900, 506],
      ['4x3', 800, 600],
      ['1x1', 600, 600],
    ])
    for (const image of set?.images ?? []) {
      const { meta } = await decoded(await h.get(image.url))
      expect(meta.width).toBeLessThanOrEqual(900)
      expect([meta.width, meta.height]).toEqual([image.width, image.height])
    }
  })

  it('a photograph under the floor, an SVG and a record with no size give no set at all, never the card or the logo', async () => {
    for (const hero of [4, 9]) {
      const h = await harness({ docs: { a: { id: 10, slug: 'a', title: 'A', heroImage: hero } } })
      expect(await h.photos()).toBeNull()
      expect((await h.get('https://www.example.test/og/posts/a/photo-16x9.jpg')).status).toBe(404)
    }
    // the record says JPEG but the file is an SVG: refused by what the file is, not by what the record says
    const h = await harness({ docs: { a: { id: 10, slug: 'a', title: 'A', heroImage: 7 } } })
    const set = await h.photos()
    expect(set?.images).toHaveLength(3)
    expect((await h.get(set?.images[0]?.url as string)).status).toBe(404)
    const noSize = await harness({
      uploads: { ...UPLOADS(), 1: { ...media(1, 'big.jpg', 2400, 1600), width: null, height: null, _status: 'published' } },
    })
    expect(await noSize.photos()).toBeNull()
  })

  it('a draft-only hero gives no set to the public, and a preview shows it without keeping it', async () => {
    const docs = { a: { id: 10, slug: 'a', title: 'A', heroImage: 2 } }
    const h = await harness({ docs, drafts: { a: { id: 10, slug: 'a', title: 'A', heroImage: 2 } } })
    expect(await h.photos()).toBeNull()
    expect((await h.get('https://www.example.test/og/posts/a/photo-16x9.jpg')).status).toBe(404)
    // the document holds a populated upload object for the draft-only upload: it is still read again, with the visitor's access
    const populated = await harness({ docs: { a: { id: 10, slug: 'a', title: 'A', heroImage: UPLOADS()[2] } } })
    expect(await populated.photos()).toBeNull()
    expect((await populated.get('https://www.example.test/og/posts/a/photo-1x1.jpg')).status).toBe(404)
    // an editor in draft mode sees the draft hero: never cached, never stored
    const res = await h.get('https://www.example.test/og/posts/a/photo-16x9.jpg', { 'x-draft': '1', 'x-editor': '1' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-og-cache')).toBe('draft')
    expect(h.puts).toHaveLength(0)
  })

  it("moving only the focal point changes every URL and the pixels (the upload's identity and updatedAt are the same)", async () => {
    const centre = await harness({ docs: { a: { id: 10, slug: 'a', title: 'A', heroImage: 1 } } })
    // the same upload record in every way but the focal point: same id, same updatedAt
    const moved = await harness({ uploads: { ...UPLOADS(), 1: { ...(UPLOADS()[1] as Record<string, any>), focalX: 20, focalY: 70 } } })
    const a = (await centre.photos())?.images ?? []
    const b = (await moved.photos())?.images ?? []
    expect(a).toHaveLength(3)
    for (const [i, image] of a.entries()) expect(b[i]?.v).not.toBe(image.v)
    // and the pixels really differ (the 1:1 window slides sideways, the 16:9 one up): the old URL would have kept serving the old crop
    const square = async (h: typeof centre, set: typeof a) =>
      (await decoded(await h.get(set.find((i) => i.name === '1x1')?.url as string))).bytes
    expect((await square(centre, a)).equals(await square(moved, b))).toBe(false)
    // the same inputs give the same URL
    expect((await (await harness()).photos())?.images.map((i) => i.v)).toEqual(a.map((i) => i.v))
  })

  it('the version moves with the upload, the quality and the ground, and with nothing else', async () => {
    const base = (await (await harness()).photos())?.images.map((i) => i.v)
    const other = UPLOADS()
    other[1] = { ...(other[1] as Record<string, any>), updatedAt: '2026-02-02T00:00:00.000Z' }
    expect((await (await harness({ uploads: other })).photos())?.images.map((i) => i.v)).not.toEqual(base)
    expect((await (await harness({ jpeg: { quality: 70 } })).photos())?.images.map((i) => i.v)).not.toEqual(base)
    expect((await (await harness({ heroBackground: '#112233' })).photos())?.images.map((i) => i.v)).not.toEqual(base)
    // the card's own fields are none of the photo's business: a new title is the same photograph
    const retitled = { a: { id: 10, slug: 'a', title: 'Another title', heroImage: 1, excerpt: 'x' } }
    expect((await (await harness({ docs: retitled })).photos())?.images.map((i) => i.v)).toEqual(base)
  })

  it('no EXIF, GPS or profile ships, and the photograph is upright, sRGB and progressive', async () => {
    const h = await harness({ docs: { a: { id: 10, slug: 'a', title: 'A', heroImage: 5 } } })
    const source = await sharp(files['phone.jpg']).metadata()
    expect(source.orientation).toBe(6)
    expect(source.icc).toBeDefined()
    expect(source.exif?.includes(Buffer.from([0x25, 0x88])) || source.exif?.includes(Buffer.from([0x88, 0x25]))).toBe(true) // it carries a GPS IFD
    const set = await h.photos()
    expect(set?.images.map((i) => [i.width, i.height])).toEqual([
      [1200, 675],
      [1200, 900],
      [1200, 1200],
    ])
    for (const image of set?.images ?? []) {
      const res = await h.get(image.url)
      expect(res.headers.get('cache-control')).toContain('immutable') // the record agreed with the rotated file: stored, not downgraded
      const { meta, bytes } = await decoded(res)
      expect([meta.width, meta.height]).toEqual([image.width, image.height])
      expect(meta.exif).toBeUndefined()
      expect(meta.icc).toBeUndefined()
      expect(meta.orientation).toBeUndefined()
      expect(meta.space).toBe('srgb')
      expect(meta.isProgressive).toBe(true)
      expect(bytes.includes(Buffer.from('Exif'))).toBe(false)
    }
  })

  it('a transparent photograph is flattened onto the site ground (white unless set)', async () => {
    for (const [heroBackground, px] of [
      [undefined, [255, 255, 255]],
      ['#112233', [17, 34, 51]],
    ] as const) {
      const h = await harness({ docs: { a: { id: 10, slug: 'a', title: 'A', heroImage: 6 } }, heroBackground })
      const res = await h.get(await firstUrl(h))
      const { data } = await sharp(Buffer.from(await res.arrayBuffer()))
        .raw()
        .toBuffer({ resolveWithObject: true })
      expect([...data.subarray(0, 3)].map((n) => Math.round(n / 4) * 4)).toEqual(px.map((n) => Math.round(n / 4) * 4))
    }
  })

  it('the card still draws a hero by the same window: the 16:9 photo and a 16:9 card hero are one crop', async () => {
    const h = await harness({ docs: { a: { id: 10, slug: 'a', title: 'A', heroImage: 8 } } })
    const image = (await h.photos())?.images[0] as { url: string }
    const photo = await sharp(Buffer.from(await (await h.get(image.url)).arrayBuffer()))
      .raw()
      .toBuffer({ resolveWithObject: true })
    const upload = { ...(UPLOADS()[8] as Record<string, any>) }
    const hero = (await h.handler.uploads({ previewing: false }).load([{ collection: 'media', id: '8' }]))[0]
    const url = (await payloadHeroLoader({ staticDirs: async () => [dir] })(
      hero as never,
      { width: 1200, height: 675 },
      { colours: false },
    )) as string
    const card = await sharp(Buffer.from(url.split(',')[1] as string, 'base64'))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(upload.focalX).toBe(20)
    expect([card.info.width, card.info.height]).toEqual([photo.info.width, photo.info.height])
    let diff = 0
    for (let i = 0; i < card.data.length; i++) diff += Math.abs((card.data[i] as number) - (photo.data[i] as number))
    const meanDiff = (a: Buffer, b: Buffer) => a.reduce((n, v, i) => n + Math.abs(v - (b[i] as number)), 0) / a.length
    expect(meanDiff(card.data, photo.data)).toBeLessThan(2) // JPEG noise only
    // the metric does tell windows apart: the same hero cut at the centre is far from this photo
    const centre = (await payloadHeroLoader({ staticDirs: async () => [dir] })(
      { ...(hero as object), focalX: 50, focalY: 50 } as never,
      { width: 1200, height: 675 },
      { colours: false },
    )) as string
    const other = await sharp(Buffer.from(centre.split(',')[1] as string, 'base64'))
      .removeAlpha()
      .raw()
      .toBuffer()
    expect(meanDiff(other, photo.data)).toBeGreaterThan(6)
  })

  it('a record that disagrees with its file is served briefly and never stored', async () => {
    const h = await harness({ docs: { a: { id: 10, slug: 'a', title: 'A', heroImage: 10 } } })
    const set = await h.photos()
    expect(set?.images[0]).toMatchObject({ width: 1200, height: 675 }) // what the record promises
    const res = await h.get(set?.images[0]?.url as string)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, no-transform')
    expect(res.headers.get('etag')).toBeNull()
    expect(res.headers.get('x-og-cache')).toBe('downgraded')
    expect(h.puts).toHaveLength(0)
    expect(h.events.some((e) => e.name === 'downgraded')).toBe(true)
  })

  it('an unreadable file is a 503, never a card in its place', async () => {
    const lost = UPLOADS()
    lost[1] = { ...(lost[1] as Record<string, any>), filename: 'missing.jpg' }
    const h = await harness({ uploads: lost })
    const res = await h.get(await firstUrl(h))
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(h.puts).toHaveLength(0)
    expect(h.drawn()).toBe(0)
  })

  it('a loader that cannot cut a photo advertises none', async () => {
    const h = await harness({
      loader: (real) => {
        const loader: HeroLoader = (...a) => real(...a)
        return loader
      },
    })
    expect(await h.photos()).toBeNull()
  })

  it("a page with an editor's own share image still has its photo set, and og.mode off does not hide it", async () => {
    const config = configOf()
    const posts = config.collections?.find((c) => c.slug === 'posts') as unknown as { fields: unknown[] }
    posts.fields.push({ name: 'meta', type: 'group', fields: [{ name: 'image', type: 'upload', relationTo: 'media' }] })
    const docs = {
      a: { id: 10, slug: 'a', title: 'A', heroImage: 1, meta: { image: 3 } },
      b: { id: 11, slug: 'b', title: 'B', heroImage: 1, og: { mode: 'off' } },
    }
    const h = await harness({ config, docs })
    const card = await h.handler.resolve({ target: 'posts', doc: docs.a as never }, { previewing: false })
    expect(card.kind).toBe('own') // the page shares the editor's image (900 px) as og:image ...
    const set = await h.photos('a')
    expect(set?.images.map((i) => i.width)).toEqual([1200, 1200, 1200]) // ... and the set is the hero (2400 px), never the share image
    const res = await h.get(set?.images[0]?.url as string)
    expect(res.status).toBe(200)
    expect((await h.photos('b'))?.images).toHaveLength(3)
  })

  it('a hero that is the share image field gives no set', async () => {
    const config = configOf()
    const posts = config.collections?.find((c) => c.slug === 'posts') as unknown as { fields: Array<{ name: string }> }
    posts.fields = posts.fields.filter((f) => f.name !== 'heroImage')
    posts.fields.push({ name: 'meta', type: 'group', fields: [{ name: 'image', type: 'upload', relationTo: 'media' }] } as never)
    const docs = { a: { id: 10, slug: 'a', title: 'A', meta: { image: 1 } } }
    const h = await harness({ config, docs })
    expect(h.options.targets.posts?.photo).toBe(false)
    expect(await h.photos()).toBeNull()
  })

  it('a fixed-file card path has no set (its route would answer 404), and photo: false opts a target out', async () => {
    const t = (over: Record<string, unknown>) =>
      harness({
        targets: {
          posts: defineTarget<any, any>({
            path: '/og/:kind/:slug/card.png',
            collection: 'posts',
            template: 'payload-og-image:text',
            props: ({ doc }: any) => ({ title: doc.title, label: 'x', site: 'x' }),
            hero: ({ doc }: any) => doc.heroImage,
            heroCollection: 'media',
            ...over,
          }),
        },
      })
    expect(await (await t({})).photos()).toBeNull()
    const ext = await t({ path: '/og/:kind/:slug/card.:ext' })
    expect((await ext.photos())?.images).toHaveLength(3) // a classic target: the photo is its hero
    const off = await t({ path: '/og/:kind/:slug/card.:ext', photo: false })
    expect(await off.photos()).toBeNull()
    const own = await t({ path: '/og/:kind/:slug/card.:ext', hero: () => undefined, photo: ({ doc }: any) => doc.heroImage })
    expect((await own.photos())?.images).toHaveLength(3) // a resolver of its own, whether or not the card draws a hero
  })

  it('the cap and the floor are the spec`s own numbers', () => {
    expect(PHOTO_SET.capWidth).toBe(1200)
    expect(PHOTO_SET.minWidth).toBe(600)
  })
})
