/** The boot budget, pinned structurally: Payload loads the config for every command (the CLI included), so importing the plugin, applying
 * it and running its start-up check must not load the renderer or an image library. Each heavy package is mocked with a factory that
 * records the import and hands back the real module, so a static import anywhere on the path shows as a recorded load.
 * Mutation table: a static `import sharp from 'sharp'` restored in render/encode.ts, hero.ts, shape.ts or internal/store/validate.ts
 * -> "importing the entries and applying the plugin loads no heavy dependency" RED ('sharp' recorded);
 * a static `import * as fontkit from 'fontkit'` restored in internal/fonts.ts -> the same test RED ('fontkit');
 * a static `next/og.js` import in render/nextOg.ts or on the /next path -> the same test RED ('next/og').
 * A draw at start-up -> "start-up loads no renderer and no image library" RED. */
import { readFile } from 'node:fs/promises'
import type { Config } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loaded = vi.hoisted(() => [] as string[])
vi.mock('sharp', async (original) => {
  loaded.push('sharp')
  return original()
})
vi.mock('fontkit', async (original) => {
  loaded.push('fontkit')
  return original()
})
vi.mock('next/og.js', async (original) => {
  loaded.push('next/og')
  return original()
})
vi.mock('@vercel/og', () => {
  loaded.push('@vercel/og')
  return {}
})

const font = () => readFile(new URL('../fixtures/fonts/inter-latin-cyrillic-800.woff', import.meta.url))

describe('plugin boot budget', () => {
  beforeEach(() => {
    loaded.length = 0
    vi.resetModules()
  })

  it('importing the entries and applying the plugin loads no heavy dependency', async () => {
    const root = await import('../../src/exports/index.js')
    await import('../../src/exports/next.js')
    const { defineTarget, defineTemplate } = root
    const post = defineTemplate<{ title: string }>({ id: 'post', revision: '1', textFields: ['title'], render: () => null as never })
    root.ogImagePlugin({
      site: () => ({ name: 'Site' }),
      fonts: [{ family: 'Inter', weight: 800, data: font }],
      stacks: { default: ['Inter'] },
      templates: [post],
      targets: { posts: defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({ title: 'x' }) }) },
      store: { memory: true },
    })({ serverURL: 'https://x.test', collections: [{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }] } as Config)
    expect(loaded).toEqual([])
  })

  it('start-up loads no renderer and no image library (the font check reads the faces with fontkit, nothing else)', async () => {
    const { ogImagePlugin, defineTarget, defineTemplate } = await import('../../src/exports/index.js')
    await import('../../src/exports/next.js')
    const post = defineTemplate<{ title: string }>({ id: 'post', revision: '1', textFields: ['title'], render: () => null as never })
    const config = ogImagePlugin({
      site: () => ({ name: 'Site' }),
      fonts: [{ family: 'Inter', weight: 800, data: font }],
      stacks: { default: ['Inter'] },
      templates: [post],
      targets: { posts: defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({ title: 'x' }) }) },
      store: { memory: true },
    })({ serverURL: 'https://x.test', collections: [{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }] } as Config)
    await config.onInit?.({} as never)
    expect(loaded.filter((m) => m !== 'fontkit')).toEqual([])
  })
})
