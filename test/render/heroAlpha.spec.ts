/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a transparent hero drawn with a pale fringe, or a card whose bytes changed and whose URL did not.
 * - hero.ts `where?.background ?? background` -> `background` -> "a ground given for one card flattens that card's hero, over the loader's own" RED
 * - hero.ts:171 `cut.flatten(...)` applied with a default white when no ground is set -> "drawn at its own size, a transparent hero is the pixels of a direct <img>" RED
 * - hero.ts:186 `hasAlpha` always false -> "hasAlpha: a see-through pixel is true; opaque, jpeg and unreadable are false" RED
 * - hero.ts `hasAlpha` key without the collection -> "hasAlpha: the same upload tag in two collections is two answers" RED
 * - hero.ts `known.set` removed (no memory) -> "hasAlpha asks the file once per upload ..." RED and handler.spec "a store hit in the steady state reads no hero file" RED
 * - hero.ts `inflight` removed -> same first test RED (two concurrent askers read twice)
 * - hero.ts the LRU touch on a hit removed, or no eviction -> "the memory is a bounded LRU" RED
 * - hero.ts a mimeType shortcut that skips the read -> "an upload is judged by its bytes, not its mimeType label" RED
 * - hero.ts `readable` keep: true (a `true` remembered) -> "readable: shares a concurrent read but remembers no answer ..." RED; `inflight` removed -> same test RED
 * - hero.ts:186 `hasAlpha` ignores `isOpaque` (true for any alpha channel) -> same test RED (the opaque RGBA PNG) */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { payloadHeroLoader } from '../../src/render/hero.js'
import { nextOgRenderer } from '../../src/render/nextOg.js'
import { loadTestFonts, verifiedUpload } from '../helpers.js'

// A 256 px icon like a product mark: a gradient tile with a soft shadow, so it has fully transparent and semi-transparent pixels.
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><filter id="b"><feGaussianBlur stdDeviation="6"/></filter><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d5dfc"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect x="30" y="36" width="196" height="196" rx="44" fill="#000" fill-opacity="0.45" filter="url(#b)"/><rect x="28" y="24" width="200" height="200" rx="44" fill="url(#g)"/></svg>`
const CARD = { width: 320, height: 120 }

const dirWith = async (files: Record<string, Buffer>) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'og-alpha-'))
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(dir, name), bytes)
  return dir
}
const loaderFor = (dir: string, background?: string) => payloadHeroLoader({ staticDirs: async () => [dir], colours: false, background })
const upload = (filename: string) => verifiedUpload({ id: filename, filename, url: `/m/${filename}`, updatedAt: 'u' })

/** The card with the image drawn at 52 px on a dark ground, as raw RGBA, with no palette so every pixel is the renderer's. */
async function drawn(src: string) {
  const { fonts } = await loadTestFonts()
  const el = {
    type: 'div',
    props: {
      style: { display: 'flex', width: CARD.width, height: CARD.height, background: '#1e2a38', padding: 20 },
      children: { type: 'img', props: { src, width: 52, height: 52 } },
    },
  }
  const png = await nextOgRenderer({ palette: false }).render(el as never, { ...CARD, fonts })
  return sharp(png).raw().toBuffer()
}
const differing = (a: Buffer, b: Buffer) => {
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n += 1
  return n
}

