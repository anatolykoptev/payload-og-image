/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a tool call that opens a hundred upload reads at once.
 * - payloadSource.ts `listPublished` Promise.all over every document (no pool) -> "reads the uploads of a page a few at a time" RED
 * - payloadSource.ts `buildList` without `overrideAccess: false` / with `draft: true` -> "reads published documents as the public" RED */
import { describe, expect, it } from 'vitest'
import { createState } from '../../src/internal/state.js'
import { payloadSource } from '../../src/plugin/payloadSource.js'
import { defineTarget, defineTemplate } from '../../src/template.js'

const post = defineTemplate<{ title: string }>({ id: 'post', revision: '1', render: () => null as never })

describe('payloadSource.listPublished', () => {
  const setup = () => {
    const finds: Array<Record<string, unknown>> = []
    const payload = {
      config: {},
      collections: {
        notes: { config: { versions: { drafts: true }, fields: [{ type: 'upload', name: 'image', relationTo: 'media' }] } },
      },
      find: async (a: Record<string, unknown>) => {
        finds.push(a)
        return { docs: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, slug: `n${i}`, image: 100 + i })), totalDocs: 20 }
      },
    } as never
    const state = createState(
      {
        site: async () => ({ name: 'S' }),
        fonts: [],
        stacks: {},
        templates: [post],
        targets: { notes: defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({ title: 'x' }) }) },
        store: { memory: true },
      },
      'https://x.test',
    )
    return { source: payloadSource(payload, state, async () => ({ name: 'S' })), finds }
  }
  it('lists a page in one read and reads no upload: uploads are read per card, by the request reader', async () => {
    const s = setup()
    const r = await (s.source.listPublished as NonNullable<typeof s.source.listPublished>)('notes', { page: 1, limit: 20 })
    expect(r.docs).toHaveLength(20)
    expect(s.finds).toHaveLength(1)
    expect(r.docs[0]?.image).toBe(100) // a bare id, as stored
  })
  it('reads published documents as the public', async () => {
    const s = setup()
    await (s.source.listPublished as NonNullable<typeof s.source.listPublished>)('notes', { page: 2, limit: 5 })
    expect(s.finds[0]).toMatchObject({
      collection: 'notes',
      page: 2,
      limit: 5,
      draft: false,
      overrideAccess: false,
      where: { _status: { equals: 'published' } },
    })
    expect(s.finds[0]).not.toHaveProperty('user')
  })
})
