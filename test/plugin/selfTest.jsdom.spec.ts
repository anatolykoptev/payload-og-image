// @vitest-environment jsdom
/** The plugin boots under vitest's jsdom environment (the globals come from another realm). Nothing is drawn at start-up, so no
 * renderer reaches `sharp` with another realm's `Uint8Array`: rendering itself needs Node (docs/reference.md, "Specs that boot Payload").
 * Mutation table: plugin/index.ts `selfTest` draws a card again -> "the plugin boots under jsdom and draws nothing" RED (the renderer spy is called). */
import { readFile } from 'node:fs/promises'
import type { Config } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { ogImagePlugin } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'

const draw = vi.hoisted(() => vi.fn())
vi.mock('../../src/render/nextOg.js', () => ({ nextOgRenderer: () => ({ render: draw }) }))

const post = defineTemplate<{ title: string }>({ id: 'post', revision: '1', textFields: ['title'], render: () => null as never })
describe('start-up under jsdom', () => {
  it('the plugin boots under jsdom and draws nothing', async () => {
    const o = ogImagePlugin({
      site: () => ({ name: 'Site' }),
      fonts: [{ family: 'Inter', weight: 800, data: () => readFile(`${process.cwd()}/test/fixtures/fonts/inter-latin-cyrillic-800.woff`) }],
      stacks: { default: ['Inter'] },
      templates: [post],
      targets: { posts: defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({ title: 'x' }) }) },
      store: { memory: true },
    })({ serverURL: 'https://x.test', collections: [{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }] } as Config)
    await expect(o.onInit?.({} as never)).resolves.toBeUndefined()
    expect(draw).not.toHaveBeenCalled()
  })
})
