/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a caller's fixable mistake, or a shed, reported as `internal_error`.
 * - runtime.ts disabled stub `audit` throws a plain Error -> "a disabled plugin's audit says so" RED
 * - runtime.ts getRuntime "not in this Payload config" is a plain Error -> "a config without the plugin says so" RED
 * - core.ts `isShedError(e)` -> `e instanceof ShedError` -> "a shed from another copy of the module is still a retry" RED
 * - core.ts `isToolInputError(e)` -> `e instanceof ToolInputError` -> "an input error from another copy of the module is still said" RED */
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

  it('a shed from another copy of the module is still a retry', async () => {
    // @ts-expect-error a query suffix makes vite load a second instance of the module; it has no type declaration
    const { ShedError: Other } = (await import('../../src/internal/gate.js?copy')) as typeof import('../../src/internal/gate.js') // a second copy of the class, as a bundler duplicating gate.js makes
    setTestRuntime({
      inspect: { audit: async () => Promise.reject(new Other()), scopes: async () => Promise.reject(new Other()) },
    } as never)
    const r = await call('og_audit')
    expect(r.text).toMatch(/busy/)
    expect(r.text).not.toContain('internal_error')
  })

  it('an input error from another copy of the module is still said', async () => {
    // @ts-expect-error see above
    const { ToolInputError: Other } = (await import('../../src/internal/inspect.js?copy')) as typeof import('../../src/internal/inspect.js')
    setTestRuntime({ inspect: { scopes: async () => Promise.reject(new Other('no scope x')) } } as never)
    const r = await call('og_audit')
    expect(r.text).toContain('no scope x')
    expect(r.text).not.toContain('internal_error')
  })
})
