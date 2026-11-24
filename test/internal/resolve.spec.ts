/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a wrong card advertised, a stale URL, a colliding key.
 * - resolve.ts:116  drop `!sameUpload(seo, rawHero)` -> "3: an editor image that is the hero itself does not override the card" RED
 * - resolve.ts:116  drop the `isDeliberate` check -> "7: isDeliberate returning false is not shared" RED
 * - resolve.ts:119  ignore `target.share()` -> "6: share() ..." RED; call it eagerly -> "does not call share() when the editor image already wins" RED
 * - resolve.ts:144  skip stripMissing -> "10: a title with an emoji ..." RED
 * - resolve.ts:149  skip `template.required` -> "9: a blank title advertises nothing" RED
 * - resolve.ts:114  hash the raw hero object -> "a hero without a file is no part of the version" RED
 * - resolve.ts:160  leave `host` out of the version -> "the host is part of the version" RED
 * - resolve.ts:159  leave the stacks out of the version -> "reordering a font stack is a new version" RED
 * - resolve.ts:126  accept any props() result -> "props() must return a plain object" RED
 * - resolve.ts:132  spread the raw props instead of normalizing -> "props with a Map or a class instance throw naming the field" / "the template receives the normalized props that were hashed" RED
 * - resolve.ts:138  fall back to the first declared stack -> "an unmapped text field uses the explicit default stack" RED
 * - resolve.ts:74  allow `.`/`..` or an over-long slug -> "a blank, missing, dot-segment or over-long slug advertises nothing" RED
 * - resolve.ts:155  substitute the id (or accept an over-long slug) -> "a blank, missing, dot-segment or over-long slug advertises nothing" RED
 * - resolve.ts:90  no encodeURIComponent -> "11: cardPath encodes the key" RED
 * - resolve.ts:96  plain-object index -> "a target named like an Object.prototype member ..." RED
 * - resolve.ts:100  allow two targets with one kind -> "12: buildKindIndex throws on a duplicate kind" RED
 * - resolve.ts:139  fall back to an empty stack silently -> "a text field with no font stack throws" RED */
import { describe, expect, it, vi } from 'vitest'
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
  it('a blank, missing, dot-segment or over-long slug advertises nothing: the route could not serve it, and the id is never substituted', async () => {
    for (const slug of ['', '  ', undefined, '.', '..', 'x'.repeat(257)]) {
      expect((await resolveCard({ ...(await base()), doc: { id: 5, slug, title: 'A' } })).kind, JSON.stringify(slug)).toBe('none')
    }
    expect((await resolveCard({ ...(await base()), doc: { id: 5, slug: 'x'.repeat(256), title: 'A' } })).kind).toBe('generated')
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
  it('reordering a font stack is a new version (the stack picks the family that draws the title)', async () => {
    const doc = { id: 1, slug: 'a', title: 'A' }
    const a = await generated({ doc, stacks: { title: ['Inter', 'Archivo'] } })
    const b = await generated({ doc, stacks: { title: ['Archivo', 'Inter'] } })
    expect(b.v).not.toBe(a.v)
    expect((await generated({ doc, stacks: { title: ['Inter', 'Archivo'] } })).v).toBe(a.v)
  })
  it('props with a Map or a class instance throw naming the field; two Maps can no longer share a version', async () => {
    for (const [field, bad] of [
      ['meta', new Map([['a', 1]])],
      ['tags', new Set(['x'])],
      ['money', new (class Money {})()],
    ] as const) {
      const target = defineTarget<any, any>({ ...posts, props: () => ({ title: 'A', label: 'Blog', [field]: bad }) })
      await expect(resolveCard({ ...(await base()), target, doc: { id: 1, slug: 'a', title: 'A' } })).rejects.toThrow(
        new RegExp(`posts\\.props\\.${field} is a`),
      )
    }
  })
  it('the template receives the normalized props that were hashed (a Date becomes its ISO string)', async () => {
    const when = new Date('2026-03-04T05:06:07Z')
    const target = defineTarget<any, any>({
      ...posts,
      props: ({ doc }) => ({ title: doc.title, label: 'Blog', when, nested: { n: 1, skip: undefined } }),
    })
    const r = await generated({ target, doc: { id: 1, slug: 'a', title: 'A' } })
    expect(r.props.when).toBe('2026-03-04T05:06:07.000Z')
    expect(r.props.nested).toEqual({ n: 1 })
    const later = await generated({
      target: defineTarget<any, any>({
        ...posts,
        props: () => ({ title: 'A', label: 'Blog', when: new Date('2027-01-01T00:00:00Z'), nested: { n: 1 } }),
      }),
      doc: { id: 1, slug: 'a', title: 'A' },
    })
    expect(later.v).not.toBe(r.v)
  })
  it('an unmapped text field uses the explicit default stack, never the first stack declared', async () => {
    const unmapped = defineTemplate<{ title: string; label: string; site: string }>({
      id: 'u',
      revision: '1',
      textFields: ['title'],
      render: () => null as never,
    })
    const target = defineTarget<any, any>({ ...posts, template: 'u' })
    const templates = new Map([['u', unmapped]])
    const args = { ...(await base()), target, templates, doc: { id: 1, slug: 'a', title: 'Привет' } }
    // No stack named "title", no "default": throws although other stacks exist.
    await expect(resolveCard({ ...args, stacks: { other: ['Archivo'] } })).rejects.toThrow(
      /no font stack \(looked for "title", then "default"\)/,
    )
    // With "default" (Inter draws Cyrillic) nothing is stripped; the first-declared Archivo would have stripped it all.
    const r = await resolveCard({ ...args, stacks: { other: ['Archivo'], default: ['Inter'] } })
    expect(r).toMatchObject({ kind: 'generated', missing: [] })
  })
  it('props() must return a plain object', async () => {
    for (const bad of [new Date(0), null, [1], 'x']) {
      const target = defineTarget<any, any>({ ...posts, props: () => bad })
      await expect(resolveCard({ ...(await base()), target, doc: { id: 1, slug: 'a', title: 'A' } })).rejects.toThrow(
        /props\(\) must return a plain object/,
      )
    }
  })
  it('does not call share() when the editor image already wins', async () => {
    const share = vi.fn(() => [])
    const target = defineTarget<any, any>({ ...posts, share })
    const r = await resolveCard({ ...(await base()), target, doc: { id: 1, slug: 'a', title: 'A', meta: { image: jpeg } } })
    expect(r.kind).toBe('own')
    expect(share).not.toHaveBeenCalled()
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
  it('a target named like an Object.prototype member is not a duplicate of itself', () => {
    expect(buildKindIndex({ constructor: posts })).toEqual({ constructor: 'constructor' })
    expect(Object.keys(buildKindIndex(JSON.parse('{"__proto__": {"path":"/x/:slug","template":"t"}}')))).toEqual(['__proto__'])
  })
  it('12: throws on a duplicate kind, naming both targets', () => {
    expect(() => buildKindIndex({ posts: { ...posts, kind: 'post' }, pages: { ...posts, kind: 'post' } })).toThrow(
      /"posts" and "pages" share the kind "post"/,
    )
  })
})
