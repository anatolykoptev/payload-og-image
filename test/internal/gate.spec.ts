/** Mutation table (production line -> the test that goes RED). Silent-failure surface: an unbounded queue is OOM, not an error.
 * - gate.ts:33  drop the shed check -> "sheds the call past the queue and returns to zero after release" RED
 * - gate.ts:27  release() always decrements `active` -> "hands the slot over without dipping below the concurrency" RED
 * - gate.ts:38  run the release only on success -> "a throwing job frees its slot" RED
 * - gate.ts:19  accept a fractional/NaN concurrency -> "refuses the non-integer or out-of-range option" RED
 * - gate.ts:21  accept a negative/NaN queue -> same test RED */
import { describe, expect, it } from 'vitest'
import { createGate, ShedError } from '../../src/internal/gate.js'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const tick = () => new Promise((r) => setImmediate(r))

describe('createGate', () => {
  it('sheds the call past the queue and returns to zero after release', async () => {
    const gate = createGate({ concurrency: 2, queue: 1 })
    const d = [deferred(), deferred(), deferred()]
    const jobs = d.map((x) => gate.run(() => x.promise))
    await tick()
    expect(gate.stats()).toEqual({ active: 2, waiting: 1 })
    await expect(gate.run(async () => 'x')).rejects.toBeInstanceOf(ShedError)
    for (const x of d) x.resolve()
    await Promise.all(jobs)
    expect(gate.stats()).toEqual({ active: 0, waiting: 0 })
  })
  it('hands the slot over without dipping below the concurrency', async () => {
    const gate = createGate({ concurrency: 1, queue: 5 })
    const first = deferred()
    const seen: number[] = []
    const a = gate.run(() => first.promise)
    const b = gate.run(async () => {
      seen.push(gate.stats().active)
    })
    await tick()
    first.resolve()
    await Promise.all([a, b])
    expect(seen).toEqual([1])
    expect(gate.stats()).toEqual({ active: 0, waiting: 0 })
  })
  it('a throwing job frees its slot', async () => {
    const gate = createGate({ concurrency: 1, queue: 0 })
    await expect(gate.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(gate.stats()).toEqual({ active: 0, waiting: 0 })
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok')
  })
  it('a job that throws synchronously frees its slot too', async () => {
    const gate = createGate({ concurrency: 1, queue: 0 })
    await expect(
      gate.run(() => {
        throw new Error('sync')
      }),
    ).rejects.toThrow('sync')
    expect(gate.stats().active).toBe(0)
  })
  it.each([
    [{ concurrency: 1.5 }],
    [{ concurrency: Number.NaN }],
    [{ concurrency: Number.POSITIVE_INFINITY }],
    [{ queue: -1 }],
    [{ queue: Number.NaN }],
    [{ queue: 2.5 }],
  ])('refuses the non-integer or out-of-range option %j', (o) => expect(() => createGate(o)).toThrow(/integer/))
  it('refuses a concurrency below 1', () => expect(() => createGate({ concurrency: 0 })).toThrow(/at least 1/))
})
