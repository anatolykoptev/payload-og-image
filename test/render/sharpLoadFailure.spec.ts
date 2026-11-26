/** Mutation table: a sharp that cannot load must reach `render_error` with its name, not become a silent hero-less card.
 * - hero.ts `load` catch without the `DepLoadError` rethrow -> "a hero whose sharp cannot load rejects naming sharp" RED
 * - hero.ts `hasAlpha` catch without the rethrow -> "hasAlpha rejects naming sharp" RED
 * - shape.ts `prepareShape` catch without the rethrow -> "a shaped image rejects naming sharp" RED */
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('sharp', () => {
  throw new Error('the native binary is missing')
})
const { payloadHeroLoader } = await import('../../src/render/hero.js')

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const setup = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'og-nosharp-'))
  await writeFile(path.join(dir, 'a.png'), PNG)
  return {
    loader: payloadHeroLoader({ staticDirs: async () => [dir] }),
    hero: { id: 'a', filename: 'a.png', url: '/m/a.png', updatedAt: 'u' },
  }
}
const box = { width: 100, height: 50 }

describe('a sharp that cannot load', () => {
  it('a hero whose sharp cannot load rejects naming sharp', async () => {
    const { loader, hero } = await setup()
    await expect(loader(hero, box)).rejects.toThrow(/sharp could not be loaded/)
  })
  it('hasAlpha rejects naming sharp', async () => {
    const { loader, hero } = await setup()
    await expect(loader.hasAlpha?.(hero)).rejects.toThrow(/sharp could not be loaded/)
  })
  it('a shaped image rejects naming sharp', async () => {
    const { loader, hero } = await setup()
    await expect(loader(hero, box, { shape: { trim: true } } as never)).rejects.toThrow(/sharp could not be loaded/)
  })
})
