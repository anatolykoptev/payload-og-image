/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a card that cannot be drawn at all, found only by the first crawler.
 * - index.ts:210  do not draw the fallback card at start-up -> "draws the fallback card once with the renderer", "a renderer that cannot draw fails the start-up", "in production ... logs" RED
 * - index.ts:210  draw it with a hard-coded default instead of the configured brand -> "draws the brand's fallback" RED
 * - selfTest.ts:19  accept any bytes the renderer returns -> "a renderer that returns no PNG fails the start-up" RED */
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

describe('ogImagePlugin: start-up draws the fallback card', () => {
  beforeEach(() => {
    renderer.render = async () => PNG
  })
  afterEach(() => vi.unstubAllEnvs())

  it('draws the fallback card once with the renderer', async () => {
    const draw = vi.fn(async (_el: unknown, _o: unknown) => PNG)
    renderer.render = draw
    await expect(run(options())).resolves.toBeUndefined()
    expect(draw).toHaveBeenCalledTimes(1)
    expect(draw).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ width: 1200, height: 630 }))
    expect(JSON.stringify(draw.mock.calls[0]?.[0])).toContain('Aa') // the sample, drawn as the site name
  })

  it("draws the brand's fallback", async () => {
    const draw = vi.fn(async (_el: unknown, _o: unknown) => PNG)
    renderer.render = draw
    await run(options({ brand: { ink: '#123456', paper: '#abcdef' } }))
    expect(JSON.stringify(draw.mock.calls[0]?.[0])).toContain('#abcdef')
  })

  it('a renderer that cannot draw fails the start-up, naming the cause', async () => {
    renderer.render = async () => {
      throw new Error('satori exploded')
    }
    await expect(run(options())).rejects.toThrow(/start-up check failed.*fallback card cannot be drawn: satori exploded/)
  })

  it('a renderer that returns no PNG fails the start-up', async () => {
    renderer.render = async () => new Uint8Array([1, 2, 3])
    await expect(run(options())).rejects.toThrow(/fallback card cannot be drawn: .*invalid PNG/)
  })

  it('in production it logs through the event sink instead of throwing', async () => {
    renderer.render = async () => {
      throw new Error('satori exploded')
    }
    const events: Array<{ name: string; detail?: { message?: string } }> = []
    vi.stubEnv('NODE_ENV', 'production')
    await expect(run(options({ onEvent: (e) => events.push(e) }))).resolves.toBeUndefined()
    expect(events[0]?.name).toBe('render_error')
    expect(events[0]?.detail?.message).toMatch(/fallback card cannot be drawn: satori exploded/)
  })
})
