/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a named image the visitor may not read drawn on a public card, a stale card after an image is replaced, a hero that is a bare id drawn as no hero, a logo flattened onto the site's ground.
 * - resolve.ts `namedImages` trusts an object ref that carries a `url` instead of `readUpload` -> "an object that claims to be an upload the public may not read is left out" RED
 * - resolve.ts `namedImages` reads from `heroCollection` instead of `imageCollections[name]` -> "each name is read from its own collection" RED
 * - resolve.ts `namedImages` result left out of `cardVersion({ images })` -> "replacing one upload changes v; no image, or none that resolved, keeps v" RED
 * - resolve.ts `namedImages` returned in `GeneratedCard.images` always empty -> "named images reach the card" and handler "ctx.images carries the prepared images" RED
 * - resolve.ts `heroOf` returns null for a bare id (the `readUpload` branch removed) -> "a hero that is a bare id (a hasMany upload field at depth 0) is read by id" RED
 * - resolve.ts `MAX_CARD_IMAGES` ignored -> "at most 8 images in all, in the order given" RED
 * - handler.ts `loadImages` calls the loader without `keepAlpha: true` -> "named images are prepared in their own box and collection, never flattened" RED
 * - handler.ts `loadImages` uses `card.heroCollection` -> same test RED
 * - handler.ts `ctxFor` drops `images` -> "ctx.images carries the prepared images" RED
 * - handler.ts `downgraded` ignores `failed` -> "an image whose file cannot be prepared is left out and the card is served degraded, never stored" RED
 * - version tail without the collection (resolve.ts/version.ts `imageTail`) -> "the same id and updatedAt in another collection is another card" RED
 * - resolve.ts `namedImages` result not sorted by name -> "the order the target lists names in changes neither v nor the drawing" RED
 * - handler.ts `loadImages` accumulates into `{}` -> "a list named like an Object.prototype member is a list" RED
 * - resolve.ts `namedImages` maps whole arrays before the budget -> "a huge list is read only up to the budget" RED
 * - draw.ts empty `images` is `{}` -> "has no inherited members" RED
 * - hero.ts `keepAlpha` ignored -> heroLoader.spec "a named image keeps its alpha on a site that sets heroBackground" RED */
import { describe, expect, it, vi } from 'vitest'
import { createGate } from '../../src/internal/gate.js'
import { createCardHandler } from '../../src/internal/handler.js'
import { createMemo } from '../../src/internal/memo.js'
import { resolveCard } from '../../src/internal/resolve.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { collectionOf, type VerifiedUpload } from '../../src/internal/uploads.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts, realPng, uploadReaderOf, uploadsFrom } from '../helpers.js'

const upload = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  url: `/media/${id}.png`,
  filename: `${id}.png`,
  updatedAt: 'u1',
  ...over,
})

const gallery = defineTemplate<{ title: string }>({
  id: 'gallery',
  revision: '1',
  textFields: ['title'],
  imageBoxes: { stack: { width: 200, height: 100 }, logo: { width: 80, height: 40 } },
  render: (p, ctx) =>
    ({
      type: 'div',
      props: {
        // Drawn in the dictionary's own order: a template can observe it.
        children: [p.title, ...Object.values(ctx.images).flatMap((list) => list ?? [])],
      },
    }) as never,
})
const fallback = defineTemplate<{ site: string }>({ id: 'fb', revision: '1', render: () => ({ type: 'div', props: {} }) as never })

/** A `related` over a table of uploads by collection and id: what the visitor may read. */
const relatedOf = (table: Record<string, Record<string, unknown>>) =>
  vi.fn(async (collection: string, id: string | number) => (table[collection]?.[String(id)] as Record<string, unknown> | undefined) ?? null)

const target = (over: Record<string, unknown> = {}) =>
  defineTarget<any, any>({
    path: '/og/:kind/:slug/card.png',
    template: 'gallery',
    props: ({ doc }: any) => ({ title: doc.title }),
    images: ({ doc }: any) => ({ stack: doc.photos }),
    ...over,
  })

