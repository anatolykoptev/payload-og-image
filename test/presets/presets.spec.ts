/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a preset that draws outside the safe zone, serves the wrong file, moves a site's URLs or picks the wrong preset gives no error in production.
 * - handler.ts the `:ext` file-name check removed -> "a photo card is served as card.jpg only" RED
 * - expand.ts `fonts: o.fonts ?? ...` made `[...(o.fonts ?? []), ...BUNDLED_FONTS]` -> "a site with fonts of its own keeps its font digest" RED
 * - spec.ts `TEXT.foot.y` 500 -> 560 -> "every box of both layouts stays in the safe zone" RED
 * - target.ts `eligibleHero` ignores HERO_MIN -> "the preset follows the hero" RED
 * - target.ts `choosePreset` ignores `preset: 'text'` -> "the preset follows the hero" RED
 * - fonts.ts one face registration removed (a subset missing) -> "the bundled faces draw ..." RED
 * - draw.ts `fitRow` drops the lowest priority number instead of the highest -> "fitRow drops whole items" RED */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { templateContext } from '../../src/internal/draw.js'
import { loadFonts, missingGlyphs } from '../../src/internal/fonts.js'
import { expandPresets } from '../../src/presets/expand.js'
import { FONT_DATA } from '../../src/presets/fontData.js'
import { BUNDLED_FONTS, BUNDLED_STACKS } from '../../src/presets/fonts.js'
import { type PresetProps, photoLayout, textLayout } from '../../src/presets/layout.js'
import { HERO_MIN, SLOTS, ZONE } from '../../src/presets/spec.js'
import { choosePreset, eligibleHero } from '../../src/presets/target.js'
import { loadTestFonts } from '../helpers.js'
import { configOf, presetHarness, upload } from './harness.js'

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')
const bundled = loadFonts(BUNDLED_FONTS)
const ctxOf = async (images: Record<string, string[]> = {}) => {
  const { fonts } = await bundled
  return templateContext({ host: 'example.test', fonts, stacks: BUNDLED_STACKS, hero: 'data:x', images: images as never })
}

