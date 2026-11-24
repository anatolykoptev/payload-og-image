/** Mutation table (production line -> the test that goes RED).
 * - events.ts:31    remove the try/catch around the sink          -> "a throwing sink never fails the caller" RED
 * - events.ts:7 log every hit_* event (drop the 1/100 sampling) -> "samples cache hits" RED
 * - events.ts:27  stop counting                                  -> "counts every event by name" RED */
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
  it('the default sink formats one line per event', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    createEventSink().emit({ name: 'render', kind: 'posts', slug: 'a', v: 'abc', ms: 12.4 })
    expect(warn).toHaveBeenCalledWith('[payload-og] event=render kind=posts slug=a v=abc ms=12')
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
