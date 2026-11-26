/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a transparent hero flattened onto the wrong colour changes every such card with no error.
 * - hero.ts:171 flatten onto white when no ground is set -> "a transparent hero keeps its alpha when the site set none" RED, and heroAlpha.spec "drawn at its own size ... 0 px" RED
 * - runtime.ts:70 `background: o.heroBackground` removed -> "a transparent hero is flattened onto heroBackground" RED
 * - hero.ts `keepAlpha` ignored (a named image flattened onto the site's ground) -> "a named image keeps its alpha on a site that sets heroBackground" RED
 * - index.ts:124 `heroBackground` never validated -> plugin.spec "a css injection as the hero background" RED */

import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Payload } from 'payload'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { heroLoaderFor } from '../../src/internal/runtime.js'
import { verifiedUpload } from '../helpers.js'

const pixel = async (dataUrl: string) => {
  const { data } = await sharp(Buffer.from(dataUrl.split(',')[1] as string, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return [...data.subarray(0, 4)]
}

describe('heroLoaderFor', () => {
  it('flattens onto the normalised colour: #rgb and #RRGGBB spellings draw the same pixel', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'og-hero-'))
    await writeFile(
      path.join(dir, 't.png'),
      await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .png()
        .toBuffer(),
    )
    const payload = { collections: { media: { config: { upload: { staticDir: dir } } } } } as unknown as Payload
    const hero = verifiedUpload({ id: 1, filename: 't.png', url: '/m/t.png', updatedAt: 'u' })
    const px = async (c: string) =>
      pixel((await heroLoaderFor(payload, { heroBackground: c })(hero, { width: 20, height: 20 }, { collection: 'media' })) as string)
    expect(await px('#369')).toEqual([51, 102, 153, 255])
    expect(await px('#336699')).toEqual([51, 102, 153, 255])
  })
  it('a transparent hero is flattened onto heroBackground, and keeps its alpha when the site set none', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'og-hero-'))
    await writeFile(
      path.join(dir, 't.png'),
      await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .png()
        .toBuffer(),
    )
    const payload = { collections: { media: { config: { upload: { staticDir: dir } } } } } as unknown as Payload
    const hero = verifiedUpload({ id: 1, filename: 't.png', url: '/m/t.png', updatedAt: 'u' })
    const box = { width: 20, height: 20 }
    expect(
      await pixel((await heroLoaderFor(payload, { heroBackground: '#f1f3ef' })(hero, box, { collection: 'media' })) as string),
    ).toEqual([241, 243, 239, 255])
    // Only the alpha is pinned: the colour under a clear pixel is whatever the palette quantiser left.
    expect((await pixel((await heroLoaderFor(payload, {})(hero, box, { collection: 'media' })) as string))[3]).toBe(0)
  })
  it('a named image keeps its alpha on a site that sets heroBackground: keepAlpha flattens onto no ground at all', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'og-hero-'))
    await writeFile(
      path.join(dir, 'logo.png'),
      await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .png()
        .toBuffer(),
    )
    const payload = { collections: { media: { config: { upload: { staticDir: dir } } } } } as unknown as Payload
    const logo = verifiedUpload({ id: 1, filename: 'logo.png', url: '/m/logo.png', updatedAt: 'u' })
    const box = { width: 20, height: 20 }
    const load = heroLoaderFor(payload, { heroBackground: '#f1f3ef' })
    expect(await pixel((await load(logo, box, { collection: 'media' })) as string)).toEqual([241, 243, 239, 255]) // the hero: flattened
    expect((await pixel((await load(logo, box, { collection: 'media', keepAlpha: true })) as string))[3]).toBe(0) // a named image: not
    // Not even a ground the call names itself.
    expect((await pixel((await load(logo, box, { collection: 'media', background: '#336699', keepAlpha: true })) as string))[3]).toBe(0)
  })
})