const base = async () => {
  const { fonts, digest } = await loadTestFonts()
  return {
    targetName: 'posts',
    site: { name: 'S' },
    host: 'x.test',
    serverUrl: 'https://x.test',
    templates: new Map([['gallery', gallery]]),
    fonts,
    fontsDigest: digest,
    stacks: { title: ['Inter'] },
    uploadCollection: 'media',
  }
}
const run = async (over: Record<string, unknown>) => {
  const input = { ...(await base()), ...over } as { related?: Parameters<typeof uploadReaderOf>[0] }
  const r = await resolveCard({ ...input, uploads: uploadReaderOf(input.related) } as never)
  if (r.kind !== 'generated') throw new Error(`expected a generated card, got ${r.kind}`)
  return r
}
const doc = (photos: unknown) => ({ id: 1, slug: 'a', title: 'A', photos })

describe('named images: resolving', () => {
  it('named images reach the card: ids, numbers and objects are all re-read by id, in order', async () => {
    const related = relatedOf({ media: { 1: upload(1), 2: upload(2), 3: upload(3) } })
    const r = await run({ target: target(), doc: doc([1, '2', { id: 3 }]), related })
    expect(r.images).toEqual([{ name: 'stack', uploads: [upload(1), upload(2), upload(3)] }])
    expect(related.mock.calls.map(([c, id]) => `${c}/${id}`)).toEqual(['media/1', 'media/2', 'media/3'])
  })
  it('an object that claims to be an upload the public may not read is left out: only the id it names is used', async () => {
    const related = relatedOf({ media: { 1: upload(1) } }) // 2 is private: the visitor's read answers null
    const claimed = upload(2, { filename: 'secret.png' })
    const r = await run({ target: target(), doc: doc([{ ...claimed }, 1]), related })
    expect(r.images[0]?.uploads.map((u) => u.id)).toEqual([1])
    const alone = await run({ target: target(), doc: doc([{ ...claimed }]), related })
    expect(alone.images).toEqual([]) // nothing resolved: no list at all
  })
  it('an upload with no file, or a ref with no id, is no image', async () => {
    const related = relatedOf({ media: { 1: { id: 1, url: '' }, 2: upload(2) } })
    const r = await run({ target: target(), doc: doc([1, 2, null, {}, true, 'x']), related })
    expect(r.images[0]?.uploads.map((u) => u.id)).toEqual([2])
  })
  it('each name is read from its own collection: imageCollections, else heroCollection, else the only upload collection', async () => {
    const related = relatedOf({ media: { 1: upload(1) }, logos: { 1: upload(1, { filename: 'logo.png' }) } })
    const t = target({ images: () => ({ stack: [1], logo: 1 }), imageCollections: { logo: 'logos' } })
    const r = await run({ target: t, doc: doc([]), related })
    expect(r.images.map((i) => [i.name, collectionOf(i.uploads[0] as VerifiedUpload), i.uploads[0]?.filename])).toEqual([
      ['logo', 'logos', 'logo.png'], // canonical order: by name
      ['stack', 'media', '1.png'],
    ])
    const viaHero = await run({ target: target({ heroCollection: 'logos' }), doc: doc([1]), related })
    expect(collectionOf(viaHero.images[0]?.uploads[0] as VerifiedUpload)).toBe('logos')
  })
  it('a target whose images cannot be read from any collection, or that the template does not declare, is refused with a reason', async () => {
    const related = relatedOf({})
    await expect(run({ target: target(), doc: doc([1]), related, uploadCollection: undefined })).rejects.toThrow(/imageCollections\.stack/)
    const t = target({ images: () => ({ banner: [1] }) })
    await expect(run({ target: t, doc: doc([1]), related })).rejects.toThrow(/"banner".*does not declare in imageBoxes/)
    const bad = target({ images: () => ({ '__proto__x y': [1] }) })
    await expect(run({ target: bad, doc: doc([1]), related })).rejects.toThrow(/must match/)
  })
  it('at most 8 images in all, in the order given across names', async () => {
    const all = Object.fromEntries(Array.from({ length: 12 }, (_, n) => [String(n + 1), upload(n + 1)]))
    const related = relatedOf({ media: all })
    const t = target({ images: () => ({ stack: [1, 2, 3, 4, 5], logo: [6, 7, 8, 9, 10] }) })
    const r = await run({ target: t, doc: doc([]), related })
    expect(r.images.map((i) => [i.name, i.uploads.map((u) => u.id)])).toEqual([
      ['logo', [6, 7, 8]], // canonical order: by name; the budget was spent in the order given
      ['stack', [1, 2, 3, 4, 5]],
    ])
  })
  it('a hero that is a bare id (a hasMany upload field at depth 0) is read by id, from heroCollection or the only upload collection', async () => {
    const related = relatedOf({ media: { 7: upload(7) } })
    const t = defineTarget<any, any>({
      path: '/og/:kind/:slug/card.png',
      template: 'gallery',
      props: ({ doc }: any) => ({ title: doc.title }),
      hero: ({ doc }: any) => doc.photos?.[0],
    })
    const r = await run({ target: t, doc: doc([7]), related })
    expect(r.hero).toEqual(upload(7))
    // It is part of the version: the same card with no photo is another URL.
    expect((await run({ target: t, doc: doc([]), related })).v).not.toBe(r.v)
    // Two upload collections and none named: nothing to read it from, so no hero (as before).
    expect((await run({ target: t, doc: doc([7]), related, uploadCollection: undefined })).hero).toBeNull()
    expect((await run({ target: { ...t, heroCollection: 'media' }, doc: doc([7]), related, uploadCollection: undefined })).hero).toEqual(
      upload(7),
    )
    // A bare id the visitor may not read is no hero.
    expect((await run({ target: t, doc: doc([8]), related })).hero).toBeNull()
  })
})

