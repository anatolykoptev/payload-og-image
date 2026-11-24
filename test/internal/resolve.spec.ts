/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a wrong card advertised, a stale URL, a colliding key.
 * - resolve.ts:96     drop `!sameUpload(seo, rawHero)`                     -> "3: an editor image that is the hero itself does not override the card" RED
 * - resolve.ts:96    drop the `isDeliberate` check                        -> "7: isDeliberate returning false is not shared" RED
 * - resolve.ts:98    ignore `target.share()`                              -> "6: share() returning an eligible photo is shared as is" RED
 * - resolve.ts:113    skip stripMissing                                    -> "10: a title with an emoji" RED
 * - resolve.ts:118 skip `template.required`                             -> "9: a blank title advertises nothing" RED
 * - resolve.ts:94     hash the raw hero (not only a usable upload)         -> "a hero without a file is no part of the version" RED
 * - resolve.ts:129     leave `host` out of the version                      -> "the host is part of the version" RED
 * - resolve.ts:120     use the raw slug even when blank                     -> "a blank slug falls back to the id" RED
 * - resolve.ts:71   do not encodeURIComponent path values               -> "11: cardPath encodes the key" RED
 * - resolve.ts:80     allow two targets with one kind                      -> "12: buildKindIndex throws on a duplicate kind" RED
 * - resolve.ts:110  fall back to an empty stack silently                 -> "a text field with no font stack throws" RED */
import { describe, expect, it } from 'vitest'
import { buildKindIndex, cardPath, resolveCard } from '../../src/internal/resolve.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts } from '../helpers.js'

const post = defineTemplate<{ title: string; label: string; site: string }>({
  id: 'post',
  revision: '1',
  required: (p) => !!p.title.trim(),
  textFields: ['title'],
  stacks: { title: 'title' },
  render: () => null as never,
})
const page = defineTemplate<{ title: string; label: string; site: string }>({
  id: 'page',
  revision: '1',
  textFields: ['title'],
  render: () => null as never,
})
const posts = defineTarget<any, any>({
  path: '/og/:kind/:slug/card.png',
  template: 'post',
  props: ({ doc, site }) => ({ title: doc.title ?? '', label: 'Blog', site: site.name }),
  hero: ({ doc }) => doc.heroImage,
})
const jpeg = { id: 7, url: '/media/a.jpg', width: 1200, height: 630, mimeType: 'image/jpeg', alt: 'Alt' }
const base = async () => {
  const { fonts, digest } = await loadTestFonts()
  return {
    target: posts,
    targetName: 'posts',
    site: { name: 'S' },
    host: 'x.test',
    serverUrl: 'https://x.test',
    templates: new Map([
      ['post', post],
      ['page', page],
    ]),
    fonts,
    fontsDigest: digest,
    stacks: { title: ['Inter'] },
    seoImage: { path: 'meta.image' },
  }
}
const generated = async (over: Record<string, unknown>) => {
  const r = await resolveCard({ ...(await base()), ...over } as never)
  if (r.kind !== 'generated') throw new Error(`expected a generated card, got ${r.kind}`)
  return r
}

