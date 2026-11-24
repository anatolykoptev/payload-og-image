/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a migration that changes a card and still reports parity.
 * - parity.ts:67  skip a colour channel -> "counts every differing pixel, even a single one" RED
 * - parity.ts:51  ignore the layout -> "a different layout is reported even when the pixels match" RED
 * - parity.ts:13  key order matters in the layout comparison -> "identical cards and layouts ... key order does not matter" RED
 * - parity.ts:53  compare different sizes pixel by pixel -> "a missing layout.json ... a different size ... not silent" RED
 * - parity.ts:51  treat two missing layouts as equal -> same test RED
 * - parity.ts:46  ignore a card on one side only -> same test RED
 * - parity.ts:90  exit 0 when there are no cards -> "exits 1 on a difference, on no cards at all, and 2 without both directories" RED
 * - parity.ts:81  run without both directories -> same test RED */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main, parity } from '../../src/testing/parity.js'

const dir = () => mkdtemp(path.join(os.tmpdir(), 'og-parity-'))
const card = async (d: string, name: string, colour: string, layout?: unknown, size = 40) => {
  await writeFile(
    path.join(d, `${name}.png`),
    await sharp({ create: { width: size, height: size, channels: 3, background: colour } })
      .png()
      .toBuffer(),
  )
  if (layout !== undefined) await writeFile(path.join(d, `${name}.layout.json`), JSON.stringify(layout))
}
afterEach(() => vi.restoreAllMocks())

describe('parity', () => {
  it('identical cards and layouts: zero diff, equal layout (key order does not matter)', async () => {
    const [a, b] = [await dir(), await dir()]
    await card(a, 'post', '#c33', { title: { size: 80, lines: 2 }, label: { size: 20 } })
    await card(b, 'post', '#c33', { label: { size: 20 }, title: { lines: 2, size: 80 } })
    expect(await parity(a, b)).toEqual([{ card: 'post', layoutEqual: true, pixelDiff: 0 }])
  })
  it('counts every differing pixel, even a single one (no anti-aliasing allowance)', async () => {
    const [a, b] = [await dir(), await dir()]
    await card(a, 'post', '#cc3333', { x: 1 })
    await writeFile(
      path.join(b, 'post.png'),
      await sharp({ create: { width: 40, height: 40, channels: 3, background: '#cc3333' } })
        .composite([{ input: Buffer.from([0xcc, 0x33, 0x34]), raw: { width: 1, height: 1, channels: 3 }, left: 5, top: 5 }])
        .png()
        .toBuffer(),
    )
    await writeFile(path.join(b, 'post.layout.json'), JSON.stringify({ x: 1 }))
    expect((await parity(a, b))[0]).toMatchObject({ pixelDiff: 1, layoutEqual: true })
  })
  it('a different layout is reported even when the pixels match', async () => {
    const [a, b] = [await dir(), await dir()]
    await card(a, 'post', '#c33', { title: { size: 80 } })
    await card(b, 'post', '#c33', { title: { size: 78 } })
    expect((await parity(a, b))[0]).toMatchObject({ pixelDiff: 0, layoutEqual: false })
  })
  it('a missing layout.json is not equal, a different size and a card on one side only are not silent', async () => {
    const [a, b] = [await dir(), await dir()]
    await card(a, 'nolayout', '#c33')
    await card(b, 'nolayout', '#c33')
    await card(a, 'resized', '#c33', {}, 40)
    await card(b, 'resized', '#c33', {}, 41)
    await card(a, 'gone', '#c33', {})
    await card(b, 'extra', '#c33', {})
    const rows = Object.fromEntries((await parity(a, b)).map((r) => [r.card, r]))
    expect(rows.nolayout).toMatchObject({ layoutEqual: false, pixelDiff: 0, note: 'layout.json missing' })
    expect(rows.resized?.pixelDiff).toBe(Number.POSITIVE_INFINITY)
    expect(rows.gone).toMatchObject({ note: 'only in old', pixelDiff: Number.POSITIVE_INFINITY })
    expect(rows.extra).toMatchObject({ note: 'only in new' })
  })
})

describe('og-parity CLI (main)', () => {
  const quiet = () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  }
  it('exits 0 only when every card is identical, and prints a table', async () => {
    quiet()
    const [a, b] = [await dir(), await dir()]
    await card(a, 'post', '#c33', { t: 1 })
    await card(b, 'post', '#c33', { t: 1 })
    expect(await main(['--old', a, '--new', b])).toBe(0)
    expect(console.log).toHaveBeenCalledWith('1/1 cards identical')
  })
  it('exits 1 on a difference, on no cards at all, and 2 without both directories', async () => {
    quiet()
    const [a, b, empty] = [await dir(), await dir(), await dir()]
    await card(a, 'post', '#c33', { t: 1 })
    await card(b, 'post', '#33c', { t: 1 })
    expect(await main(['--old', a, '--new', b])).toBe(1)
    expect(await main(['--old', empty, '--new', empty])).toBe(1)
    expect(await main(['--old', a])).toBe(2)
    await mkdir(path.join(a, 'sub'))
  })
})
