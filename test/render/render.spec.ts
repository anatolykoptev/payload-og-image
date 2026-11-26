/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a hero read escaping its folder, a fetch the operator never allowed, an invalid PNG cached immutable.
 * - hero.ts:50  open following symlinks -> "a symlink at the file name is not followed" RED; without O_NONBLOCK -> "a FIFO at the file name is a null, not a hang" RED
 * - hero.ts:70  use the stored filename as is -> "(d) a filename with traversal reads only the base name" RED
 * - hero.ts:95  drop the exact host match -> "is never fetched for another host / a subdomain / a trailing-dot host" RED
 * - hero.ts:95  allow plain http -> "is never fetched for plain http" RED; allow userinfo -> "credentials on the allowed host" RED
 * - hero.ts:101  follow redirects -> "(f) an allowlisted host is fetched ... redirect: error" RED
 * - hero.ts:108  ignore a declared content-length over the cap -> "a body over maxBytes is null whether it is declared or only streamed" RED
 * - hero.ts:119  no running cap on the stream -> same test RED
 * - hero.ts `decode`: pass SVG bytes to sharp unvetted -> svgLogo.spec "hostile SVGs are refused" RED (a vetted SVG is drawn since #89)
 * - hero.ts:141  no pixel limit -> "an image above maxPixels is not decoded" RED
 * - hero.ts:56  read a file above maxBytes -> "a file above maxBytes is not read" RED
 * - encode.ts:25  always the palette encoding -> "(b) encodePng keeps the smaller encoding" RED
 * - nextOg.ts:16  accept any card size -> "refuses a bad palette and an out-of-range card size" RED
 * - template.ts:66  accept a size above the cap -> "a template size above the pixel cap is refused when it is defined" RED
 * - (none):0  nextOg.ts `isCompletePng(out)` guard: next/og never yields an invalid PNG here, so no test can reach it; it is the last line before a card may be cached immutable
 * - hero.ts:104  leave an error response body open -> "an error response has its body cancelled, not left open" RED
 * - guardedFetch.ts:19  leave 10/8 out of the blocked ranges -> "isPublicAddress(\"10.1.2.3\") is false", "pinnedLookup refuses a name that resolves only to 10.0.0.9" RED
 * - guardedFetch.ts:70  accept IPv4-mapped IPv6 -> "isPublicAddress(\"::ffff:8.8.8.8\") is false" RED
 * - guardedFetch.ts:93  pin to any resolved address, not a vetted one -> "pinnedLookup ..." (5 tests) RED
 * - hero.ts:97  allow a non-default port -> "an IP literal is refused unless allowlisted exactly ... only the default port is used" RED
 * - hero.ts:99  allow a private IP literal -> same test RED
 * - hero.ts:184  default to the unguarded global fetch -> "the default fetch is refused for an allowlisted name that resolves to 127.0.0.1 / 10.20.30.40 / ::1" RED
 * - hero.ts:190  search every upload collection -> "a hero is read only inside its own upload collection" RED
 * - guardedFetch.ts:43  leave 64:ff9b:1::/48 out of the blocked ranges -> "isPublicAddress(\"64:ff9b:1::1\") is false" RED
 * - guardedFetch.ts:26  leave AS112-v4 out -> "isPublicAddress(\"192.31.196.1\") is false" RED repo-standards: ignore IANA special-purpose or boundary address under test, not a host
 * - guardedFetch.ts:46  narrow 2001::/23 to 2001::/32 -> "isPublicAddress(\"2001:10::1\") is false" / "2001:1::2" RED repo-standards: ignore IANA special-purpose or boundary address under test, not a host
 * - guardedFetch.ts:111  send the request on the global agent (which HTTPS_PROXY / NODE_USE_ENV_PROXY would reroute) -> "uses a dedicated https.Agent ..." RED
 * - guardedFetch.ts:126  build the Response outside a catch (a status 600 or a bad header throws inside the callback) -> "a status outside 200-599 is a rejected fetch, not a crash" goes RED by hanging until the 30 s test timeout (the rejection never comes) */
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { postCard } from '../../dev/src/og/exampleTemplate.js'
import { isCompletePng } from '../../src/internal/store/png.js'
import { encodePng } from '../../src/render/encode.js'
import { createFallbackTemplate, fallbackTemplate } from '../../src/render/fallback.js'
import { guardedFetch, isPublicAddress, pinnedLookup } from '../../src/render/guardedFetch.js'
import { payloadHeroLoader } from '../../src/render/hero.js'
import { nextOgRenderer } from '../../src/render/nextOg.js'
import { defineTemplate } from '../../src/template.js'
import { loadTestFonts } from '../helpers.js'

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'og-render-'))
const jpeg = (w = 800, h = 600) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#3366cc' } })
    .jpeg()
    .toBuffer()
