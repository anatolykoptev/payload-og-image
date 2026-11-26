/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a draft-only upload, or an upload nobody draws, reaching a card.
 * - payloadSource.ts `readMany` without the `_status: published` predicate -> "a draft-only upload never reaches the hero resolver" RED
 * - payloadSource.ts `first()` rethrowing Forbidden -> "a collection the public may not read is no document, not an error" RED
 * - uploads.ts `verified()` without the VERIFIED brand -> "a verified upload carries its collection, a copy of it does not" RED
 * - payloadSource.ts `readMany` reading with `overrideAccess: true` -> "an upload is read with the caller's access, never as the server" RED
 * - uploads.ts `fillUploads` ignoring `drawn` (every field read) -> "a collection that forces the text preset reads no hero record" RED
 * - presets/target.ts `uploadFields` leaving the hero path out for 'auto' -> "an auto collection still reads its hero" RED
 * - uploads.ts `fillUploads` trusting an object that carries an id -> "a hand-built upload object in a document is read afresh" RED
 * - uploads.ts `fillUploads` skipping an object value (`typeof raw === 'object'` -> continue) -> "a hand-built object at the share-image path is read afresh" RED
 * - uploads.ts `fillUploads` keeping an object with no usable id -> "an object with no usable id at an upload path is no upload" RED */
import { describe, expect, it } from 'vitest'
import { collectionOf, createUploadReader, fillUploads, isVerified } from '../../src/internal/uploads.js'
import { setup } from './uploadHarness.js'

describe('uploads read behind a card', () => {
  it('a draft-only upload never reaches the hero resolver', async () => {
    const { resolve } = setup({ collections: ['posts'] }, [
      { id: 10, slug: 'a', title: 'A', heroImage: 1 },
      { id: 11, slug: 'b', title: 'B', heroImage: 2 },
    ])
    const a = await resolve('a')
    expect(a.kind === 'generated' && a.hero).toMatchObject({ id: 1 })
    const b = await resolve('b')
    expect(b.kind === 'generated' && b.hero).toBeNull()
  })
  it("an upload is read with the caller's access, never as the server", async () => {
    const { resolve, mediaFinds } = setup({ collections: ['posts'] })
    await resolve('a')
    expect(mediaFinds()).toHaveLength(1)
    expect(mediaFinds()[0]).toMatchObject({ overrideAccess: false, draft: false, depth: 0 })
    expect(mediaFinds()[0]).not.toHaveProperty('user')
  })
  it('a hand-built upload object in a document is read afresh, so a draft-only one is dropped', async () => {
    const { source, resolveDoc } = setup({ collections: ['posts'] })
    const real = await source.published('posts', 'a')
    const handBuilt = { ...real, heroImage: { id: 2, url: '/media/draft.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' } }
    const card = await resolveDoc(handBuilt)
    expect(card.kind === 'generated' && card.hero).toBeNull()
  })
  it('a hand-built object at the share-image path is read afresh: a draft-only one is no share image, a published one is the stored record', async () => {
    const meta = { name: 'meta', type: 'group', fields: [{ name: 'image', type: 'upload', relationTo: 'media' }] }
    const { source, resolveDoc } = setup({ collections: ['posts'] }, undefined, { fields: [meta] })
    const real = await source.published('posts', 'a')
    const file = (id: number, url: string) => ({ id, url, width: 1200, height: 800, mimeType: 'image/jpeg' })
    const draftOnly = await resolveDoc({ ...real, meta: { image: file(2, '/media/forged-draft.jpg') } })
    expect(draftOnly.kind).toBe('generated')
    const published = await resolveDoc({ ...real, meta: { image: file(3, '/media/forged.jpg') } })
    expect(published.kind === 'own' && published.image.url).toBe('https://www.example.test/media/a.jpg')
  })
  it('a verified upload carries its collection, a copy of it does not', async () => {
    const { resolve } = setup({ collections: ['posts'] })
    const card = await resolve('a')
    const hero = card.kind === 'generated' ? card.hero : null
    expect(hero && collectionOf(hero)).toBe('media')
    expect(isVerified(hero)).toBe(true)
    expect(isVerified({ ...hero })).toBe(false)
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
    const { resolve, mediaFinds } = setup({ collections: { posts: { preset: 'text' } } })
    await resolve('a')
    expect(mediaFinds()).toHaveLength(0)
  })
  it('an auto collection still reads its hero', async () => {
    const { resolve, mediaFinds } = setup({ collections: { posts: { preset: 'auto' } } })
    const card = await resolve('a')
    expect(card.kind === 'generated' && card.hero).toMatchObject({ id: 1 })
    expect(mediaFinds()).toHaveLength(1)
  })
  it('an object with no usable id at an upload path is no upload', async () => {
    const reader = createUploadReader(async () => new Map())
    const fields = [{ path: ['meta', 'image'], relationTo: 'media' }]
    const doc = { meta: { image: { filename: 'secret.png', id: { filename: 'secret.png' }, url: '/x' } } }
    expect((await fillUploads(reader, doc, fields)).meta.image).toBeNull()
    expect(doc.meta.image).not.toBeNull() // the document the source returned is never changed
  })
})
