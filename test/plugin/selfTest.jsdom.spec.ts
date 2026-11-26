// @vitest-environment jsdom
/** The start-up self-test runs the real renderer under vitest's jsdom environment (the globals come from another realm).
 * Mutation table: nextOg.ts `inNodeRealm(...)` wrapper removed -> "draws the fallback card with the real renderer" RED ("Unsupported input"). */
import { readFile } from 'node:fs/promises'
import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { ogImagePlugin } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'

const post = defineTemplate<{ title: string }>({ id: 'post', revision: '1', textFields: ['title'], render: () => null as never })
describe('start-up self-test under jsdom', () => {
  it('draws the fallback card with the real renderer', async () => {
    const o = ogImagePlugin({
      site: () => ({ name: 'Site' }),
      fonts: [{ family: 'Inter', weight: 800, data: () => readFile(`${process.cwd()}/test/fixtures/fonts/inter-latin-cyrillic-800.woff`) }],
      stacks: { default: ['Inter'] },
      templates: [post],
      targets: { posts: defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({ title: 'x' }) }) },
      store: { memory: true },
    })({ serverURL: 'https://x.test', collections: [{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }] } as Config)
    await expect(o.onInit?.({} as never)).resolves.toBeUndefined()
  })
})