const BOX = { width: 460, height: 630 }
const hero = (over: Record<string, unknown> = {}) => ({ id: 1, filename: 'h.jpg', url: '/media/h.jpg', ...over })
const meta = async (dataUrl: string) => sharp(Buffer.from(dataUrl.split(',')[1] as string, 'base64')).metadata()

describe('nextOgRenderer + encodePng', () => {
  const el = {
    type: 'div',
    props: { style: { display: 'flex', fontSize: 64, fontFamily: 'Inter', color: '#fff', background: '#123' }, children: 'Привет' },
  } as never
  it('(a) renders a complete 1200x630 PNG with the real fixture font', async () => {
    const { fonts } = await loadTestFonts()
    const t0 = performance.now()
    const out = await nextOgRenderer().render(el, { width: 1200, height: 630, fonts })
    // The Q1 baseline: read it from the CI log of the ARM runner.
    console.info(`og-render-ms first=${Math.round(performance.now() - t0)}`)
    const t1 = performance.now()
    await nextOgRenderer().render(el, { width: 1200, height: 630, fonts })
    console.info(`og-render-ms warm=${Math.round(performance.now() - t1)}`)
    expect(isCompletePng(out)).toBe(true)
    const m = await sharp(out).metadata()
    expect([m.width, m.height, m.format]).toEqual([1200, 630, 'png'])
  })
  it('(b) encodePng keeps the smaller encoding, and both encodings pass the store validator', async () => {
    const { fonts } = await loadTestFonts()
    const truecolour = await nextOgRenderer({ palette: false }).render(el, { width: 1200, height: 630, fonts })
    const best = await encodePng(truecolour, { colours: 128, dither: 0.5 })
    expect(isCompletePng(truecolour)).toBe(true)
    expect(isCompletePng(best)).toBe(true)
    expect(best.length).toBeLessThan(truecolour.length) // a flat card shrinks
    // A tiny image does not shrink (the palette adds a table): the original bytes are kept, never a bigger re-encoding.
    const tiny = new Uint8Array(
      await sharp({ create: { width: 1, height: 1, channels: 3, background: '#c33' } })
        .png()
        .toBuffer(),
    )
    expect(await encodePng(tiny, { colours: 128, dither: 0.5 })).toBe(tiny)
  })
  it.each([2, 4, 16, 128, 256])('sub-byte and byte palette depths (%i colours) pass the store validator', async (colours) => {
    const flat = new Uint8Array(
      await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c33' } })
        .png()
        .toBuffer(),
    )
    const gradient = new Uint8Array(
      await sharp({ create: { width: 301, height: 199, channels: 3, background: '#c33' } })
        .composite([{ input: Buffer.from('<svg width="301" height="199"><rect width="150" height="199" fill="#39f"/></svg>') }])
        .png()
        .toBuffer(),
    )
    for (const src of [flat, gradient]) {
      const direct = await sharp(src).png({ colours, palette: true }).toBuffer()
      expect(isCompletePng(new Uint8Array(direct)), `${colours} colours, direct palette PNG`).toBe(true)
      expect(isCompletePng(await encodePng(src, { colours, dither: 0.5 }))).toBe(true)
    }
  })
  it('refuses a bad palette and an out-of-range card size', async () => {
    expect(() => nextOgRenderer({ palette: { colours: 1, dither: 0.5 } })).toThrow(/colours/)
    expect(() => nextOgRenderer({ palette: { colours: 128, dither: Number.NaN } })).toThrow(/dither/)
    const { fonts } = await loadTestFonts()
    await expect(nextOgRenderer().render(el, { width: 5000, height: 630, fonts })).rejects.toThrow(/whole pixels/)
    await expect(nextOgRenderer().render(el, { width: 12.5, height: 630, fonts })).rejects.toThrow(/whole pixels/)
  })
  it('(g) the dev example template renders through the renderer', async () => {
    const { fonts } = await loadTestFonts()
    const ctx = {
      host: 'x.test',
      hero: null,
      fit: (text: string, box: never) => ({ size: 60, lines: 1, text, box }) as never,
      font: () => 'Inter',
    }
    const out = await nextOgRenderer().render(postCard.render({ label: 'Blog', title: 'Привет, мир', site: 'Example' }, ctx as never), {
      ...postCard.size,
      fonts,
    })
    expect(isCompletePng(out)).toBe(true)
  })
  it('the fallback template renders, and takes brand colours', async () => {
    const { fonts } = await loadTestFonts()
    const { fitText, coveringFamily } = await import('../../src/internal/fonts.js')
    const ctx = {
      host: 'x.test',
      hero: null,
      fit: (text: string, box: never) => fitText(fonts, 'Inter', text, box),
      font: (_: string, text: string) => coveringFamily(fonts, ['Inter'], text) ?? 'Inter',
    }
    for (const t of [fallbackTemplate, createFallbackTemplate({ ink: '#fff', paper: '#000' })]) {
      const out = await nextOgRenderer().render(t.render({ site: 'Example' }, ctx as never), { ...t.size, fonts })
      expect(isCompletePng(out)).toBe(true)
    }
  })
  it('a template size above the pixel cap is refused when it is defined', () => {
    expect(() => defineTemplate({ id: 'big', revision: '1', size: { width: 5000, height: 100 }, render: () => null as never })).toThrow(
      /invalid size/,
    )
  })
})

