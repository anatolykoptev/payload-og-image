/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a wrong card advertised, a stale URL, a colliding key.
 * - resolve.ts `altOf` ignores `target.alt` -> "alt: a target's own alt wins; none, empty or whitespace keeps `<label>: <title>`" RED
 * - resolve.ts `ownBackground` ignored, or the template's read before the target's -> "a hero ground set on the target or the template is the plugin's, and the target wins" RED
 * - resolve.ts `heroBackground: background` left out of the card -> handler.spec "a ground set on the target reaches the hero loader" RED
 * - template.ts `normaliseHeroBackground` dropped from defineTarget/defineTemplate -> "a malformed hero ground on a target or a template is refused" RED
 * - resolve.ts:116  drop `!sameUpload(seo, rawHero)` -> "3: an editor image that is the hero itself does not override the card" RED
 * - resolve.ts:116  drop the `isDeliberate` check -> "7: isDeliberate returning false is not shared" RED
 * - resolve.ts:119  ignore `target.share()` -> "6: share() ..." RED; call it eagerly -> "does not call share() when the editor image already wins" RED
 * - resolve.ts:144  skip stripMissing -> "10: a title with an emoji ..." RED
 * - resolve.ts:149  skip `template.required` -> "9: a blank title advertises nothing" RED
 * - resolve.ts:198  never ask `heroHasAlpha`, or ask it for a flattened hero -> "a transparent hero nobody flattens has its own version, asked in its upload collection" RED
 * - resolve.ts `heroOf` drawing the object the target handed over (`usableHero(raw)` first) -> "a hero object is only an id: it is read again with the caller's access" RED
 * - resolve.ts card `heroCollection` / alpha probe given `i.target.heroCollection` instead of the resolved one -> same test RED
 * - resolve.ts `heroCollection ?? uploadSource.get(raw)` (the target first) -> the same test RED (its heroCollection-differs part)
 * - resolve.ts `uploadSource.get(raw)` dropped from heroOf -> "a populated hero is read again from the collection populateUploads read it from ..." RED
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
 * - resolve.ts  pass og.nonce unvalidated to the version -> "og nonce: a nonce changes v; 0, absent and nonsense values hash as 0.1" RED
 * - resolve.ts:139  fall back to an empty stack silently -> "a text field with no font stack throws" RED
 * - resolve.ts:185  mix `og.headline` into the version outside props (e.g. `host`) -> "og: inherit keeps every 0.1 outcome, even with a headline set that the target never reads" RED
 * - resolve.ts:185  mix `og.mode` into the version -> "og: mode inherit with no og data resolves exactly as 0.1" and the headline case RED
 * - resolve.ts:126  drop the `off` early return -> "og: mode off advertises nothing" RED
 * - resolve.ts:141  stop skipping the image step for `generated` -> "og: mode generated ignores an eligible editor image" RED
 * - resolve.ts:143  let `custom` ask share() -> "og: mode custom with no eligible editor image falls back to generated, and never asks share()" RED
 * - resolve.ts:131  drop the overrides from the resolver args -> "og: a headline override reaches props and changes v" RED
 * - fonts.ts:113  `missingGlyphs` judges against the stack's first family only (or one covering family) -> "(#38) a stack of two single-script faces strips only what neither draws" RED */
import { describe, expect, it, vi } from 'vitest'
import type { LoadedFont } from '../../src/internal/fonts.js'
import { buildKindIndex, cardPath, resolveCard } from '../../src/internal/resolve.js'
import { collectionOf, type VerifiedUpload } from '../../src/internal/uploads.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { loadTestFonts, relatedUploads, uploadReaderOf, verifiedUpload } from '../helpers.js'

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
    uploads: uploadReaderOf(undefined),
  }
}
const generated = async (over: Record<string, unknown>) => {
  const input = { ...(await base()), uploadCollection: 'media', related: relatedUploads(over.doc), ...over } as {
    related: Parameters<typeof uploadReaderOf>[0]
  }
  const r = await resolveCard({ ...input, uploads: uploadReaderOf(input.related) } as never)
  if (r.kind !== 'generated') throw new Error(`expected a generated card, got ${r.kind}`)
  return r
}

