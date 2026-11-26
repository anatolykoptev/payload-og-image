/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a page whose structured data lists the card, or a URL its route does not serve.
 * - next/metadata.ts `ogPrimaryImageOfPage` taking the first image instead of the 16:9 -> "the primary image of the page is the 16:9 crop" RED
 * - inspect.ts `discoverOf` reporting `large: true` for any set -> the audit test (a 900 px photograph) RED */
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Payload } from 'payload'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocSource } from '../../src/internal/handler.js'
import { buildRuntime, setTestRuntime } from '../../src/internal/runtime.js'
import { CUSTOM_KEY, type OgState } from '../../src/internal/state.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import type { OgEvent } from '../../src/internal/types.js'
import { ogMetadata, ogPhotoImages, ogPrimaryImageOfPage } from '../../src/next/metadata.js'
import { createOgRoute } from '../../src/next/route.js'
import { ogImagePlugin } from '../../src/plugin/index.js'
import { payloadHeroLoader } from '../../src/render/hero.js'
import { loadTestFonts, uploadsFrom } from '../helpers.js'
import { configOf, upload } from '../presets/harness.js'

afterEach(() => setTestRuntime(null))

async function boot(record: [number, number] = [1600, 1000]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'og-photo-images-'))
  await writeFile(
    path.join(dir, 'hero.jpg'),
    await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#3a6' } })
      .jpeg()
      .toBuffer(),
  )
  const uploads: Record<string, Record<string, unknown>> = { 1: upload(1, 'hero.jpg', record[0], record[1]) }
  const docs: Record<string, Record<string, unknown>> = {
    1: { id: 1, slug: 'a', title: 'A', heroImage: 1 },
    2: { id: 2, slug: 'b', title: 'B' },
    3: { id: 3, slug: 'c', title: 'C', heroImage: 99 }, // an upload nobody can read
  }
  const state = ogImagePlugin({ collections: ['posts'] })(configOf()).custom?.[CUSTOM_KEY] as OgState
  state.fonts = loadTestFonts
  const events: OgEvent[] = []
  const read = async (_c: string, id: string | number) => uploads[String(id)] ?? null
  const source: DocSource = {
    published: async (_t, slug) => Object.values(docs).find((d) => d.slug === slug) ?? null,
    publishedById: async (_t, id) => docs[String(id)] ?? null,
    listPublished: async () => ({ docs: Object.values(docs), totalDocs: Object.keys(docs).length }),
    draft: async () => null,
    site: async () => ({ name: 'Site' }),
    related: read,
    uploads: uploadsFrom(read),
  }
  const rt = buildRuntime({ ...state, events: { ...state.events, emit: (e: OgEvent) => events.push(e) } } as OgState, {} as Payload, {
    source,
    store: memoryStore(),
    renderer: {
      render: async () =>
        new Uint8Array(
          await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
            .png()
            .toBuffer(),
        ),
    },
    heroLoader: payloadHeroLoader({ staticDirs: async () => [dir] }),
    isDraftRequest: async () => false,
  })
  setTestRuntime(rt)
  return { rt, events, config: {} as never, route: createOgRoute({ config: {} as never }) }
}