describe('payloadHeroLoader (local files)', () => {
  const loader = (dir: string, o: Record<string, unknown> = {}) => payloadHeroLoader({ staticDirs: async () => [dir], ...o })
  it('(e) a fixture JPEG in the static dir becomes a data URL cut to the box', async () => {
    const dir = await tmp()
    await writeFile(path.join(dir, 'h.jpg'), await jpeg())
    const url = await loader(dir)(hero(), BOX)
    expect(url?.startsWith('data:image/png;base64,')).toBe(true)
    const m = await meta(url as string)
    expect([m.width, m.height]).toEqual([BOX.width, BOX.height])
  })
  it('(d) a filename with traversal reads only the base name inside the static dir', async () => {
    const outer = await tmp()
    const dir = path.join(outer, 'media')
    await mkdir(dir)
    await writeFile(path.join(outer, 'secret.jpg'), await jpeg()) // outside the static dir
    expect(await loader(dir)(hero({ filename: '../secret.jpg' }), BOX)).toBeNull()
    expect(await loader(dir)(hero({ filename: '../../etc/passwd' }), BOX)).toBeNull()
    await writeFile(path.join(dir, 'secret.jpg'), await jpeg()) // the same base name inside it IS the file
    expect(await loader(dir)(hero({ filename: '../secret.jpg' }), BOX)).not.toBeNull()
    for (const filename of ['', '.', '..', undefined, 5]) expect(await loader(dir)(hero({ filename }), BOX)).toBeNull()
  })
  it('a symlink at the file name is not followed', async () => {
    const outer = await tmp()
    const dir = path.join(outer, 'media')
    await mkdir(dir)
    await writeFile(path.join(outer, 'real.jpg'), await jpeg())
    await symlink(path.join(outer, 'real.jpg'), path.join(dir, 'h.jpg'))
    expect(await loader(dir)(hero(), BOX)).toBeNull()
  })
  it('a FIFO at the file name is a null, not a hang', { timeout: 5000 }, async () => {
    const dir = await tmp()
    execFileSync('mkfifo', [path.join(dir, 'h.jpg')])
    expect(await loader(dir)(hero(), BOX)).toBeNull()
  })
  it('a file above maxBytes is not read; an image above maxPixels is not decoded', async () => {
    const dir = await tmp()
    await writeFile(path.join(dir, 'h.jpg'), await jpeg(800, 600))
    expect(await loader(dir, { maxBytes: 100 })(hero(), BOX)).toBeNull()
    expect(await loader(dir, { maxPixels: 1000 })(hero(), BOX)).toBeNull()
    expect(await loader(dir)(hero(), BOX)).not.toBeNull()
  })
  it('a non-image and an empty file are null', async () => {
    const dir = await tmp()
    await writeFile(path.join(dir, 't.jpg'), 'not an image')
    await writeFile(path.join(dir, 'e.jpg'), '')
    for (const filename of ['t.jpg', 'e.jpg', 'missing.jpg']) expect(await loader(dir)(hero({ filename }), BOX)).toBeNull()
  })
  it('an unreadable dir, a throwing staticDirs and a bad box are null, never a throw', async () => {
    const dir = await tmp()
    await writeFile(path.join(dir, 'h.jpg'), await jpeg())
    await chmod(path.join(dir, 'h.jpg'), 0o000)
    expect(await loader(dir)(hero(), BOX)).toBeNull()
    expect(await payloadHeroLoader({ staticDirs: async () => Promise.reject(new Error('no config')) })(hero(), BOX)).toBeNull()
    await chmod(path.join(dir, 'h.jpg'), 0o644)
    for (const box of [
      { width: 0, height: 10 },
      { width: 5000, height: 10 },
      { width: 1.5, height: 10 },
    ])
      expect(await loader(dir)(hero(), box)).toBeNull()
  })
  it('refuses a bad maxBytes or maxPixels at construction', () => {
    expect(() => payloadHeroLoader({ staticDirs: async () => [], maxBytes: 0 })).toThrow(/maxBytes/)
    expect(() => payloadHeroLoader({ staticDirs: async () => [], maxPixels: Number.NaN })).toThrow(/maxPixels/)
  })
})