describe('a transparent hero', () => {
  it('drawn at its own size, a transparent hero is the pixels of a direct <img> (0 differing), where flattening onto white is not', async () => {
    const png = await sharp(Buffer.from(ICON)).png().toBuffer()
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    let clear = 0
    let semi = 0
    for (let i = 3; i < data.length; i += info.channels) {
      if (data[i] === 0) clear += 1
      else if (data[i] !== 255) semi += 1
    }
    expect([clear > 15_000, semi > 5_000]).toEqual([true, true]) // the fixture is the case the issue describes
    const dir = await dirWith({ 'icon.png': png })
    const box = { width: 256, height: 256 }
    const direct = await drawn(`data:image/png;base64,${png.toString('base64')}`)
    const viaLoader = (await loaderFor(dir)(upload('icon.png'), box)) as string
    expect(differing(await drawn(viaLoader), direct)).toBe(0)
    const flattened = (await loaderFor(dir, '#ffffff')(upload('icon.png'), box)) as string
    expect(differing(await drawn(flattened), direct)).toBeGreaterThan(1000) // 0.4.0: a pale fringe round the icon
  })
  it("a ground given for one card flattens that card's hero, over the loader's own", async () => {
    const dir = await dirWith({ 'icon.png': await sharp(Buffer.from(ICON)).png().toBuffer() })
    const px = async (own: string | undefined, general: string | undefined) => {
      const l = loaderFor(dir, general)
      const url = (await l(upload('icon.png'), { width: 256, height: 256 }, { background: own })) as string
      const { data } = await sharp(Buffer.from(url.split(',')[1] as string, 'base64'))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      return [...data.subarray(0, 4)] // the transparent corner
    }
    expect(await px('#336699', undefined)).toEqual([51, 102, 153, 255]) // the card's own ground, though the plugin set none
    expect(await px('#336699', '#ffffff')).toEqual([51, 102, 153, 255]) // and over the plugin's
    expect(await px(undefined, '#112233')).toEqual([17, 34, 51, 255]) // none of its own: the plugin's
    expect((await px(undefined, undefined))[3]).toBe(0) // neither: the alpha is kept
  })
  it('hasAlpha: a see-through pixel is true; opaque, jpeg and unreadable are false', async () => {
    const solid = { create: { width: 8, height: 8, channels: 4 as const, background: { r: 9, g: 9, b: 9, alpha: 1 } } }
    const dir = await dirWith({
      'clear.png': await sharp(Buffer.from(ICON)).png().toBuffer(),
      'rgba-opaque.png': await sharp(solid).png().toBuffer(), // has an alpha channel, no see-through pixel
      'plain.jpg': await sharp(solid).jpeg().toBuffer(),
    })
    const l = loaderFor(dir)
    expect(l.hasAlpha).toBeTypeOf('function')
    const has = (name: string) => (l.hasAlpha as NonNullable<typeof l.hasAlpha>)(upload(name))
    expect([await has('clear.png'), await has('rgba-opaque.png'), await has('plain.jpg'), await has('missing.png')]).toEqual([
      true,
      false,
      false,
      false,
    ])
  })

  const countingLoader = async (files: Record<string, Record<string, Buffer>>) => {
    const dirs: Record<string, string> = {}
    for (const [collection, f] of Object.entries(files)) dirs[collection] = await dirWith(f)
    const reads: string[] = []
    const l = payloadHeroLoader({
      staticDirs: async (collection) => {
        reads.push(collection ?? '')
        return collection === undefined ? Object.values(dirs) : [dirs[collection] as string]
      },
      colours: false,
    })
    return {
      l,
      reads,
      has: (hero: Parameters<NonNullable<typeof l.hasAlpha>>[0], collection?: string) =>
        (l.hasAlpha as NonNullable<typeof l.hasAlpha>)(verifiedUpload({ ...hero }, collection)),
    }
  }

  it('hasAlpha: the same upload tag in two collections is two answers', async () => {
    const solid = { create: { width: 8, height: 8, channels: 4 as const, background: { r: 9, g: 9, b: 9, alpha: 1 } } }
    const { has } = await countingLoader({
      docs: { 'icon.png': await sharp(solid).png().toBuffer() },
      media: { 'icon.png': await sharp(Buffer.from(ICON)).png().toBuffer() },
    })
    const hero = upload('icon.png') // the same id and updatedAt in both
    expect(await has(hero, 'docs')).toBe(false)
    expect(await has(hero, 'media')).toBe(true)
    expect(await has(hero, 'docs')).toBe(false)
  })

  it('hasAlpha asks the file once per upload: concurrent askers share a read, later ones read nothing', async () => {
    const { has, reads } = await countingLoader({ m: { 'icon.png': await sharp(Buffer.from(ICON)).png().toBuffer() } })
    const hero = upload('icon.png')
    const answers = await Promise.all([has(hero, 'm'), has(hero, 'm'), has(hero, 'm')])
    expect(answers).toEqual([true, true, true])
    expect(reads).toHaveLength(1)
    await has(hero, 'm')
    expect(reads).toHaveLength(1)
  })

  it('an upload is judged by its bytes, not its mimeType label', async () => {
    const tiny = { create: { width: 4, height: 4, channels: 4 as const, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }
    const { has } = await countingLoader({
      m: {
        'p.jpg': await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
          .jpeg()
          .toBuffer(),
        'mislabelled.png': await sharp(tiny).png().toBuffer(),
      },
    })
    expect(await has({ ...upload('p.jpg'), mimeType: 'image/jpeg' } as never, 'm')).toBe(false)
    // A transparent PNG whose stored label says JPEG (an imported or hand-edited row) still moves its card's URL.
    expect(await has({ ...upload('mislabelled.png'), mimeType: 'image/jpeg' } as never, 'm')).toBe(true)
  })

  it('the memory is a bounded LRU: the least recently asked upload is the one forgotten', async () => {
    const tiny = { create: { width: 4, height: 4, channels: 4 as const, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }
    const { has, reads } = await countingLoader({ m: { 'icon.png': await sharp(tiny).png().toBuffer() } })
    const at = (n: number) => ({ ...upload('icon.png'), id: n })
    await has(at(0), 'm')
    for (let n = 1; n <= 1000; n++) {
      await has(at(n), 'm')
      if (n === 500) await has(at(0), 'm') // touched again: now newer than 1..500
    }
    expect(reads).toHaveLength(1001) // 0..1000 read once each; the touch at 500 was a hit
    await has(at(0), 'm') // kept: it was touched
    expect(reads).toHaveLength(1001)
    await has(at(1), 'm') // the oldest untouched one went when the cap was passed
    expect(reads).toHaveLength(1002)
  })
})

describe('readable', () => {
  it('shares a concurrent read but remembers no answer: a file lost or fixed after an answer is noticed', async () => {
    const dir = await dirWith({ 'icon.png': await sharp(Buffer.from(ICON)).png().toBuffer() })
    let reads = 0
    const l = payloadHeroLoader({
      staticDirs: async () => {
        reads += 1
        return [dir]
      },
      colours: false,
    })
    const ask = (name: string) => (l.readable as NonNullable<typeof l.readable>)(upload(name))
    expect(await Promise.all([ask('icon.png'), ask('icon.png'), ask('icon.png')])).toEqual([true, true, true])
    expect(reads).toBe(1) // concurrent askers share one read
    await rm(path.join(dir, 'icon.png')) // the upload document is unchanged; the file is gone
    expect(await ask('icon.png')).toBe(false)
    expect(reads).toBe(2)
    expect(await ask('gone.png')).toBe(false)
    await writeFile(path.join(dir, 'gone.png'), await sharp(Buffer.from(ICON)).png().toBuffer())
    expect(await ask('gone.png')).toBe(true)
  })
})
