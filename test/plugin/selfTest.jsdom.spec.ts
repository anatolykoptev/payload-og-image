// @vitest-environment jsdom
/** The start-up self-test runs the real renderer under vitest's jsdom environment (the globals come from another realm).
 * Mutation table: nextOg.ts `inNodeRealm(...)` wrapper removed -> "draws the fallback card with the real renderer" RED ("Unsupported input").
 * realm.ts `underlyingOf` always undefined (a copy cannot see through another copy's wrapper) -> "two copies of the module drawing interleaved ..." RED
 * realm.ts release(): never restore the global -> "the global TextEncoder is put back ..." RED; restore when the FIRST draw ends (no ownership count) -> the same test RED (`seen`/the wrapped check). */
import { readFile } from 'node:fs/promises'
import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { ogImagePlugin } from '../../src/plugin/index.js'
import { inNodeRealm } from '../../src/render/realm.js'
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

  it('the global TextEncoder is put back after overlapping draws and after a throwing one', async () => {
    const original = globalThis.TextEncoder
    let letGo!: () => void
    const gate = new Promise<void>((r) => {
      letGo = r
    })
    const seen: boolean[] = []
    const a = inNodeRealm(async () => {
      await gate
      seen.push(globalThis.TextEncoder !== original) // still wrapped while another draw is in flight
    })
    const b = inNodeRealm(async () => {
      seen.push(globalThis.TextEncoder !== original)
      throw new Error('a draw that fails')
    }).catch(() => undefined)
    await b
    expect(globalThis.TextEncoder).not.toBe(original) // `a` still needs the wrapper
    letGo()
    await a
    expect(seen).toEqual([true, true])
    expect(globalThis.TextEncoder).toBe(original)
  })

  it('two copies of the module drawing interleaved (A start, B start, A end, B end) leave the original encoder', async () => {
    // @ts-expect-error a query suffix makes vite load a second instance of the module; it has no type declaration
    const other = (await import('../../src/render/realm.js?copy')) as typeof import('../../src/render/realm.js')
    const original = globalThis.TextEncoder
    const latch = () => {
      let go!: () => void
      const wait = new Promise<void>((r) => {
        go = r
      })
      return { go, wait }
    }
    const a = latch()
    const b = latch()
    const drawA = inNodeRealm(() => a.wait)
    const drawB = other.inNodeRealm(() => b.wait)
    expect(globalThis.TextEncoder).not.toBe(original)
    a.go()
    await drawA
    b.go()
    await drawB
    expect(globalThis.TextEncoder).toBe(original)
  })
})
