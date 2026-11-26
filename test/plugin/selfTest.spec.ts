/** Mutation table (production line -> the test that goes RED). Surface: start-up cost (Payload boots for every command, the CLI included).
 * - plugin/index.ts `selfTest`: draw a fallback card again (any renderer call) -> "onInit never calls the renderer: the cheap checks only" RED
 * A renderer that cannot draw is reported by the first real render (test/internal/handler specs: render_error + the degraded fallback). */
import { readFile } from 'node:fs/promises'
import type { Config } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type OgImagePluginOptions, ogImagePlugin } from '../../src/plugin/index.js'
import { defineTarget, defineTemplate } from '../../src/template.js'
import { realPng } from '../helpers.js'

const renderer = vi.hoisted(() => ({
  render: undefined as undefined | ((el: unknown, o: { width: number; height: number }) => Promise<Uint8Array>),
}))
vi.mock('../../src/render/nextOg.js', () => ({ nextOgRenderer: () => ({ render: (el: unknown, o: never) => renderer.render?.(el, o) }) }))

const font = () => readFile(new URL('../fixtures/fonts/inter-latin-cyrillic-800.woff', import.meta.url))
const post = defineTemplate<{ title: string }>({ id: 'post', revision: '1', textFields: ['title'], render: () => null as never })
const options = (over: Partial<OgImagePluginOptions> = {}): OgImagePluginOptions => ({
  site: () => ({ name: 'Site' }),
  fonts: [{ family: 'Inter', weight: 800, data: font }],
  stacks: { default: ['Inter'] },
  templates: [post],
  targets: { posts: defineTarget<any, any>({ path: '/og/:kind/:slug/card.png', template: 'post', props: () => ({ title: 'x' }) }) },
  store: { memory: true },
  ...over,
})
const config = () =>
  ({ serverURL: 'https://x.test', collections: [{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }] }) as Config
const run = (o: OgImagePluginOptions) => ogImagePlugin(o)(config()).onInit?.({} as never)
const PNG = await realPng('self-test')

describe('ogImagePlugin: start-up draws no card', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('onInit never calls the renderer: the cheap checks only', async () => {
    const draw = vi.fn(async (_el: unknown, _o: unknown) => PNG)
    renderer.render = draw
    await expect(run(options())).resolves.toBeUndefined()
    await expect(run(options({ brand: { ink: '#123456', paper: '#abcdef' } }))).resolves.toBeUndefined()
    expect(draw).not.toHaveBeenCalled()
  })

  it('a renderer that cannot draw does not stop the start-up: the first render reports it', async () => {
    renderer.render = async () => {
      throw new Error('satori exploded')
    }
    await expect(run(options())).resolves.toBeUndefined()
  })
})