describe('ogPhotoImages', () => {
  it('lists the photographs only, 16:9, 4:3 and 1:1, and every URL is served by the route at the advertised size', async () => {
    const { config, route } = await boot()
    const images = await ogPhotoImages({ config, target: 'posts', doc: { id: 1 } })
    expect(images.map((i) => [i.ratio, i.width, i.height])).toEqual([
      ['16x9', 1200, 675],
      ['4x3', 1200, 900],
      ['1x1', 1000, 1000],
    ])
    for (const image of images) {
      expect(image.url).toMatch(/^https:\/\/www\.example\.test\/og\/posts\/a\/photo-(16x9|4x3|1x1)\.jpg\?v=[0-9a-f]{12}$/)
      expect(image.url).not.toContain('card.')
      const file = new URL(image.url).pathname.split('/').pop() as string
      const res = await route.GET(new Request(image.url), { params: Promise.resolve({ kind: 'posts', slug: 'a', file }) })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/jpeg')
      const meta = await sharp(new Uint8Array(await res.arrayBuffer())).metadata()
      expect([meta.width, meta.height]).toEqual([image.width, image.height])
    }
  })

  it('the primary image of the page is the 16:9 crop', async () => {
    const { config } = await boot()
    const images = await ogPhotoImages({ config, target: 'posts', doc: { id: 1 } })
    expect(ogPrimaryImageOfPage(images)).toEqual({ '@type': 'ImageObject', url: images[0]?.url, width: 1200, height: 675 })
    expect(ogPrimaryImageOfPage([...images].reverse())?.url).toBe(images[0]?.url) // by ratio, not by position
    expect(ogPrimaryImageOfPage([])).toBeUndefined()
  })

  it('og:image stays the one branded card: a photo is never in the metadata', async () => {
    const { config } = await boot()
    const meta = await ogMetadata({ config, target: 'posts', doc: { id: 1 } })
    const images = (meta.openGraph as { images: Array<{ url: string }> }).images
    expect(images).toHaveLength(1)
    expect(images[0]?.url).toMatch(/\/og\/posts\/a\/card\.(jpg|png)\?v=/)
    expect(JSON.stringify(meta)).not.toContain('photo-')
  })

  it('a page with no hero, an unreadable hero or no document lists nothing', async () => {
    const { config } = await boot()
    expect(await ogPhotoImages({ config, target: 'posts', doc: { id: 2 } })).toEqual([])
    expect(await ogPhotoImages({ config, target: 'posts', doc: { id: 3 } })).toEqual([])
    expect(await ogPhotoImages({ config, target: 'posts', doc: { id: 404 } })).toEqual([])
    expect(await ogPhotoImages({ config, target: 'posts', doc: null })).toEqual([])
  })

  it('a failure throws in development and test, and is an event with [] in production', async () => {
    const { config, events } = await boot()
    const rt = await import('../../src/internal/runtime.js')
    const broken = {
      resolvePhotos: async () => {
        throw new Error('db down')
      },
      emit: (e: OgEvent) => events.push(e),
    }
    rt.setTestRuntime(broken as never)
    await expect(ogPhotoImages({ config, target: 'posts', doc: { id: 1 } })).rejects.toThrow('db down')
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect(await ogPhotoImages({ config, target: 'posts', doc: { id: 1 } })).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
    expect(events.at(-1)).toMatchObject({ name: 'render_error' })
  })
})

describe('og_audit Discover readiness', () => {
  it('each row says whether the page has a photo set and whether its 16:9 crop is 1200 px wide, and the page says what it cannot check', async () => {
    const { rt } = await boot()
    const page = await rt.inspect.audit({ scope: 'posts', page: 1, limit: 10 })
    const row = (slug: string) => page.rows.find((r) => r.slug === slug)?.discover
    expect(row('a')).toEqual({
      photos: [
        { ratio: '16x9', width: 1200, height: 675 },
        { ratio: '4x3', width: 1200, height: 900 },
        { ratio: '1x1', width: 1000, height: 1000 },
      ],
      large: true,
    })
    expect(row('b')).toMatchObject({ photos: [], large: null, reason: expect.stringContaining('no usable hero photograph') })
    expect(row('c')).toMatchObject({ photos: [], large: null })
    expect(page.summary.discover).toEqual({ withPhotoSet: 1, large: 1 })
    expect(page.discoverNote).toContain('max-image-preview:large')
    expect(page.discoverNote).toContain('cannot see')
  })

  it('a 16:9 crop under 1200 px is a set that cannot earn the large preview', async () => {
    const { rt } = await boot([900, 600])
    const page = await rt.inspect.audit({ scope: 'posts', page: 1, limit: 10 })
    expect(page.rows.find((r) => r.slug === 'a')?.discover).toMatchObject({
      large: false,
      photos: [{ ratio: '16x9', width: 900, height: 506 }, { ratio: '4x3' }, { ratio: '1x1' }],
    })
    expect(page.summary.discover).toEqual({ withPhotoSet: 1, large: 0 })
  })
})