describe('the bundled faces', () => {
  it('draw Aa’‘“”–—…«»„№ĄŁŐŞțđ and a Cyrillic sample from the stack, and nothing is missing', async () => {
    const { fonts } = await bundled
    const sample = 'Aa’‘“”–—…«»„№ĄŁŐŞțđ Съешь же ещё этих мягких французских булок ЁёЙй'
    expect(missingGlyphs(fonts, BUNDLED_STACKS.default as string[], sample)).toEqual([])
    expect(new Set(fonts.map((f) => `${f.family}|${f.weight}`)).size).toBe(6)
  })
  it('are the very bytes of fonts/ (the embedded module cannot drift from the files that ship with the licence)', () => {
    for (const [file, b64] of Object.entries(FONT_DATA)) {
      expect(sha(Buffer.from(b64, 'base64')), file).toBe(sha(readFileSync(path.resolve('fonts', file))))
    }
    expect(readFileSync(path.resolve('fonts/OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })
})

describe('expansion', () => {
  it('a site with fonts of its own keeps its font digest and stacks: the bundled faces are not added', async () => {
    const own = [{ family: 'Mine', data: async () => readFileSync(path.resolve('test/fixtures/fonts/inter-latin-cyrillic-800.woff')) }]
    const stacks = { default: ['Mine'] }
    const o = expandPresets({ collections: ['posts'], fonts: own, stacks }, configOf())
    expect(o.stacks).toBe(stacks)
    expect((await loadFonts(o.fonts)).digest).toBe((await loadFonts(own)).digest)
    expect(o.fonts.map((f) => f.family)).toEqual(['Mine'])
  })
  it('a site with no fonts gets the bundled ones, a memory store, a site named after the serverURL host, and the presets as templates', async () => {
    const o = expandPresets({ collections: ['posts', { slug: 'people', label: 'Team' }] }, configOf())
    expect(o.stacks).toBe(BUNDLED_STACKS)
    expect(o.store).toEqual({ memory: true })
    expect((await o.site({ payload: {} as never })).name).toBe('example.test')
    expect(o.templates.map((t) => t.id).sort()).toEqual(['payload-og-image:photo', 'payload-og-image:text'])
    expect(Object.keys(o.targets)).toEqual(['posts', 'people'])
    expect(o.targets.people?.path).toBe('/og/:kind/:id/card.:ext') // no slug field: keyed by id
    expect(o.targets.posts?.heroCollection).toBe('media')
  })
  it('refuses what cannot work, by name', () => {
    expect(() => expandPresets({}, configOf())).toThrow(/nothing is configured: give `collections`/)
    expect(() => expandPresets({ collections: [] }, configOf())).toThrow(/at least one collection/)
    expect(() => expandPresets({ collections: ['nope'] }, configOf())).toThrow(/"nope", which is not a collection/)
    expect(() => expandPresets({ collections: ['users'] }, configOf())).toThrow(/auth collection/)
    expect(() => expandPresets({ collections: ['media'] }, configOf())).toThrow(/collection "media" has no title field/)
    expect(() => expandPresets({ collections: [{ slug: 'posts', path: '/og/:slug/card.png' }] }, configOf())).toThrow(/needs :ext/)
    expect(() => expandPresets({ collections: [{ slug: 'people', preset: 'photo' }] }, configOf())).toThrow(/needs a hero upload field/)
    expect(() => expandPresets({ collections: [{ slug: 'posts', title: 'nope' }] }, configOf())).toThrow(/is not a text or textarea field/)
  })
})

describe('the preset follows the hero', () => {
  const auto = { preset: 'auto' as const, hero: { path: 'heroImage', collection: 'media' } }
  const big = upload(1, 'a.jpg', 1200, 800)
  it('1200x800 -> photo; 640x360 -> text; an SVG -> text; preset text with a hero -> text; no hero field -> text', () => {
    expect(choosePreset(auto, { heroImage: big })).toBe('photo')
    expect(choosePreset(auto, { heroImage: upload(1, 'a.jpg', 640, 360) })).toBe('text')
    expect(choosePreset(auto, { heroImage: upload(1, 'a.svg', 1200, 800, 'image/svg+xml') })).toBe('text')
    expect(choosePreset(auto, { heroImage: { ...big, url: '' } })).toBe('text')
    expect(choosePreset(auto, {})).toBe('text')
    expect(choosePreset({ ...auto, preset: 'text' }, { heroImage: big })).toBe('text')
    expect(choosePreset({ preset: 'photo', hero: undefined }, { heroImage: big })).toBe('text')
    expect(eligibleHero(upload(1, 'a.jpg', HERO_MIN.width, HERO_MIN.height))).toBe(true)
    expect(eligibleHero(upload(1, 'a.jpg', HERO_MIN.width - 1, HERO_MIN.height))).toBe(false)
    expect(eligibleHero(upload(1, 'a.jpg', HERO_MIN.width, HERO_MIN.height - 1))).toBe(false)
  })
  it('og.mode is unchanged: off -> no card, generated -> the card, with the preset the hero picks', async () => {
    const docs = {
      off: { id: 1, slug: 'off', title: 'Off', og: { mode: 'off' }, heroImage: big },
      gen: { id: 2, slug: 'gen', title: 'Gen', og: { mode: 'generated' }, heroImage: big },
    }
    const h = await presetHarness({ docs })
    expect((await h.resolve('posts', 'off')).kind).toBe('none')
    const gen = await h.resolve('posts', 'gen')
    expect(gen.kind === 'generated' && gen.template.id).toBe('payload-og-image:photo')
  })
})

describe('the route serves a card under its own file name only', () => {
  const docs = {
    photo: { id: 1, slug: 'photo', title: 'A photo card', heroImage: upload(1, 'hero.jpg', 1200, 800) },
    plain: { id: 2, slug: 'plain', title: 'A text card' },
  }
  it('a photo card is served as card.jpg only: card.png is 404, and the advertised URL ends .jpg with image/jpeg', async () => {
    const h = await presetHarness({ docs })
    const c = await h.resolve('posts', 'photo')
    if (c.kind !== 'generated') throw new Error('expected a generated card')
    expect(c.url).toMatch(/\/og\/posts\/photo\/card\.jpg\?v=[0-9a-f]{12}$/)
    expect(c.type).toBe('image/jpeg')
    const ok = await h.get(c.url, { kind: 'posts', slug: 'photo', file: 'card.jpg' })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/jpeg')
    expect((await sharp(new Uint8Array(await ok.arrayBuffer())).metadata()).format).toBe('jpeg')
    for (const wrong of ['card.png', 'card.webp', 'card.jpeg', 'other.jpg'])
      expect(
        (await h.get(`https://www.example.test/og/posts/photo/${wrong}`, { kind: 'posts', slug: 'photo', file: wrong })).status,
        wrong,
      ).toBe(404)
  })
  it('a text card is served as card.png only, whatever the route params say', async () => {
    const h = await presetHarness({ docs })
    const c = await h.resolve('posts', 'plain')
    if (c.kind !== 'generated') throw new Error('expected a generated card')
    expect(c.url).toMatch(/\/card\.png\?v=/)
    expect((await h.get(c.url, { kind: 'posts', slug: 'plain' })).status).toBe(200) // no `file` param at all: the pathname decides
    // a lying param does not help: the name is read from the request path
    expect(
      (await h.get('https://www.example.test/og/posts/plain/card.jpg', { kind: 'posts', slug: 'plain', file: 'card.png' })).status,
    ).toBe(404)
  })
})

// The prepared images are palette PNGs whose bytes differ between platforms (their identity is in `v`); the element tree around them is the same everywhere.
const IMAGE = /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g

describe('goldens: the two presets keep their URL and what they draw', () => {
  const docs = {
    text: { id: 1, slug: 'text', title: 'OxPulse: encrypted calls for a bad network', excerpt: 'Calls that keep working.' },
    photo: {
      id: 2,
      slug: 'photo',
      title: 'Как мы переписали систему доставки',
      excerpt: 'Подзаголовок',
      heroImage: upload(1, 'hero.jpg', 1200, 800),
    },
  }
  const GOLDEN: Record<string, { v: string; drawn: string }> = {
    'text/-': { v: 'c3ce841ad08e', drawn: '0b0217c3bb22d7508a962e5e5221c11f018d248c90600637fe8580b39a136f05' },
    'text/logo': { v: '07bdfc08c619', drawn: 'd56453bbf31ed9ae41c19af20d8fdc48b09cebd70d8cbfc0bb1aa3bf33877562' },
    'photo/-': { v: '46123276026e', drawn: '222a5f37f071122804d7af7d4b8b58b95818c97d83dff4fc8ac5311c9a8dfabe' },
  }
  it.each([
    ['text', undefined],
    ['text', 2],
    ['photo', undefined],
  ] as const)('%s (logo %s)', async (slug, logo) => {
    const h = await presetHarness({
      input: { collections: [{ slug: 'posts', subtitle: 'excerpt' }], siteName: 'OxFoundry' },
      docs,
      site: logo ? { logo } : {},
    })
    const c = await h.resolve('posts', slug)
    if (c.kind !== 'generated') throw new Error('expected a generated card')
    const res = await h.get(c.url, { kind: 'posts', slug, file: c.url.split('?')[0]?.split('/').pop() as string })
    expect(res.status).toBe(200)
    const m = await sharp(new Uint8Array(await res.arrayBuffer())).metadata()
    expect([m.format, m.width, m.height]).toEqual([slug === 'photo' ? 'jpeg' : 'png', 1200, 630])
    expect({ v: c.v, drawn: sha(Buffer.from((h.drawn.at(-1) as string).replace(IMAGE, 'data:IMG'))) }).toEqual(
      GOLDEN[`${slug}/${logo ? 'logo' : '-'}`],
    )
  })
})

const titles = [
  'A',
  'Short title',
  'OxPulse: encrypted calls for a bad network',
  'Как мы переписали систему доставки на новую архитектуру и почему это заняло почти полгода вместо трёх недель',
  'Łódź, Şişli, Ţară, Đà Lạt: ąęłńóśźż ĄĘŁŃÓŚŹŻ — ÇĞİÖŞÜ '.repeat(3),
  'x'.repeat(200),
  `${'word '.repeat(40)}end`,
]
const slotsAtMax = Object.fromEntries(Object.entries(SLOTS).map(([k, s]) => [k, 'W'.repeat(s.maxChars)]))
const inZone = (r: { x: number; y: number; w: number; h: number }) =>
  r.x >= ZONE.x0 && r.x + r.w <= ZONE.x1 && r.y >= ZONE.y0 && r.y + r.h <= ZONE.y1

describe('safe zone', () => {
  it('every box of both layouts stays in the safe zone, over 1-200 character titles in RU/EN/latin-ext, every slot at maxChars, logo and art on and off', async () => {
    const images: Record<string, string[]>[] = [
      {},
      { logo: ['x'] },
      { logo: ['x'], mark: ['x'] },
      { logo: ['x'], art: ['x'] },
      { art: ['x'] },
    ]
    let boxes = 0
    for (const img of images) {
      const ctx = await ctxOf(img)
      for (const title of titles) {
        for (const extra of [
          {},
          { subtitle: 'Sub line '.repeat(12), label: 'Label', byline: 'A. Writer' },
          {
            ...slotsAtMax,
            subtitle: 'Подзаголовок '.repeat(8),
            label: 'Длинная метка раздела',
            byline: 'Имя Фамилия Отчество',
            site: 'S'.repeat(80),
          },
          { site: 'A very long site name that cannot possibly fit the head of the card' },
        ] as Partial<PresetProps>[]) {
          const p: PresetProps = { title, site: 'OxFoundry', ...extra }
          for (const l of [textLayout(p, ctx), photoLayout(p, ctx)]) {
            for (const b of l.boxes) {
              boxes += 1
              expect(inZone(b), `${JSON.stringify(b)} for ${JSON.stringify([img, title.slice(0, 20), Object.keys(extra)])}`).toBe(true)
            }
          }
        }
      }
    }
    expect(boxes).toBeGreaterThan(500)
  })
  it('the text column narrows to 560 with art and widens to 900 without', async () => {
    const p: PresetProps = { title: 'A title long enough to take a few lines of the card, to see the column', site: 'S' }
    const art = textLayout(p, await ctxOf({ art: ['x'] }))
    const plain = textLayout(p, await ctxOf({}))
    expect(art.colW).toBe(560)
    expect(plain.colW).toBe(900)
    expect(art.title.rect.x + art.title.rect.w).toBeLessThanOrEqual(660)
  })
})

describe('fitRow drops whole items, never cuts one', () => {
  it('drops the highest priority number first, keeps priority 0, and answers each remaining item uncut', async () => {
    const ctx = await ctxOf()
    const item = (key: string, text: string, priority: number) => ({ key, text, stack: 'default', size: 24, priority })
    const all = [
      item('lead', 'example.test', 0),
      item('a', 'First pill text', 1),
      item('b', 'Second pill', 3),
      item('c', 'A caption that is long', 4),
    ]
    const wide = ctx.fitRow(all, 2000)
    expect(wide.map((i) => i.key)).toEqual(['lead', 'a', 'b', 'c'])
    const total = (r: { width: number }[]) => r.reduce((s, i) => s + i.width, 0) + 16 * (r.length - 1)
    const narrow = ctx.fitRow(all, total(wide) - 1)
    expect(narrow.map((i) => i.key)).toEqual(['lead', 'a', 'b'])
    expect(narrow.map((i) => i.text)).toEqual(['example.test', 'First pill text', 'Second pill'])
    const tight = ctx.fitRow(all, 1)
    expect(tight.map((i) => i.key)).toEqual(['lead'])
    expect(ctx.fitRow([item('e', '  ', 1)], 500)).toEqual([])
  })
  it('a slot over maxChars is dropped whole by the layout', async () => {
    const ctx = await ctxOf()
    const l = textLayout({ title: 'T', site: 'S', pill: 'x'.repeat(SLOTS.pill.maxChars + 1), badge: 'NEW' }, ctx)
    expect(l.foot.map((f) => f.key)).toEqual(['lead', 'badge'])
  })
})

it('loadTestFonts still loads (the fixtures the existing specs use are untouched)', async () => {
  expect((await loadTestFonts()).fonts.length).toBe(2)
})
