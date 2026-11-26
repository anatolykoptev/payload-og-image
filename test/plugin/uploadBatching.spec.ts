/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a card that reads its uploads one by one, or twice, is correct
 * and slow, so only a count of the source's calls can see it.
 * - uploads.ts `createUploadReader` reading one id per call instead of one `id in` find per collection -> "a three-image stack card" RED
 * - uploads.ts `createUploadReader` forgetting what it read (no memo) -> "a photo preset card reads its hero once" RED
 * - resolve.ts `heroOf` reading through a fresh reader instead of `i.uploads` -> "a photo preset card reads its hero once" RED
 * - handler.ts `resolveSizes`-style callers not sharing the reader -> "the sizes of one page share one read" RED */
import { describe, expect, it } from 'vitest'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { setup } from './uploadHarness.js'

const gallery = defineTemplate<{ title: string }>({
  id: 'gallery',
  revision: '1',
  textFields: ['title'],
  imageBoxes: { stack: { width: 200, height: 100 } },
  render: () => null as never,
})
const stack = defineTarget<any, any>({
  path: '/og/:kind/:slug/card.png',
  collection: 'posts',
  template: 'gallery',
  props: ({ doc }: any) => ({ title: doc.title }),
  images: ({ doc }: any) => ({ stack: doc.photos }),
})

describe('what a card costs the database', () => {
  it('a photo preset card reads its hero once: one document find, one upload find', async () => {
    const { resolve, docFinds, mediaFinds } = setup({ collections: ['posts'] })
    const card = await resolve('a')
    expect(card.kind === 'generated' && card.hero).toMatchObject({ id: 1 })
    expect([docFinds().length, mediaFinds().length]).toEqual([1, 1])
  })
  it('a three-image stack card: one document find, one batched upload find for all three', async () => {
    const { resolve, docFinds, mediaFinds } = setup({ collections: ['posts'] }, [{ id: 10, slug: 'a', title: 'A', photos: [3, 4, 5] }], {
      targets: { stack },
      templates: [gallery],
    })
    const card = await resolve('a')
    expect(card.kind === 'generated' && card.images[0]?.uploads.map((u) => u.id)).toEqual([3, 4, 5])
    expect([docFinds().length, mediaFinds().length]).toEqual([1, 1])
    expect(JSON.stringify(mediaFinds()[0]?.where)).toContain('"in":["3","4","5"]')
  })
  it('the hero named again as a stack image costs no second read', async () => {
    const both = defineTarget<any, any>({
      ...stack,
      hero: ({ doc }: any) => doc.heroImage,
      images: ({ doc }: any) => ({ stack: [doc.heroImage, 3] }),
    })
    const { resolve, mediaFinds } = setup({ collections: ['posts'] }, [{ id: 10, slug: 'a', title: 'A', heroImage: 1 }], {
      targets: { stack: both },
      templates: [gallery],
    })
    await resolve('a')
    // The hero field in one find, image 3 (named only by the stack) in another: the hero is never read twice.
    expect(mediaFinds().map((f) => JSON.stringify(f.where).match(/"equals":(\d+|"\d+")/)?.[1])).toEqual(['"1"', '"3"'])
  })
})
