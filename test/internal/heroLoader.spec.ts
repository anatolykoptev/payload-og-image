/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a transparent hero flattened onto the wrong colour changes every such card with no error.
 * - runtime.ts:70 `background: o.heroBackground` removed -> "a transparent hero is flattened onto heroBackground" RED
 * - index.ts:124 `heroBackground` never validated -> plugin.spec "a css injection as the hero background" RED */
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Payload } from 'payload'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { heroLoaderFor } from '../../src/internal/runtime.js'

const pixel = async (dataUrl: string) => {
  const { data } = await sharp(Buffer.from(dataUrl.split(',')[1] as string, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return [...data.subarray(0, 4)]
}

describe('heroLoaderFor', () => {
  it('a transparent hero is flattened onto heroBackground (white by default)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'og-hero-'))
    await writeFile(
      path.join(dir, 't.png'),
      await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .png()
        .toBuffer(),
    )
    const payload = { collections: { media: { config: { upload: { staticDir: dir } } } } } as unknown as Payload
    const hero = { id: 1, filename: 't.png', url: '/m/t.png', updatedAt: 'u' }
    const box = { width: 20, height: 20 }
    expect(
      await pixel((await heroLoaderFor(payload, { heroBackground: '#f1f3ef' })(hero, box, { collection: 'media' })) as string),
    ).toEqual([241, 243, 239, 255])
    expect(await pixel((await heroLoaderFor(payload, {})(hero, box, { collection: 'media' })) as string)).toEqual([255, 255, 255, 255])
  })
})
