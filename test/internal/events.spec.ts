/** Mutation table (production line -> the test that goes RED).
 * - events.ts:25  remove the try/catch around the sink -> "a throwing sink never fails the caller" RED
 * - events.ts:27  ignore an async sink's rejection -> "an async sink that rejects is not an unhandled rejection" RED
 * - events.ts:7  log every hit_* event (no 1/100 sampling) -> "samples cache hits" RED
 * - events.ts:42  stop counting -> "counts every event by name" RED */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEventSink } from '../../src/internal/events.js'

afterEach(() => vi.restoreAllMocks())

describe('createEventSink', () => {
  it('counts every event by name and hands each to the custom sink', () => {
    const seen: string[] = []
    const sink = createEventSink((e) => seen.push(e.name))
    sink.emit({ name: 'render' })
    sink.emit({ name: 'render' })
    sink.emit({ name: 'shed' })
    expect(sink.counters()).toEqual({ render: 2, shed: 1 })
    expect(seen).toEqual(['render', 'render', 'shed'])
  })
  it('a throwing sink never fails the caller', () => {
    const sink = createEventSink(() => {
      throw new Error('sink down')
    })
    expect(() => sink.emit({ name: 'render' })).not.toThrow()
    expect(sink.counters().render).toBe(1)
  })
  it('an async sink that rejects is not an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const on = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', on)
    try {
      createEventSink(async () => Promise.reject(new Error('async sink down'))).emit({ name: 'render' })
      await new Promise((r) => setTimeout(r, 20))
    } finally {
      process.off('unhandledRejection', on)
    }
    expect(unhandled).toEqual([])
  })
  it('the default sink formats one line per event', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    createEventSink().emit({ name: 'render', kind: 'posts', slug: 'a', v: 'abc', ms: 12.4 })
    expect(warn).toHaveBeenCalledWith('[payload-og] event=render kind=posts slug=a v=abc ms=12')
  })
  it('a request-derived value cannot add a line or a field to the default log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    createEventSink().emit({ name: 'render_error', kind: 'posts', slug: 'a\nevent=forged x=1', detail: { message: 'bad\r\nline' } })
    const line = warn.mock.calls[0]?.[0] as string
    expect(line).not.toMatch(/[\r\n]/)
    expect(line).toContain('slug=a?event=forged?x=1')
    expect(line.match(/event=/g)).toHaveLength(2) // the real one and the neutered text inside slug=...
  })
  it('samples cache hits (first, then every 100th) but logs every other event', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sink = createEventSink()
    for (let i = 0; i < 101; i++) sink.emit({ name: 'hit_memo' })
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockClear()
    for (let i = 0; i < 5; i++) sink.emit({ name: 'shed' })
    expect(warn).toHaveBeenCalledTimes(5)
  })
})
