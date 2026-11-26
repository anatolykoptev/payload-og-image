/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a draft-only upload, or an upload nobody draws, reaching a card.
 * - payloadSource.ts `readRelated` without the `_status: published` predicate -> "a draft-only upload never reaches the hero resolver" RED
 * - payloadSource.ts `first()` rethrowing Forbidden -> "a collection the public may not read is no document, not an error" RED
 * - payloadSource.ts `uploadSource.set` removed -> "an upload it reads is remembered with the collection it came from" RED
 * - payloadSource.ts `populateUploads` reading with `overrideAccess: true` -> "an upload is read with the caller's access, never as the server" RED
 * - payloadSource.ts `withUploads` without `uploadNeeds` (every field read) -> "a collection that forces the text preset reads no hero record" RED
 * - presets/target.ts `uploadNeeds.set` leaving the hero path out for 'auto' -> "an auto collection still reads its hero" RED */
import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { uploadSource } from '../../src/internal/needs.js'
import { createState } from '../../src/internal/state.js'
import type { OgImagePluginInput } from '../../src/plugin/index.js'
import { payloadSource, populateUploads } from '../../src/plugin/payloadSource.js'
import { expandPresets } from '../../src/presets/expand.js'
import { configOf, upload } from '../presets/harness.js'

/** Upload 1 is published; upload 2 only exists as a draft. A read that carries the published predicate never sees 2. */
const MEDIA: Record<number, Record<string, unknown>> = {
  1: { ...upload(1, 'hero.jpg', 1200, 800), _status: 'published' },
  2: { ...upload(2, 'draft.jpg', 1200, 800), _status: 'draft' },
}

function setup(input: OgImagePluginInput, posts: Record<string, unknown>[] = [{ id: 10, slug: 'a', title: 'A', heroImage: 1 }]) {
  const reads: Array<Record<string, any>> = []
  const config = configOf()
  const collections = Object.fromEntries(
    (config.collections ?? []).map((c) => [c.slug, { config: { ...c, versions: c.slug === 'users' ? undefined : { drafts: true } } }]),
  )
  const payload = {
    config: { admin: { user: 'users' } },
    collections,
    find: async (a: Record<string, any>) => {
      if (a.collection === 'media') {
        reads.push(a)
        const id = a.where?.id?.equals ?? a.where?.and?.[0]?.id?.equals
        const publishedOnly = JSON.stringify(a.where ?? {}).includes('"published"')
        const hit = MEDIA[id]
        const visible = hit && (a.draft === true || !publishedOnly || hit._status === 'published')
        return { docs: visible ? [{ ...hit }] : [], totalDocs: visible ? 1 : 0 }
      }
      const id = a.where?.and?.[1]?.id?.equals ?? a.where?.id?.equals
      const slug = a.where?.and?.[0]?.slug?.equals
      const docs = posts.filter((p) => (slug === undefined ? p.id === id : p.slug === slug)).map((p) => structuredClone(p))
      return { docs, totalDocs: docs.length }
    },
  } as unknown as Payload
  const options = expandPresets(input, config)
  const source = payloadSource(payload, createState(options, 'https://www.example.test'), async () => ({ name: 'S' }))
  return { source, reads, payload }
}

describe('uploads read behind a card', () => {
  it('a draft-only upload never reaches the hero resolver', async () => {
    const { source } = setup({ collections: ['posts'] }, [
      { id: 10, slug: 'a', title: 'A', heroImage: 1 },
      { id: 11, slug: 'b', title: 'B', heroImage: 2 },
    ])
    expect((await source.published('posts', 'a'))?.heroImage).toMatchObject({ id: 1 })
    expect((await source.published('posts', 'b'))?.heroImage).toBeNull()
  })
  it("an upload is read with the caller's access, never as the server", async () => {
    const { source, reads } = setup({ collections: ['posts'] })
    await source.published('posts', 'a')
    expect(reads).toHaveLength(1)
    expect(reads[0]).toMatchObject({ overrideAccess: false, draft: false, depth: 0 })
    expect(reads[0]).not.toHaveProperty('user')
  })
  it('a hand-built upload object in a document is read afresh, so a draft-only one is dropped', async () => {
    const { payload } = setup({ collections: ['posts'] })
    const doc = { id: 10, heroImage: { id: 2, url: '/media/draft.jpg' } }
    await populateUploads(payload, 'posts', doc)
    expect(doc.heroImage).toBeNull()
  })
  it('an upload it reads is remembered with the collection it came from, a copy is not', async () => {
    const { source } = setup({ collections: ['posts'] })
    const hero = (await source.published('posts', 'a'))?.heroImage as object
    expect(uploadSource.get(hero)).toBe('media')
    expect(uploadSource.get({ ...hero })).toBeUndefined()
  })
  it('a collection the public may not read is no document, not an error', async () => {
    const { source, payload } = setup({ collections: ['posts'] })
    const forbidden = Object.assign(new Error('You are not allowed to perform this action.'), { name: 'Forbidden', status: 403 })
    ;(payload as unknown as { find: unknown }).find = async () => {
      throw forbidden
    }
    expect(await source.published('posts', 'a')).toBeNull()
    expect(await source.publishedById('posts', 10)).toBeNull()
    ;(payload as unknown as { find: unknown }).find = async () => {
      throw new Error('db down')
    }
    await expect(source.published('posts', 'a')).rejects.toThrow('db down') // anything else still surfaces
  })
  it('a collection that forces the text preset reads no hero record', async () => {
    const { source, reads } = setup({ collections: { posts: { preset: 'text' } } })
    const doc = await source.published('posts', 'a')
    expect(reads).toHaveLength(0)
    expect(doc?.heroImage).toBe(1) // left as the bare id it was stored as: nothing verified is drawn from it
  })
  it('an auto collection still reads its hero', async () => {
    const { source, reads } = setup({ collections: { posts: { preset: 'auto' } } })
    expect((await source.published('posts', 'a'))?.heroImage).toMatchObject({ id: 1 })
    expect(reads).toHaveLength(1)
  })
})
