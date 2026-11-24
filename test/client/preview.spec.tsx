// @vitest-environment jsdom
/** Mutation table (production line -> the test that goes RED). The component only asks for a preview and shows it; it holds no secret.
 * - OgPreviewField.tsx:82  post on every change without the 800 ms debounce -> "one POST 800 ms after a change" RED
 * - OgPreviewField.tsx:86  never abort the previous request -> "a change aborts the previous request" RED
 * - OgPreviewField.tsx:74  never revoke the old blob URL -> "revokes the previous blob URL" RED
 * - OgPreviewField.tsx  drop the warnings from the loading state -> "keeps the last warnings visible ..." RED
 * - OgPreviewField.tsx:62  retry a 503 more than once -> "a second 503 in a row is not retried again" RED; not at all -> "a 503 shows Busy, retrying ..." RED */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let fields: Record<string, unknown> = { v: 0 }
const getData = vi.fn(() => ({ title: 'Hello' }))
vi.mock('@payloadcms/ui', () => ({
  useForm: () => ({ getData }),
  useAllFormFields: () => [fields, vi.fn()],
  useDocumentInfo: () => ({ id: 42, collectionSlug: 'posts' }),
  useConfig: () => ({ config: { routes: { api: '/api' }, serverURL: '' } }),
}))

import { OgPreviewField } from '../../src/client/OgPreviewField.js'

const png = (warnings: unknown = { missing: [], overBudget: false, customIneligible: false, customTooSmall: false, modeOff: false }) =>
  new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      // As the endpoint sends it: ASCII only.
      'x-og-warnings': JSON.stringify(warnings).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`),
    },
  })
let fetchMock: ReturnType<typeof vi.fn>
const el = () => <OgPreviewField {...({} as any)} />

beforeEach(() => {
  vi.useFakeTimers()
  fields = { v: 0 }
  fetchMock = vi.fn(async () => png())
  vi.stubGlobal('fetch', fetchMock)
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

describe('OgPreviewField', () => {
  it('one POST 800 ms after a change, with the form data, the collection and the id', async () => {
    const { rerender } = render(el())
    await tick(799)
    expect(fetchMock).not.toHaveBeenCalled()
    await tick(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/payload-og-image/preview')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body as string)).toEqual({ collection: 'posts', id: 42, doc: { title: 'Hello' } })
    // Three quick changes are one request.
    for (const v of [1, 2, 3]) {
      fields = { v }
      rerender(el())
      await tick(300)
    }
    await tick(800)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('a change aborts the previous request', async () => {
    let first: AbortSignal | undefined
    fetchMock.mockImplementationOnce((_u: string, init: RequestInit) => {
      first = init.signal as AbortSignal
      return new Promise(() => {})
    })
    const { rerender } = render(el())
    await tick(800)
    expect(first?.aborted).toBe(false)
    fields = { v: 1 }
    rerender(el())
    await tick(800)
    expect(first?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('shows an <img> with a blob URL, and revokes the previous blob URL', async () => {
    const { rerender } = render(el())
    await tick(800)
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toBe('blob:preview-1')
    fields = { v: 1 }
    rerender(el())
    await tick(800)
    expect((screen.getByRole('img') as HTMLImageElement).src).toBe('blob:preview-2')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
  })
  it('names the characters that cannot be drawn', async () => {
    fetchMock.mockResolvedValueOnce(
      png({ missing: ['🚀'], overBudget: false, customIneligible: false, customTooSmall: false, modeOff: false }),
    )
    render(el())
    await tick(800)
    expect(screen.getByText('1 character cannot be drawn: 🚀')).toBeTruthy()
  })
  it('says the other warnings in plain words', async () => {
    fetchMock.mockResolvedValueOnce(png({ missing: [], overBudget: true, customIneligible: true, customTooSmall: true, modeOff: true }))
    render(el())
    await tick(800)
    for (const t of [
      'This page shows no share image: mode is Off',
      'The custom image cannot be shared (SVG or no size on record)',
      'The custom image is smaller than 600x315',
      'Card is over 300 KB',
    ])
      expect(screen.getByText(t)).toBeTruthy()
  })
  it('a 503 shows Busy, retrying and retries once after 5 s', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'retry-after': '5' } }))
    render(el())
    await tick(800)
    expect(screen.getByText('Busy, retrying')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(4999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await tick(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Busy, retrying')).toBeNull()
  })
  it('a second 503 in a row is not retried again', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }))
    render(el())
    await tick(800)
    await tick(5000)
    await tick(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('No preview: the server could not draw the card')).toBeTruthy()
  })
  it('a failed preview says so instead of showing nothing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
    render(el())
    await tick(800)
    expect(screen.getByText('No preview: you may not preview this document')).toBeTruthy()
  })
  it('keeps the last warnings visible while the next request is in flight', async () => {
    fetchMock.mockResolvedValueOnce(
      png({ missing: ['🚀'], overBudget: false, customIneligible: false, customTooSmall: false, modeOff: false }),
    )
    const { rerender } = render(el())
    await tick(800)
    expect(screen.getByText('1 character cannot be drawn: 🚀')).toBeTruthy()
    fetchMock.mockImplementationOnce(() => new Promise(() => {}))
    fields = { v: 1 }
    rerender(el())
    await tick(800)
    expect(screen.getByText('1 character cannot be drawn: 🚀')).toBeTruthy()
  })
  it('says how many characters when the list is cut', async () => {
    fetchMock.mockResolvedValueOnce(
      png({ missing: ['a', 'b'], missingCount: 500, overBudget: false, customIneligible: false, customTooSmall: false, modeOff: false }),
    )
    render(el())
    await tick(800)
    expect(screen.getByText('500 characters cannot be drawn: a b …')).toBeTruthy()
  })
})
