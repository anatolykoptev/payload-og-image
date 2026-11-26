/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a caller's fixable mistake, or a shed, reported as `internal_error`.
 * - runtime.ts disabled stub `audit` throws a plain Error -> "a disabled plugin's audit says so" RED
 * - runtime.ts getRuntime "not in this Payload config" is a plain Error -> "a config without the plugin says so" RED
 * - gate.ts `isShedError` / inspect.ts `isToolInputError` trust a property (a Symbol.for brand or `name`) instead of `instanceof` -> "an object a site callback throws is an ordinary error ..." RED
 * - isShedError / isToolInputError matching by `name` -> "an error from another copy of the module is not trusted ..." RED (and the lookalike test) */
import type { PayloadRequest } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRuntime, setTestRuntime } from '../../src/internal/runtime.js'
import { ogImageMcpTools } from '../../src/mcp/v3.js'

// A Payload with no plugin in its config: what `getPayload` answers for a site that forgot `ogImagePlugin`.
vi.mock('payload', async (orig) => ({ ...(await orig<typeof import('payload')>()), getPayload: async () => ({ config: { custom: {} } }) }))

type Content = { text: string }
const req = { payload: { config: {}, logger: { error: () => undefined } } } as unknown as PayloadRequest
const call = async (name: 'og_card' | 'og_audit' | 'og_preview', args: Record<string, unknown> = {}) => {
  const tool = ogImageMcpTools().find((t) => t.name === name)
  const out = (await (tool as NonNullable<typeof tool>).handler(args, req, undefined)) as { content: Content[]; isError?: boolean }
  return { text: out.content[0]?.text as string, isError: out.isError === true }
}

afterEach(() => setTestRuntime(null))

describe('tool error sentences', () => {
  it("a disabled plugin's audit says so", async () => {
    setTestRuntime(buildRuntime({ options: { disabled: true }, events: { emit: () => undefined } } as never, {} as never))
    const r = await call('og_audit', { scope: 'posts' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('disabled')
    expect(r.text).not.toContain('internal_error')
  })

  it('a config without the plugin says so', async () => {
    const r = await call('og_card', { target: 'posts', slug: 'a' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('the plugin is not in this Payload config')
    expect(r.text).not.toContain('internal_error')
  })

  it('an error from another copy of the module is not trusted: logged, a generic internal_error, no message', async () => {
    const logged: unknown[] = []
    const logging = { payload: { config: {}, logger: { error: (o: unknown) => logged.push(o) } } } as unknown as PayloadRequest
    // @ts-expect-error a query suffix makes vite load a second instance of the module; it has no type declaration
    const { ShedError: OtherShed } = (await import('../../src/internal/gate.js?copy')) as typeof import('../../src/internal/gate.js')
    const inspectCopy = '../../src/internal/inspect.js?copy'
    const { ToolInputError: OtherInput } = (await import(/* @vite-ignore */ inspectCopy)) as typeof import('../../src/internal/inspect.js')
    for (const e of [new OtherShed(), new OtherInput('secret other-copy detail')]) {
      setTestRuntime({ inspect: { scopes: async () => Promise.reject(e) } } as never)
      const tool = ogImageMcpTools().find((t) => t.name === 'og_audit')
      const out = (await (tool as NonNullable<typeof tool>).handler({}, logging, undefined)) as { content: Content[] }
      expect(out.content[0]?.text).toContain('internal_error')
      expect(out.content[0]?.text).not.toMatch(/secret|busy/)
    }
    expect(logged).toHaveLength(2)
  })

  it('an object a site callback throws is an ordinary error, whatever it carries: logged, its message not exposed', async () => {
    const logged: unknown[] = []
    const logging = { payload: { config: {}, logger: { error: (o: unknown) => logged.push(o) } } } as unknown as PayloadRequest
    // What a site's access function could throw: the old public brands, and the class name, on a plain object.
    const lookalikes = [
      Object.assign(new Error('secret site detail A'), { [Symbol.for('payload-og-image.ShedError')]: true, name: 'ShedError' }),
      Object.assign(new Error('secret site detail B'), { [Symbol.for('payload-og-image.ToolInputError')]: true, name: 'ToolInputError' }),
    ]
    for (const e of lookalikes) {
      setTestRuntime({ inspect: { scopes: async () => Promise.reject(e), audit: async () => Promise.reject(e) } } as never)
      const tool = ogImageMcpTools().find((t) => t.name === 'og_audit')
      const out = (await (tool as NonNullable<typeof tool>).handler({}, logging, undefined)) as { content: Content[] }
      expect(out.content[0]?.text).toContain('internal_error')
      expect(out.content[0]?.text).not.toMatch(/secret|busy/)
    }
    expect(logged).toHaveLength(2)
  })
})