describe('named images: the version', () => {
  const v = async (photos: unknown, table: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    (await run({ target: target(extra), doc: doc(photos), related: relatedOf({ media: table }) })).v
  it('replacing one upload changes v; no image, or none that resolved, keeps v', async () => {
    const none = (await run({ target: target({ images: undefined }), doc: doc([1]), related: relatedOf({}) })).v
    // Empty lists, nothing given, and images that all failed to resolve hash exactly as a target with no `images` at all.
    expect(await v([], { 1: upload(1) })).toBe(none)
    expect(await v([1], {})).toBe(none)
    expect(await v(undefined, { 1: upload(1) })).toBe(none)
    const one = await v([1], { 1: upload(1) })
    expect(one).not.toBe(none)
    expect(await v([1], { 1: upload(1) })).toBe(one) // stable
    expect(await v([1], { 1: upload(1, { updatedAt: 'u2' }) })).not.toBe(one) // replaced file
    expect(await v([2], { 2: upload(2) })).not.toBe(one) // another upload
    expect(await v([1, 2], { 1: upload(1), 2: upload(2) })).not.toBe(one)
    expect(await v([2, 1], { 1: upload(1), 2: upload(2) })).not.toBe(await v([1, 2], { 1: upload(1), 2: upload(2) })) // order is the drawing order
  })
  it('the same uploads under another name are another card', async () => {
    const related = relatedOf({ media: { 1: upload(1) } })
    const stack = await run({ target: target({ images: () => ({ stack: [1] }) }), doc: doc([]), related })
    const logo = await run({ target: target({ images: () => ({ logo: [1] }) }), doc: doc([]), related })
    expect(logo.v).not.toBe(stack.v)
  })
})

describe('named images: canonical order, provenance, budget', () => {
  it('the same id and updatedAt in another collection is another card', async () => {
    const related = relatedOf({ media: { 1: upload(1) }, logos: { 1: upload(1) } })
    const a = await run({ target: target({ images: () => ({ stack: [1] }) }), doc: doc([]), related })
    const b = await run({ target: target({ images: () => ({ stack: [1] }), imageCollections: { stack: 'logos' } }), doc: doc([]), related })
    expect(b.v).not.toBe(a.v)
  })
  it('a huge list is read only up to the budget', async () => {
    const related = relatedOf({ media: Object.fromEntries(Array.from({ length: 20 }, (_, n) => [String(n), upload(n)])) })
    let reads = 0
    const huge = new Proxy(
      Array.from({ length: 100_000 }, (_, n) => n % 20),
      {
        get(t, k, r) {
          if (typeof k === 'string' && /^\d+$/.test(k)) reads += 1
          return Reflect.get(t, k, r)
        },
      },
    )
    const r = await run({ target: target({ images: () => ({ stack: huge, logo: huge }) }), doc: doc([]), related })
    expect(r.images.flatMap((i) => i.uploads)).toHaveLength(8)
    expect(reads).toBeLessThanOrEqual(10)
  })
})

describe('the template context', () => {
  it('has no inherited members: an empty images dictionary answers nothing for `constructor`', async () => {
    const { templateContext } = await import('../../src/internal/draw.js')
    const ctx = templateContext({ host: 'x.test', fonts: [], stacks: {}, hero: null })
    expect(Object.getPrototypeOf(ctx.images)).toBeNull()
    expect((ctx.images as Record<string, unknown>).constructor).toBeUndefined()
  })
})

describe('named images: drawing', () => {
  function setup(loader: (...a: any[]) => Promise<string | null>, table: Record<string, Record<string, unknown>>, targetOver = {}) {
    const rendered: string[] = []
    const store = memoryStore()
    const put = vi.spyOn(store, 'put')
    const heroLoader = vi.fn(loader)
    const related = relatedOf(table)
    const h = createCardHandler({
      targets: {
        posts: target({
          imageCollections: { logo: 'logos' },
          images: ({ doc }: any) => ({ stack: doc.photos, logo: doc.logo }),
          ...targetOver,
        }),
      },
      statics: {},
      templates: new Map([['gallery', gallery]]),
      fonts: loadTestFonts,
      stacks: { title: ['Inter'] },
      serverUrl: 'https://x.test',
      source: {
        published: async () => ({ id: 1, slug: 'a', title: 'A', photos: [1, 2], logo: 5 }),
        publishedById: async () => null,
        draft: async () => null,
        site: async () => ({ name: 'S' }),
        related,
        uploads: uploadsFrom(related),
      },
      store,
      renderer: {
        render: vi.fn(async (el: unknown) => {
          rendered.push(JSON.stringify(el))
          return realPng(JSON.stringify(el))
        }),
      },
      heroLoader,
      uploadCollection: 'media',
      gate: createGate(),
      memo: createMemo(),
      events: { emit: vi.fn() },
      isDraftRequest: async () => false,
      fallback,
    } as never)
    return { h, heroLoader, rendered, put }
  }
  const get = (h: ReturnType<typeof setup>['h']) =>
    h.GET(new Request('https://x.test/og/posts/a/card.png'), { params: Promise.resolve({ kind: 'posts', slug: 'a' }) })
  const table = { media: { 1: upload(1), 2: upload(2) }, logos: { 5: upload(5, { filename: 'logo.png' }) } }

  it('ctx.images carries the prepared images, per name and in order', async () => {
    const { h, rendered } = setup(async (u: { id: number }) => `data:image/png;base64,I${u.id}`, table)
    const r = await get(h)
    expect([r.status, r.headers.get('x-og-cache')]).toEqual([200, 'render'])
    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toContain('data:image/png;base64,I1')
    expect(rendered[0]?.indexOf('base64,I1')).toBeLessThan(rendered[0]?.indexOf('base64,I2') as number)
    expect(rendered[0]).toContain('base64,I5') // the logo, its own name
  })
  it('named images are prepared in their own box and collection, never flattened', async () => {
    const { h, heroLoader } = setup(async () => 'data:image/png;base64,AAAA', table)
    await get(h)
    const calls = heroLoader.mock.calls.map(([u, box, where]) => [u.id, box, where])
    expect(calls).toEqual(
      expect.arrayContaining([
        [1, { width: 200, height: 100 }, { collection: 'media', keepAlpha: true }],
        [2, { width: 200, height: 100 }, { collection: 'media', keepAlpha: true }],
        [5, { width: 80, height: 40 }, { collection: 'logos', keepAlpha: true }],
      ]),
    )
    expect(calls).toHaveLength(3)
  })
  it('an image whose file cannot be prepared is left out and the card is served degraded, never stored', async () => {
    const { h, rendered, put } = setup(async (u: { id: number }) => (u.id === 2 ? null : `data:image/png;base64,I${u.id}`), table)
    const r = await get(h)
    expect([r.status, r.headers.get('x-og-cache')]).toEqual([200, 'downgraded'])
    expect(put).not.toHaveBeenCalled()
    expect(rendered[0]).toContain('base64,I1')
    expect(rendered[0]).not.toContain('base64,I2')
  })
  it('the order the target lists names in changes neither v nor the drawing', async () => {
    const order = (keys: string[]) => {
      const t = { images: () => Object.fromEntries(keys.map((k) => [k, k === 'logo' ? [5] : [1, 2]])) }
      return setup(async (u: { id: number }) => `data:image/png;base64,I${u.id}`, table, t)
    }
    const a = order(['stack', 'logo'])
    const b = order(['logo', 'stack'])
    const ra = await get(a.h)
    const rb = await get(b.h)
    expect(ra.headers.get('etag')).toBe(rb.headers.get('etag'))
    expect(b.rendered[0]).toBe(a.rendered[0])
    expect(a.rendered[0]?.indexOf('base64,I5')).toBeLessThan(a.rendered[0]?.indexOf('base64,I1') as number) // canonical: logo before stack
  })
  it('a list named like an Object.prototype member is a list', async () => {
    const odd = defineTemplate<{ title: string }>({
      id: 'gallery',
      revision: '1',
      textFields: ['title'],
      imageBoxes: { constructor: { width: 10, height: 10 }, toString: { width: 10, height: 10 } },
      render: (p, ctx) => {
        // Typed as lists, prototype names included: this line is the type test.
        const lists: Array<readonly string[] | undefined> = [ctx.images.constructor, ctx.images.toString]
        void lists
        return {
          type: 'div',
          props: {
            children: [p.title, ...Object.values(ctx.images).flatMap((list) => list ?? [])],
          },
        } as never
      },
    })
    const rendered: string[] = []
    const h = createCardHandler({
      targets: { posts: target({ images: () => ({ constructor: [1], toString: [2] }) }) },
      statics: {},
      templates: new Map([['gallery', odd]]),
      fonts: loadTestFonts,
      stacks: { title: ['Inter'] },
      serverUrl: 'https://x.test',
      source: {
        published: async () => ({ id: 1, slug: 'a', title: 'A' }),
        publishedById: async () => null,
        draft: async () => null,
        site: async () => ({ name: 'S' }),
        related: relatedOf({ media: { 1: upload(1), 2: upload(2) } }),
        uploads: uploadsFrom(relatedOf({ media: { 1: upload(1), 2: upload(2) } })),
      },
      store: memoryStore(),
      renderer: {
        render: async (el: unknown) => {
          rendered.push(JSON.stringify(el))
          return realPng('x')
        },
      },
      heroLoader: async (u: { id: number }) => `data:image/png;base64,I${u.id}`,
      uploadCollection: 'media',
      gate: createGate(),
      memo: createMemo(),
      events: { emit: vi.fn() },
      isDraftRequest: async () => false,
      fallback,
    } as never)
    const r = await get(h)
    expect([r.status, r.headers.get('x-og-cache')]).toEqual([200, 'render'])
    expect(rendered[0]).toContain('base64,I1')
    expect(rendered[0]).toContain('base64,I2')
  })
  it('a card with no named image calls the loader for none', async () => {
    const { h, heroLoader } = setup(async () => 'data:image/png;base64,AAAA', table, { images: undefined })
    await get(h)
    expect(heroLoader).not.toHaveBeenCalled()
  })
})
