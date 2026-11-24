/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a NaN or fractional cap silently disables the bound it was meant to set.
 * - memo.ts:19  no memo maxBytes validation -> "memo maxBytes refuses NaN, 0, a negative and Infinity" RED
 * - memory.ts:6  no memory-store validation -> "memory store maxBytes refuses ..." RED
 * - disk.ts:54  no disk maxBytes validation -> "disk store maxBytes refuses ..." RED
 * - disk.ts:53  no maxFiles validation -> "the disk store refuses a fractional or negative count ..." RED
 * - disk.ts:55  no keepPerPage validation -> same test RED
 * - disk.ts:56  no pruneEveryMs validation -> same test RED
 * - limits.ts:6  accept fractions in assertInt -> "assertInt / assertNumber accept the in-range value and refuse NaN, fractions ..." RED */
import { describe, expect, it } from 'vitest'
import { assertInt, assertNumber } from '../../src/internal/limits.js'
import { createMemo } from '../../src/internal/memo.js'
import { diskStore } from '../../src/internal/store/disk.js'
import { memoryStore } from '../../src/internal/store/memory.js'

describe('numeric options are validated, not trusted', () => {
  it('assertInt / assertNumber accept the in-range value and refuse NaN, fractions, strings and out-of-range', () => {
    expect(assertInt('x', 3, 1)).toBe(3)
    for (const bad of [Number.NaN, 1.5, '3', null, 0, 10])
      expect(() => assertInt('x', bad, 1, 5)).toThrow(/x must be an integer from 1 to 5/)
    expect(assertNumber('y', Number.POSITIVE_INFINITY, 0, { finite: false })).toBe(Number.POSITIVE_INFINITY)
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, '1']) expect(() => assertNumber('y', bad, 0)).toThrow(/y must be/)
  })
  it.each([
    ['memo maxBytes', (v: number) => createMemo({ maxBytes: v })],
    ['memory store maxBytes', (v: number) => memoryStore({ maxBytes: v })],
    ['disk store maxBytes', (v: number) => diskStore({ dir: '/x', maxBytes: v })],
  ])('%s refuses NaN, 0, a negative and Infinity', (name, make) => {
    for (const bad of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY])
      expect(() => make(bad), `${name}=${bad}`).toThrow(/must be a finite number/)
  })
  it('the disk store refuses a fractional or negative count and a NaN interval, but accepts an infinite one', () => {
    expect(() => diskStore({ dir: '/x', maxFiles: 1.5 })).toThrow(/maxFiles/)
    expect(() => diskStore({ dir: '/x', maxFiles: -1 })).toThrow(/maxFiles/)
    expect(() => diskStore({ dir: '/x', keepPerPage: 0 })).toThrow(/keepPerPage/)
    expect(() => diskStore({ dir: '/x', pruneEveryMs: Number.NaN })).toThrow(/pruneEveryMs/)
    expect(() => diskStore({ dir: '/x', pruneEveryMs: Number.POSITIVE_INFINITY })).not.toThrow()
    expect(() => diskStore({ dir: '' })).toThrow(/non-empty path/)
  })
})