describe('payloadHeroLoader (remote)', () => {
  const image = jpeg()
  const okFetch = () => vi.fn(async (..._a: unknown[]) => new Response(new Uint8Array(await image), { status: 200 }))
  const remote = (o: Record<string, unknown>) => payloadHeroLoader({ staticDirs: async () => [], ...o })
  it('(c) with the default allowedHosts an absolute url is never fetched', async () => {
    const fetchImpl = okFetch()
    expect(await remote({ fetchImpl })({ id: 1, url: 'https://cdn.test/a.jpg' }, BOX)).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('(f) an allowlisted host is fetched over https with a timeout and redirect: error', async () => {
    const fetchImpl = okFetch()
    const out = await remote({ fetchImpl, allowedHosts: ['cdn.test'] })({ id: 1, url: 'https://cdn.test/a.jpg' }, BOX)
    expect(out?.startsWith('data:image/png;base64,')).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://cdn.test/a.jpg')
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
  it.each([
    ['a relative url', '/a.jpg'],
    ['plain http', 'http://cdn.test/a.jpg'],
    ['a subdomain of an allowed host', 'https://x.cdn.test/a.jpg'],
    ['a trailing-dot host', 'https://cdn.test./a.jpg'],
    ['userinfo naming the allowed host', 'https://cdn.test@evil.test/a.jpg'],
    ['credentials on the allowed host', 'https://u:p@cdn.test/a.jpg'],
    ['another host', 'https://evil.test/a.jpg'],
    ['garbage', 'not a url'],
  ])('is never fetched for %s', async (_, url) => {
    const fetchImpl = okFetch()
    expect(await remote({ fetchImpl, allowedHosts: ['cdn.test'] })({ id: 1, url }, BOX)).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('a host match is case-insensitive on both sides', async () => {
    const fetchImpl = okFetch()
    await remote({ fetchImpl, allowedHosts: ['CDN.test'] })({ id: 1, url: 'https://Cdn.Test/a.jpg' }, BOX)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('an error status and a redirect error are null', async () => {
    for (const make of [
      async () => new Response('x', { status: 404 }),
      async () => Promise.reject(new TypeError('redirect mode is set to error')),
    ]) {
      expect(await remote({ fetchImpl: vi.fn(make), allowedHosts: ['cdn.test'] })({ id: 1, url: 'https://cdn.test/a.jpg' }, BOX)).toBeNull()
    }
  })
  it('an error response has its body cancelled, not left open', async () => {
    let cancelled = false
    const body = new ReadableStream({
      cancel: () => {
        cancelled = true
      },
    })
    const fetchImpl = vi.fn(async () => new Response(body, { status: 500 }))
    expect(await remote({ fetchImpl, allowedHosts: ['cdn.test'] })({ id: 1, url: 'https://cdn.test/a.jpg' }, BOX)).toBeNull()
    expect(cancelled).toBe(true)
  })
  it('a body over maxBytes is null whether it is declared or only streamed (a valid image, so only the cap can refuse it)', async () => {
    const bytes = new Uint8Array(await image)
    const cap = bytes.length - 1
    const stream = () =>
      new ReadableStream({
        start: (c) => {
          c.enqueue(bytes.subarray(0, 100))
          c.enqueue(bytes.subarray(100))
          c.close()
        },
      })
    const run = (fetchImpl: () => Promise<Response>, maxBytes: number) =>
      remote({ fetchImpl: vi.fn(fetchImpl), allowedHosts: ['cdn.test'], maxBytes })({ id: 1, url: 'https://cdn.test/a.jpg' }, BOX)
    // streamed, no content-length: only the running total can stop it
    expect(await run(async () => new Response(stream(), { status: 200 }), cap)).toBeNull()
    // declared larger than the limit: refused before reading, even though the real body would fit
    expect(
      await run(
        async () => new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length * 10) } }),
        bytes.length + 10,
      ),
    ).toBeNull()
    // control: within the limit, the same image is accepted
    expect(await run(async () => new Response(stream(), { status: 200 }), bytes.length)).not.toBeNull()
  })
})

describe('SSRF guard for remote heroes', () => {
  it.each([
    ['8.8.8.8', true],
    ['2606:4700:4700::1111', true],
    ['127.0.0.1', false],
    ['127.255.255.254', false],
    ['10.1.2.3', false],
    ['172.16.0.1', false],
    ['172.31.255.255', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['::1', false],
    ['::', false],
    ['fc00::1', false],
    ['fd12:3456::1', false],
    ['fe80::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:7f00:1', false],
    ['::ffff:8.8.8.8', false],
    ['64:ff9b::7f00:1', false],
    ['2002:7f00:1::', false],
    ['[::1]', false],
    ['64:ff9b:1::1', false],
    ['2001:10::1', false], // repo-standards: ignore IANA special-purpose or boundary address under test, not a host
    ['2001:1::2', false], // repo-standards: ignore IANA special-purpose or boundary address under test, not a host
    ['3fff::1', false], // repo-standards: ignore IANA special-purpose or boundary address under test, not a host
    ['5f00::1', false], // repo-standards: ignore IANA special-purpose or boundary address under test, not a host
    ['fec0::1', false], // repo-standards: ignore IANA special-purpose or boundary address under test, not a host
    ['100:0:0:1::1', false], // repo-standards: ignore IANA special-purpose or boundary address under test, not a host
    ['192.0.0.8', false],
    ['192.31.196.1', false], // repo-standards: ignore IANA special-purpose or boundary address under test, not a host
    ['192.52.193.1', false], // repo-standards: ignore IANA special-purpose or boundary address under test, not a host
    ['192.88.99.1', false],
    ['192.175.48.1', false], // repo-standards: ignore IANA special-purpose or boundary address under test, not a host
    ['255.255.255.255', false],
    ['198.19.255.255', false],
    ['198.20.0.1', true], // repo-standards: ignore IANA special-purpose or boundary address under test, not a host
    ['2a00:1450:4001::1', true], // repo-standards: ignore IANA special-purpose or boundary address under test, not a host
    ['not-an-ip', false],
    ['', false],
  ])('isPublicAddress(%j) is %s', (addr, ok) => expect(isPublicAddress(addr)).toBe(ok))

  const lookup = (resolveTo: Array<{ address: string; family: number }> | Error, calls: string[] = []) =>
    new Promise<{ err: Error | null; address?: unknown; family?: number }>((done) =>
      pinnedLookup(async (h) => {
        calls.push(h)
        if (resolveTo instanceof Error) throw resolveTo
        return resolveTo
      })('cdn.test', { all: false }, (err, address, family) => done({ err, address, family })),
    )
  it('pinnedLookup hands back only a vetted address, after resolving once', async () => {
    const calls: string[] = []
    const r = await lookup(
      [
        { address: '10.0.0.5', family: 4 },
        { address: '8.8.8.8', family: 4 },
      ],
      calls,
    )
    expect([r.err, r.address, r.family]).toEqual([null, '8.8.8.8', 4])
    expect(calls).toEqual(['cdn.test'])
  })
  it('pinnedLookup in `all` mode returns the vetted subset only', async () => {
    const got = await new Promise<unknown>((done) =>
      pinnedLookup(async () => [
        { address: '127.0.0.1', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ])('cdn.test', { all: true }, (_e, a) => done(a)),
    )
    expect(got).toEqual([{ address: '2606:4700:4700::1111', family: 6 }])
  })
  it.each([
    ['127.0.0.1', 4],
    ['10.0.0.9', 4],
    ['::1', 6],
    ['169.254.169.254', 4],
    ['fd00::1', 6],
  ])('pinnedLookup refuses a name that resolves only to %s', async (address, family) => {
    expect((await lookup([{ address, family }])).err?.message).toMatch(/resolves to no public address/)
  })
  it('pinnedLookup passes a resolver failure on', async () => expect((await lookup(new Error('ENOTFOUND'))).err?.message).toBe('ENOTFOUND'))

  const loaderFor = (o: Record<string, unknown>) => payloadHeroLoader({ staticDirs: async () => [], allowedHosts: ['cdn.test'], ...o })
  it.each([
    ['127.0.0.1', 4],
    ['10.20.30.40', 4],
    ['::1', 6],
  ])(
    'the default fetch is refused for an allowlisted name that resolves to %s (the resolver is asked, nothing connects)',
    async (address, family) => {
      const resolveHost = vi.fn(async () => [{ address, family }])
      expect(await loaderFor({ resolveHost })({ id: 1, url: 'https://cdn.test/a.jpg' }, BOX)).toBeNull()
      expect(resolveHost).toHaveBeenCalledWith('cdn.test')
    },
  )
  it('an IP literal is refused unless allowlisted exactly, and a private one even then; only the default port is used', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(await jpeg()), { status: 200 }))
    const run = (allowedHosts: string[], url: string) =>
      payloadHeroLoader({ staticDirs: async () => [], allowedHosts, fetchImpl })({ id: 1, url }, BOX)
    expect(await run(['cdn.test'], 'https://8.8.8.8/a.jpg')).toBeNull() // not allowlisted
    expect(await run(['127.0.0.1'], 'https://127.0.0.1/a.jpg')).toBeNull() // allowlisted but private
    expect(await run(['[::1]'], 'https://[::1]/a.jpg')).toBeNull()
    expect(await run(['cdn.test'], 'https://cdn.test:8443/a.jpg')).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await run(['8.8.8.8'], 'https://8.8.8.8/a.jpg')).not.toBeNull() // allowlisted and public
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('a hero is read only inside its own upload collection', () => {
  it("the same basename in two collections: the hero's collection wins, a miss there is a null, and no collection reads nothing", async () => {
    const [media, secret] = [await tmp(), await tmp()]
    await writeFile(path.join(media, 'h.jpg'), await jpeg(800, 600))
    await writeFile(path.join(secret, 'h.jpg'), await jpeg(300, 300)) // a private collection's file of the same name
    await writeFile(path.join(secret, 'only-private.jpg'), await jpeg())
    const dirs = vi.fn(async (c?: string) => (c === 'media' ? [media] : c === 'secret' ? [secret] : []))
    const load = payloadHeroLoader({ staticDirs: dirs })
    const own = await load(hero(), BOX, { collection: 'media' })
    expect(own).not.toBeNull()
    expect((await meta(own as string)).width).toBe(BOX.width)
    // a file that exists only in the other collection is not found through this one
    expect(await load(hero({ filename: 'only-private.jpg' }), BOX, { collection: 'media' })).toBeNull()
    expect(await load(hero(), BOX)).toBeNull() // no collection named: nothing is read
    expect(dirs).toHaveBeenCalledWith('media')
  })
})

describe('guardedFetch: its own agent, no proxy, and a failed response is a rejection', () => {
  const fakeRequest = (status: number, headers: Record<string, string> = {}) => {
    const seen: { options?: any } = {}
    const spy = vi.spyOn(https, 'request').mockImplementation(((_url: unknown, options: any, cb: (res: any) => void) => {
      seen.options = options
      const res = Object.assign(Readable.from([Buffer.from('x')]), { statusCode: status, headers })
      return { on: () => undefined, end: () => setImmediate(() => cb(res)), destroy: () => undefined } as never
    }) as never)
    return { seen, spy }
  }
  const publicHost = async () => [{ address: '8.8.8.8', family: 4 }]

  it('uses a dedicated https.Agent (never the global agent that HTTPS_PROXY / NODE_USE_ENV_PROXY would reroute) with the pinned lookup', async () => {
    vi.stubEnv('NODE_USE_ENV_PROXY', '1')
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:9')
    const { seen, spy } = fakeRequest(200)
    try {
      const res = await guardedFetch('https://cdn.test/a.jpg', {}, publicHost)
      expect(res.status).toBe(200)
      expect(seen.options.agent).toBeInstanceOf(https.Agent)
      expect(seen.options.agent).not.toBe(https.globalAgent)
      expect(typeof seen.options.lookup).toBe('function')
    } finally {
      spy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  // `http.setGlobalProxyFromEnv` exists from Node 24. Below it the process-wide proxy cannot be switched on, so the test would pass
  // having proved nothing: skip it, and say why. CI runs Node 24 (.github/workflows/preflight.yml), where it runs.
  it.skipIf(typeof (http as unknown as { setGlobalProxyFromEnv?: unknown }).setGlobalProxyFromEnv !== 'function')(
    'does not go through a proxy even when the process-wide proxy is switched on (needs Node >= 24: http.setGlobalProxyFromEnv)',
    async () => {
      const connections: string[] = []
      const proxy = net.createServer((sock) => {
        connections.push('connect')
        sock.destroy()
      })
      await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
      const { port } = proxy.address() as net.AddressInfo
      // Switch the GLOBAL agents to the env proxy at run time.
      const restore = (http as unknown as { setGlobalProxyFromEnv?: (env: Record<string, string>) => () => void }).setGlobalProxyFromEnv?.({
        HTTPS_PROXY: `http://127.0.0.1:${port}`,
      })
      try {
        const attempt = guardedFetch('https://cdn.test/a.jpg', { signal: AbortSignal.timeout(400) }, async () => [
          { address: '1.1.1.1', family: 4 },
        ])
        await attempt.then(
          (r) => r.body?.cancel(),
          () => undefined,
        )
        expect(connections).toEqual([])
      } finally {
        restore?.()
        await new Promise((r) => proxy.close(r))
      }
    },
  )

  it.each([
    ['a status outside 200-599', 600],
    ['status 99', 99],
  ])('%s is a rejected fetch, not a crash', async (_, status) => {
    const { spy } = fakeRequest(status)
    try {
      await expect(guardedFetch('https://cdn.test/a.jpg', {}, publicHost)).rejects.toThrow()
    } finally {
      spy.mockRestore()
    }
  })
  it('a redirect answer is a rejected fetch', async () => {
    const { spy } = fakeRequest(302, { location: 'https://evil.test/' })
    try {
      await expect(guardedFetch('https://cdn.test/a.jpg', {}, publicHost)).rejects.toThrow(/redirect/)
    } finally {
      spy.mockRestore()
    }
  })
  it('a header the Response cannot hold is a rejected fetch', async () => {
    const { spy } = fakeRequest(200, { 'bad header name': 'x' })
    try {
      await expect(guardedFetch('https://cdn.test/a.jpg', {}, publicHost)).rejects.toThrow()
    } finally {
      spy.mockRestore()
    }
  })
})