describe('resolveCard', () => {
  it('1: no images -> generated card at the target path with the current v', async () => {
    const r = await resolveCard({ ...(await base()), doc: { id: 1, slug: 'a', title: 'A' } })
    expect(r.kind).toBe('generated')
    if (r.kind !== 'generated') return
    expect(r.url).toMatch(/^https:\/\/x\.test\/og\/posts\/a\/card\.png\?v=[0-9a-f]{12}$/)
    expect([r.size.width, r.size.height, r.type, r.alt]).toEqual([1200, 630, 'image/png', 'Blog: A'])
    expect(r.pageId).toMatch(/^[0-9a-f]{16}$/)
  })
  it('2: an eligible editor image is shared as is', async () => {
    const r = await resolveCard({ ...(await base()), doc: { id: 1, slug: 'a', title: 'A', meta: { image: jpeg } } })
    expect(r).toEqual({
      kind: 'own',
      image: { url: 'https://x.test/media/a.jpg', width: 1200, height: 630, type: 'image/jpeg', alt: 'Alt' },
    })
  })
  it('3: an editor image that is the hero itself does not override the card', async () => {
    const r = await resolveCard({ ...(await base()), doc: { id: 1, slug: 'a', title: 'A', meta: { image: jpeg }, heroImage: jpeg } })
    expect(r.kind).toBe('generated')
  })
  it('3b: the same upload compared as a bare id against a populated one is still the hero', async () => {
    const r = await resolveCard({ ...(await base()), doc: { id: 1, slug: 'a', title: 'A', meta: { image: jpeg }, heroImage: 7 } })
    expect(r.kind).toBe('generated')
  })
  it('4: an SVG with a size -> generated', async () => {
    const svg = { id: 8, url: '/m/a.svg', width: 1200, height: 630, mimeType: 'image/svg+xml' }
    expect((await resolveCard({ ...(await base()), doc: { id: 1, slug: 'a', title: 'A', meta: { image: svg } } })).kind).toBe('generated')
  })
  it('5: an unsized image -> generated', async () => {
    const unsized = { id: 8, url: '/m/a.jpg', mimeType: 'image/jpeg' }
    expect((await resolveCard({ ...(await base()), doc: { id: 1, slug: 'a', title: 'A', meta: { image: unsized } } })).kind).toBe(
      'generated',
    )
  })
  it('6: share() returning an eligible photo is shared as is', async () => {
    const target = defineTarget<any, any>({ ...posts, share: ({ doc }) => [doc.photo] })
    const r = await resolveCard({ ...(await base()), target, doc: { id: 1, slug: 'a', title: 'A', photo: jpeg } })
    expect(r.kind).toBe('own')
  })
  it('7: isDeliberate returning false is not shared', async () => {
    const seoImage = { path: 'meta.image', isDeliberate: () => false }
    const r = await resolveCard({ ...(await base()), seoImage, doc: { id: 1, slug: 'a', title: 'A', meta: { image: jpeg } } })
    expect(r.kind).toBe('generated')
  })
  it('8: a site.name change gives a different v (site data goes through props)', async () => {
    const doc = { id: 1, slug: 'a', title: 'A' }
    const a = await generated({ doc })
    const b = await generated({ doc, site: { name: 'Renamed' } })
    expect(b.v).not.toBe(a.v)
  })
  it('9: a blank title advertises nothing', async () =>
    expect((await resolveCard({ ...(await base()), doc: { id: 1, slug: 'a', title: '  ' } })).kind).toBe('none'))
  it('9b: a title that is only unsupported glyphs advertises nothing', async () =>
    expect((await resolveCard({ ...(await base()), doc: { id: 1, slug: 'a', title: '🚀🚀' } })).kind).toBe('none'))
  it('10: a title with an emoji reports it, is stripped, and the version is computed on the stripped props', async () => {
    const r = await generated({ doc: { id: 1, slug: 'a', title: 'Launch 🚀 day' } })
    expect(r.missing).toEqual(['🚀'])
    expect(r.props.title).toBe('Launch day')
    const plain = await generated({ doc: { id: 1, slug: 'a', title: 'Launch day' } })
    expect(r.v).toBe(plain.v)
  })
  it('text that lost nothing is left exactly as given', async () => {
    const r = await generated({ doc: { id: 1, slug: 'a', title: ' Spaced  out ' } })
    expect(r.props.title).toBe(' Spaced  out ')
  })
  it('11: cardPath encodes the key', () => expect(cardPath(posts, 'posts', 'a b/c')).toBe('/og/posts/a%20b%2Fc/card.png'))
  it('cardPath fills placeholders in one pass', () => {
    expect(cardPath(posts, 'posts', ':kind')).toBe('/og/posts/%3Akind/card.png')
    const byId = defineTarget<any, any>({ ...posts, path: '/cards/:id.png', kind: 'x' })
    expect(cardPath(byId, 'posts', '9')).toBe('/cards/9.png')
  })
  it('13: a collection without a slug field is keyed by its id', async () => {
    const target = defineTarget<any, any>({ ...posts, slugField: 'id' })
    const r = await generated({ target, doc: { id: 42, title: 'A' } })
    expect(r.key).toEqual({ kind: 'posts', slug: '42' })
    expect(r.url).toContain('/og/posts/42/card.png')
  })
  it('a blank slug falls back to the id instead of an empty path segment', async () => {
    const r = await generated({ doc: { id: 5, slug: '  ', title: 'A' } })
    expect(r.key.slug).toBe('5')
    expect(r.url).not.toContain('//card.png')
    expect((await resolveCard({ ...(await base()), doc: { slug: '', title: 'A' } })).kind).toBe('none')
  })
  it('the host is part of the version', async () => {
    const doc = { id: 1, slug: 'a', title: 'A' }
    expect((await generated({ doc, host: 'new.test' })).v).not.toBe((await generated({ doc })).v)
  })
  it('a hero without a file is no part of the version; a replaced hero is', async () => {
    const withHero = (h: unknown) => generated({ doc: { id: 1, slug: 'a', title: 'A', heroImage: h } })
    const none = await withHero(undefined)
    expect((await withHero({ id: 9 })).v).toBe(none.v)
    expect((await withHero(9)).v).toBe(none.v)
    const real = { id: 9, url: '/m/h.jpg', updatedAt: 'u1' }
    const a = await withHero(real)
    expect(a.v).not.toBe(none.v)
    expect((await withHero({ ...real, updatedAt: 'u2' })).v).not.toBe(a.v)
    expect(a.hero).toEqual(real)
  })
  it('the template can be chosen per document, and an unknown one names the target', async () => {
    const target = defineTarget<any, any>({ ...posts, template: ({ doc }) => (doc.isPage ? 'page' : 'post') })
    const r = await generated({ target, doc: { id: 1, slug: 'a', title: 'A', isPage: true } })
    expect(r.template.id).toBe('page')
    const bad = defineTarget<any, any>({ ...posts, template: 'ghost' })
    await expect(resolveCard({ ...(await base()), target: bad, doc: { id: 1, slug: 'a', title: 'A' } })).rejects.toThrow(
      /target "posts" names unknown template "ghost"/,
    )
  })
  it('a text field with no font stack throws instead of stripping every glyph', async () => {
    await expect(resolveCard({ ...(await base()), stacks: {}, doc: { id: 1, slug: 'a', title: 'A' } })).rejects.toThrow(
      /field "title" has no font stack/,
    )
    await expect(resolveCard({ ...(await base()), stacks: { title: [] }, doc: { id: 1, slug: 'a', title: 'A' } })).rejects.toThrow(
      /no font stack/,
    )
  })
  it('an own image of a doc whose title is not a string gets an empty alt, not "[object Object]"', async () => {
    const noAlt = { ...jpeg, alt: undefined }
    const r = await resolveCard({ ...(await base()), doc: { id: 1, slug: 'a', title: { root: {} }, meta: { image: noAlt } } })
    expect(r).toMatchObject({ kind: 'own', image: { alt: '' } })
  })
  it('a trailing slash on the server URL does not double up', async () => {
    const r = await generated({ serverUrl: 'https://x.test/', doc: { id: 1, slug: 'a', title: 'A' } })
    expect(r.url.startsWith('https://x.test/og/')).toBe(true)
  })
})

describe('buildKindIndex', () => {
  it('maps kinds to target names, defaulting the kind to the name', () => {
    expect(buildKindIndex({ posts, pages: { ...posts, kind: 'page' } })).toEqual({ posts: 'posts', page: 'pages' })
  })
  it('12: throws on a duplicate kind, naming both targets', () => {
    expect(() => buildKindIndex({ posts: { ...posts, kind: 'post' }, pages: { ...posts, kind: 'post' } })).toThrow(
      /"posts" and "pages" share the kind "post"/,
    )
  })
})