describe('resolveCard, JPEG chroma subsampling', () => {
  const doc = { id: 1, slug: 'a', title: 'A' }
  const versionOf = async (over: Record<string, unknown>) => (await generated({ doc, ...over })).v
  it('4:4:4 changes the card version and the encoding; 4:2:0 is the default and moves nothing', async () => {
    const plain = await versionOf({ format: 'jpeg' })
    const c420 = await versionOf({ format: 'jpeg', jpeg: { chromaSubsampling: '4:2:0' } })
    const c444 = await versionOf({ format: 'jpeg', jpeg: { chromaSubsampling: '4:4:4' } })
    expect(c420).toBe(plain)
    expect(c444).not.toBe(plain)
    // the same through a target's own jpeg
    expect(await versionOf({ format: 'jpeg', target: { ...posts, jpeg: { chromaSubsampling: '4:4:4' } } })).toBe(c444)
    const r = await generated({ doc, format: 'jpeg', jpeg: { chromaSubsampling: '4:4:4' } })
    expect(r.encoding).toMatchObject({ format: 'jpeg', chromaSubsampling: '4:4:4' })
    expect((await generated({ doc, format: 'jpeg' })).encoding).not.toHaveProperty('chromaSubsampling')
  })
})

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
  // --- per-document `og` fields (0.2 Task 1) ---
  it('og: mode inherit with no og data resolves exactly as 0.1 (same kind, same v)', async () => {
    const b = await base()
    const v01 = await resolveCard({ ...b, doc: { id: 1, slug: 'a', title: 'A' } })
    const v02 = await resolveCard({ ...b, doc: { id: 1, slug: 'a', title: 'A', og: { mode: 'inherit', headline: null, subtitle: null } } })
    expect(v02).toEqual(v01)
  })
  it('og: inherit keeps every 0.1 outcome, even with a headline set that the target never reads', async () => {
    const b = await base()
    const plain = await generated({ doc: { id: 1, slug: 'a', title: 'A' } })
    const set = await generated({ doc: { id: 1, slug: 'a', title: 'A', og: { mode: 'inherit', headline: 'Zed', subtitle: 'Sub' } } })
    expect(set.v).toBe(plain.v) // `posts` props() ignores overrides, and the version is derived from props alone
    const own = await resolveCard({ ...b, doc: { id: 1, slug: 'a', title: 'A', meta: { image: jpeg }, og: { mode: 'inherit' } } })
    expect(own.kind).toBe('own')
  })
  it('og: a mode that is not one of the four is read as inherit', async () => {
    const b = await base()
    const doc = { id: 1, slug: 'a', title: 'A', meta: { image: jpeg } }
    for (const mode of ['bogus', 7, null, {}, '']) {
      expect(await resolveCard({ ...b, doc: { ...doc, og: { mode } } })).toEqual(await resolveCard({ ...b, doc }))
    }
    expect(await resolveCard({ ...b, doc: { ...doc, og: 'garbage' } })).toEqual(await resolveCard({ ...b, doc }))
  })
  it('og: mode generated ignores an eligible editor image', async () => {
    const b = await base()
    const r = await resolveCard({ ...b, doc: { id: 1, slug: 'a', title: 'A', meta: { image: jpeg }, og: { mode: 'generated' } } })
    expect(r.kind).toBe('generated')
  })
  it('og: mode generated also ignores share()', async () => {
    const target = defineTarget<any, any>({ ...posts, share: ({ doc }) => [doc.photo] })
    const r = await resolveCard({
      ...(await base()),
      target,
      doc: { id: 1, slug: 'a', title: 'A', photo: jpeg, og: { mode: 'generated' } },
    })
    expect(r.kind).toBe('generated')
  })
  it('og: mode off advertises nothing, even with an eligible editor image', async () => {
    const b = await base()
    expect((await resolveCard({ ...b, doc: { id: 1, slug: 'a', title: 'A', og: { mode: 'off' } } })).kind).toBe('none')
    expect((await resolveCard({ ...b, doc: { id: 1, slug: 'a', title: 'A', meta: { image: jpeg }, og: { mode: 'off' } } })).kind).toBe(
      'none',
    )
  })
  it('og: mode custom shares the editor image', async () => {
    const r = await resolveCard({ ...(await base()), doc: { id: 1, slug: 'a', title: 'A', meta: { image: jpeg }, og: { mode: 'custom' } } })
    expect(r.kind).toBe('own')
  })
  it('og: mode custom with no eligible editor image falls back to generated, and never asks share()', async () => {
    const share = vi.fn(() => [jpeg])
    const target = defineTarget<any, any>({ ...posts, share })
    const b = await base()
    const none = await resolveCard({ ...b, target, doc: { id: 1, slug: 'a', title: 'A', og: { mode: 'custom' } } })
    expect(none.kind).toBe('generated')
    const svg = { id: 8, url: '/m/a.svg', width: 1200, height: 630, mimeType: 'image/svg+xml' }
    const bad = await resolveCard({ ...b, target, doc: { id: 1, slug: 'a', title: 'A', meta: { image: svg }, og: { mode: 'custom' } } })
    expect(bad.kind).toBe('generated')
    expect(share).not.toHaveBeenCalled()
  })
  it('og: a headline override reaches props and changes v', async () => {
    const b = await base()
    const t = defineTarget<any, any>({
      ...posts,
      props: ({ doc, site, overrides }) => ({ title: overrides?.headline ?? doc.title, label: 'Blog', site: site.name }),
    })
    const plain = await resolveCard({ ...b, target: t, doc: { id: 1, slug: 'a', title: 'A' } })
    const over = await resolveCard({ ...b, target: t, doc: { id: 1, slug: 'a', title: 'A', og: { headline: 'B' } } })
    expect(over.kind === 'generated' && over.props.title).toBe('B')
    expect(over.kind === 'generated' && plain.kind === 'generated' && over.v !== plain.v).toBe(true)
  })
  it('og: overrides are trimmed, and empty or non-string values are undefined', async () => {
    const seen: unknown[] = []
    const t = defineTarget<any, any>({
      ...posts,
      props: ({ doc, overrides }) => (seen.push(overrides), { title: doc.title, label: 'Blog', site: 'S' }),
    })
    const b = await base()
    const run = (og: unknown) => resolveCard({ ...b, target: t, doc: { id: 1, slug: 'a', title: 'A', og } })
    await run({ headline: '  Hi  ', subtitle: ' there ' })
    await run({ headline: '   ', subtitle: '' })
    await run({ headline: 5, subtitle: null })
    await run(undefined)
    expect(seen).toEqual([{ headline: 'Hi', subtitle: 'there' }, {}, {}, {}])
  })
  it('og: a label is trimmed text and an accent is a hex colour as lowercase #rrggbb; a value that is no colour is undefined', async () => {
    const seen: unknown[] = []
    const t = defineTarget<any, any>({
      ...posts,
      props: ({ doc, overrides }) => (seen.push(overrides), { title: doc.title, label: 'Blog', site: 'S' }),
    })
    const b = await base()
    const run = (og: unknown) => resolveCard({ ...b, target: t, doc: { id: 1, slug: 'a', title: 'A', og } })
    await run({ label: '  Case study ', accent: ' #F60 ' })
    await run({ label: 7, accent: '#3366FF' })
    await run({ accent: 'red' })
    await run({ accent: '#12345' })
    await run({ accent: 5 })
    expect(seen).toEqual([{ label: 'Case study', accent: '#ff6600' }, { accent: '#3366ff' }, {}, {}, {}])
  })
  it('og: overrides reach hero(), share() and template() as well', async () => {
    const seen: unknown[] = []
    const t = defineTarget<any, any>({
      ...posts,
      template: ({ overrides }) => (seen.push(overrides), 'post'),
      hero: ({ overrides }) => (seen.push(overrides), undefined),
    })
    await resolveCard({ ...(await base()), target: t, doc: { id: 1, slug: 'a', title: 'A', og: { headline: 'B' } } })
    expect(seen).toEqual([{ headline: 'B' }, { headline: 'B' }])
  })
  it('og #27: mode generated never asks isDeliberate (the editor image is ignored)', async () => {
    const isDeliberate = vi.fn(() => true)
    const seoImage = { path: 'meta.image', isDeliberate }
    const r = await resolveCard({
      ...(await base()),
      seoImage,
      doc: { id: 1, slug: 'a', title: 'A', meta: { image: jpeg }, og: { mode: 'generated' } },
    })
    expect(r.kind).toBe('generated')
    expect(isDeliberate).not.toHaveBeenCalled()
    await resolveCard({ ...(await base()), seoImage, doc: { id: 1, slug: 'a', title: 'A', meta: { image: jpeg } } })
    expect(isDeliberate).toHaveBeenCalledTimes(1) // inherit still asks
  })
  it('og #27: share() receives the overrides', async () => {
    const seen: unknown[] = []
    const target = defineTarget<any, any>({ ...posts, share: ({ overrides }) => (seen.push(overrides), []) })
    await resolveCard({ ...(await base()), target, doc: { id: 1, slug: 'a', title: 'A', og: { headline: 'H', subtitle: 'S' } } })
    expect(seen).toEqual([{ headline: 'H', subtitle: 'S' }])
  })
  it('og nonce: a nonce changes v; 0, absent and nonsense values hash as 0.1', async () => {
    const at = async (og: unknown) => (await generated({ doc: { id: 1, slug: 'a', title: 'A', ...(og === undefined ? {} : { og }) } })).v
    const plain = await at(undefined)
    expect(await at({ nonce: 0 })).toBe(plain)
    expect(await at({ nonce: null })).toBe(plain)
    for (const bad of [-1, 1.5, Number.NaN, '2', Number.MAX_SAFE_INTEGER + 2, {}]) expect(await at({ nonce: bad })).toBe(plain)
    const two = await at({ nonce: 2 })
    expect(two).not.toBe(plain)
    expect(two).not.toBe(await at({ nonce: 1 }))
    expect(await at({ mode: 'generated', nonce: 2 })).toBe(two)
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
  it("a hero object is only an id: it is read again with the caller's access", async () => {
    const handed = { id: 9, url: '/m/h.jpg', updatedAt: 'u1' }
    const doc = { id: 1, slug: 'a', title: 'A', heroImage: handed }
    const none = await generated({ doc: { ...doc, heroImage: undefined } })
    // The public may not read it (draft-only, private, deleted): nothing is drawn and the version is the hero-less one.
    const unreadable = await generated({ doc, related: async () => null })
    expect(unreadable.hero).toBeNull()
    expect(unreadable.v).toBe(none.v)
    // What is drawn, and hashed, is what the read returned, not the object the document carried.
    const fresh = { ...handed, updatedAt: 'u2' }
    const read = vi.fn(async () => fresh)
    const seen = await generated({ doc, related: read })
    expect(read).toHaveBeenCalledWith('media', '9')
    expect(seen.hero).toEqual(fresh)
    // The same upload read back gives the version the handed object always did: no card URL moves.
    expect((await generated({ doc, related: async () => handed })).v).toBe((await generated({ doc })).v)
    // No collection to read it from: not drawn either.
    expect((await generated({ doc, uploadCollection: undefined, related: async () => handed })).hero).toBeNull()
  })
  it('a populated hero is read again from the collection populateUploads read it from, with no heroCollection and several upload collections', async () => {
    const populated = verifiedUpload({ id: 9, url: '/m/h.jpg', updatedAt: 'u1' }, 'photos')
    const read = vi.fn(async () => populated)
    const doc = { id: 1, slug: 'a', title: 'A', heroImage: populated }
    const r = await generated({ doc, uploadCollection: undefined, related: read })
    expect(read).toHaveBeenCalledWith('photos', '9')
    expect(r.hero).toEqual(populated)
    expect(collectionOf(r.hero as VerifiedUpload)).toBe('photos') // the loader and the alpha probe look there too
    const heroHasAlpha = vi.fn(async () => false)
    await generated({ doc, uploadCollection: undefined, related: read, heroHasAlpha })
    expect(heroHasAlpha).toHaveBeenCalledWith(populated)
    // A copy of it, or an object nobody populated, has no provenance: with no collection to name it is no hero.
    expect((await generated({ doc: { ...doc, heroImage: { ...populated } }, uploadCollection: undefined, related: read })).hero).toBeNull()
    // Where the object was read from wins over the target's heroCollection (a `logos` upload is not the `media` upload of the same id).
    const own = defineTarget<any, any>({ ...posts, heroCollection: 'media' })
    await generated({ doc, target: own, uploadCollection: undefined, related: read })
    expect(read).toHaveBeenLastCalledWith('photos', '9')
    // An object nobody populated is read from the target's heroCollection.
    await generated({ doc: { ...doc, heroImage: { ...populated } }, target: own, uploadCollection: undefined, related: read })
    expect(read).toHaveBeenLastCalledWith('media', '9')
  })
  it('a transparent hero nobody flattens has its own version, asked in its upload collection', async () => {
    const real = { id: 9, url: '/m/h.png', updatedAt: 'u1' }
    const doc = { id: 1, slug: 'a', title: 'A', heroImage: real }
    const target = defineTarget<any, any>({ ...posts, heroCollection: 'media' })
    const ask = (alpha: boolean) => vi.fn(async () => alpha)
    const opaque = await generated({ doc, target, heroHasAlpha: ask(false) })
    const heroHasAlpha = ask(true)
    const clear = await generated({ doc, target, heroHasAlpha })
    expect(clear.v).not.toBe(opaque.v)
    expect(heroHasAlpha).toHaveBeenCalledWith(real)
    expect(opaque.v).toBe((await generated({ doc, target })).v) // no probe at all: the 0.4.0 version
    // A site that set a ground flattens the hero: no probe, the 0.4.0 version.
    const flat = ask(true)
    expect((await generated({ doc, target, heroFlattened: true, heroHasAlpha: flat })).v).toBe(opaque.v)
    expect(flat).not.toHaveBeenCalled()
  })
  it('none of the 0.5 options set: every card version is exactly the one 0.4.0 gave (pinned)', async () => {
    const real = { id: 9, url: '/m/h.png', updatedAt: 'u1', mimeType: 'image/png' }
    const plain = { id: 1, slug: 'a', title: 'A' }
    const withHero = { ...plain, heroImage: real }
    expect((await generated({ doc: plain })).v).toBe('d97fedf8c6c0')
    expect((await generated({ doc: withHero })).v).toBe('4452b821e754')
    expect((await generated({ doc: withHero, heroBackground: '#336699', heroFlattened: true })).v).toBe('06f1fe65fb77')
    expect((await generated({ doc: withHero, heroPalette: 'false' })).v).toBe('72dac2a11095')
  })
  it("a hero ground set on the target or the template is the plugin's, and the target wins", async () => {
    const doc = { id: 1, slug: 'a', title: 'A', heroImage: { id: 9, url: '/m/h.png', updatedAt: 'u1', mimeType: 'image/png' } }
    const global = (await generated({ doc, heroBackground: '#336699', heroFlattened: true })).v // pinned above as 06f1fe65fb77
    const withTarget = (heroBackground: string) => defineTarget<any, any>({ ...posts, heroBackground })
    const r = await generated({ doc, target: withTarget('#336699') })
    expect(r.v).toBe(global)
    expect(r.heroBackground).toBe('#336699')
    expect((await generated({ doc, target: withTarget('#369') })).v).toBe(global) // spellings of one colour agree
    expect((await generated({ doc, target: withTarget('#112233') })).v).not.toBe(global)
    // The template's ground, when the target has none; the target's wins over it.
    const dark = defineTemplate<any>({ id: 'post', revision: '1', heroBackground: '#336699', render: () => null as never })
    const templates = new Map([['post', dark]])
    expect((await generated({ doc, templates })).v).toBe(global)
    expect((await generated({ doc, templates, target: withTarget('#112233') })).v).toBe(
      (await generated({ doc, target: withTarget('#112233') })).v,
    )
    // Over the plugin's: the card's own ground replaces it.
    expect((await generated({ doc, target: withTarget('#336699'), heroBackground: '#112233', heroFlattened: true })).v).toBe(global)
    // An own white is flattened onto white, which hashes no tag, as 0.4.0's default did; the probe is not asked.
    const probe = vi.fn(async () => true)
    const white = await generated({ doc, target: withTarget('#ffffff'), heroHasAlpha: probe })
    expect(white.v).toBe((await generated({ doc })).v)
    expect([white.heroBackground, probe.mock.calls.length]).toEqual(['#ffffff', 0])
  })
  it('a malformed hero ground on a target or a template is refused when it is defined', () => {
    expect(() => defineTarget<any, any>({ ...posts, heroBackground: 'red' })).toThrow(/heroBackground must be #rgb or #rrggbb/)
    expect(() => defineTemplate<any>({ id: 'x', revision: '1', heroBackground: '#12345', render: () => null as never })).toThrow(
      /heroBackground/,
    )
  })
  it("alt: a target's own alt wins; none, empty or whitespace keeps `<label>: <title>`", async () => {
    const doc = { id: 1, slug: 'a', title: 'A' }
    const seen: unknown[] = []
    const own = defineTarget<any, any>({ ...posts, alt: (a) => (seen.push(a.props.title), `Card for ${a.doc.title} on ${a.site.name}`) })
    expect((await generated({ doc, target: own })).alt).toBe('Card for A on S')
    expect(seen).toEqual(['A']) // the props the template draws, normalised
    for (const blank of [undefined, null, '', '  ']) {
      expect((await generated({ doc, target: defineTarget<any, any>({ ...posts, alt: () => blank }) })).alt).toBe('Blog: A')
    }
    expect((await generated({ doc })).alt).toBe('Blog: A')
    // Alt is not drawn: it is no part of the version.
    expect((await generated({ doc, target: own })).v).toBe((await generated({ doc })).v)
    const bad = defineTarget<any, any>({ ...posts, alt: (() => 5) as never })
    await expect(generated({ doc, target: bad })).rejects.toThrow(/alt must return a string/)
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

describe('(#38) a stack of two single-script faces', () => {
  const face = (family: string, chars: string): LoadedFont => ({
    family,
    weight: 400,
    style: 'normal',
    data: new ArrayBuffer(0),
    has: (ch) => chars.includes(ch),
    advance: () => 500,
  })
  const fonts = [face('Latin', ' Helo'), face('Cyr', ' Привет')]

  it('a stack of two single-script faces strips only what neither draws, and reports it', async () => {
    const r = await generated({
      fonts,
      stacks: { title: ['Latin', 'Cyr'] },
      doc: { id: 1, slug: 'a', title: 'Hello Привет 日本' },
    })
    // No family draws the whole run, but every kept character is drawn by one of them: nothing else is touched.
    expect(r.props.title).toBe('Hello Привет')
    expect(r.missing).toEqual(['日', '本'])
  })

  it('a title the two faces draw between them loses nothing and reports nothing', async () => {
    const r = await generated({ fonts, stacks: { title: ['Latin', 'Cyr'] }, doc: { id: 1, slug: 'a', title: 'Hello Привет' } })
    expect(r.props.title).toBe('Hello Привет')
    expect(r.missing).toEqual([])
  })
})
