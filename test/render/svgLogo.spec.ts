/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a hostile SVG that is rendered instead of refused (a read or fetch outside the file, an unbounded render), with no error.
 * - hero.ts `decode`: raster bytes as they are, an SVG through `rasteriseSvg`, anything else null -> `bytes` -> "a normal SVG logo is rasterised", "hostile SVGs are refused" RED
 * - svg.ts `opentag`: the HOSTILE element check removed -> "hostile SVGs are refused" RED (external <image>, namespace-prefixed <image>, <feImage>)
 * - svg.ts `serialise`: the cycle check (`visiting.has(n)`) -> returns instead of refusing -> "hostile SVGs are refused: a use of its own ancestor / a mask inside itself" RED
 * - svg.ts `serialise`: the `MAX_EXPANDED` check removed -> "... a use expansion bomb (10^11 instances)" RED
 * - svg.ts `parse`: the `MAX_DEPTH` check removed -> "... nesting deeper than any logo" RED
 * - svg.ts `serialise`: the `MAX_STOPS` check removed -> "... a gradient with 300 stops" RED
 * - svg.ts `renderInWorker`: the `setTimeout` that terminates the worker removed -> "a render that outlives the worker timeout is cut off" RED
 * - svg.ts `MAX_RENDER_PIXELS` 1_000_000 -> 8_000_000 -> "memory is bounded by arithmetic ...", "a pixel cap bounds the render" RED
 * - svg.ts `serialise`: the `nested > MAX_ISOLATING` check removed, or `mask` / `clip-path` / a `use` target not counted as isolating -> "isolating groups nest at most 8 deep ..." RED
 * - svg.ts `CONCURRENT_RENDERS` 1 -> 50 -> "renders one at a time: four worst-case logos at once grow RSS like one" RED
 * - hero.ts `rasterReady`: the `svgs` lookup removed -> "an upload version is rasterised once per process ..." RED
 * - hero.ts hasAlpha: `decode` dropped -> "a transparent SVG logo is reported as transparent" RED
 * (The href / `#id` existence checks and the namespace filter are layered: a mutation of one is caught by the other, so only the layer pair is pinned, by the "hostile SVGs are refused" cases that need both.) */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { Payload } from 'payload'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { heroLoaderFor } from '../../src/internal/runtime.js'
import { looksLikeSvg } from '../../src/render/sniff.js'
import { rasteriseSvg, sanitiseSvg } from '../../src/render/svg.js'

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
const svg = (body: string, attrs = 'width="120" height="40" viewBox="0 0 120 40"') => `<svg ${NS} ${attrs}>${body}</svg>`
const LOGO = svg('<rect width="60" height="40" fill="#c00"/><circle cx="90" cy="20" r="15" fill="#06c"/>')

async function loader(files: Record<string, string | Buffer>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'og-svg-'))
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(dir, name), body)
  const payload = { collections: { media: { config: { upload: { staticDir: dir } } } } } as unknown as Payload
  const load = heroLoaderFor(payload, {})
  const hero = (name: string) => ({ id: name, filename: name, url: `/m/${name}`, updatedAt: 'u' })
  return {
    load: (name: string, box = { width: 120, height: 40 }, where: Record<string, unknown> = {}) =>
      load(hero(name), box, { collection: 'media', ...where }),
    alpha: (name: string) => load.hasAlpha?.(hero(name), { collection: 'media' }),
  }
}

const png = (url: string | null) => Buffer.from((url as string).split(',')[1] as string, 'base64')

describe('SVG logos', () => {
  it('a normal SVG logo is rasterised: the box size, the drawn colours, and an image sniff that never calls it raster', async () => {
    const { load } = await loader({
      'logo.svg': LOGO,
      'xml.svg': `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<!-- made by a tool -->\n${LOGO}`,
    })
    for (const name of ['logo.svg', 'xml.svg']) {
      const url = await load(name, { width: 240, height: 80 })
      expect(url, name).toMatch(/^data:image\/png;base64,/)
      const img = sharp(png(url))
      expect(await img.metadata()).toMatchObject({ width: 240, height: 80 })
      const { data } = await sharp(png(url)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      const [r, g, b] = [...data.subarray(10 * 3, 10 * 3 + 3)] as number[] // the red square, left (palette-cut, so a range)
      expect(r).toBeGreaterThan(150)
      expect(Math.max(g as number, b as number)).toBeLessThan(60)
    }
  })

  it('a shaped logo (contained) is prepared from the rasterised SVG', async () => {
    const { load } = await loader({ 'logo.svg': LOGO })
    const url = await load('logo.svg', { width: 100, height: 100 }, { keepAlpha: true, shape: { kind: 'contain' } })
    expect(typeof url === 'string' && url.startsWith('data:image/')).toBe(true)
  })

  it('a transparent SVG logo is reported as transparent, an opaque one is not', async () => {
    const { alpha } = await loader({ 'logo.svg': LOGO, 'solid.svg': svg('<rect width="120" height="40" fill="#000"/>') })
    expect(await alpha('logo.svg')).toBe(true)
    expect(await alpha('solid.svg')).toBe(false)
  })

  it('looksLikeSvg tells SVG text from raster bytes', async () => {
    expect(looksLikeSvg(Buffer.from(LOGO))).toBe(true)
    expect(looksLikeSvg(Buffer.from(`<?xml version="1.0"?>\n${LOGO}`))).toBe(true)
    expect(
      looksLikeSvg(
        await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
          .png()
          .toBuffer(),
      ),
    ).toBe(false)
  })
})

describe('hostile SVGs', () => {
  const hits: string[] = []
  const server = createServer((req, res) => {
    hits.push(req.url ?? '')
    res.end()
  })
  const listening = new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port)))

  const laughs = (() => {
    let e = '<!ENTITY a "aaaaaaaaaa">'
    for (let i = 1; i < 10; i++) {
      const p = String.fromCharCode(96 + i)
      e += `<!ENTITY ${String.fromCharCode(97 + i)} "${`&${p};`.repeat(10)}">`
    }
    return `<!DOCTYPE svg [${e}]>${svg('<text>&j;</text>', 'width="10" height="10"')}`
  })()

  const cases = async () => {
    const port = await listening
    const remote = `http://127.0.0.1:${port}/x.png`
    return {
      'an external <image href>': svg(`<image href="${remote}" width="10" height="10"/>`),
      'an <image> with xlink:href to a local file': svg('<image xlink:href="file:///etc/hosts" width="10" height="10"/>'),
      'an <image> with a data URL': svg('<image href="data:image/png;base64,AAAA" width="10" height="10"/>'),
      'an <image> with a namespace prefix of its own': `<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink" width="10" height="10"><s:image x:href="${remote}"/></svg>`,
      'a <use> of another document': svg(`<use xlink:href="${remote}#a"/>`),
      'a <use> of a relative file': svg('<use href="other.svg#a"/>'),
      'a <feImage>': svg(`<filter id="f"><feImage href="${remote}"/></filter><rect width="9" height="9" filter="url(#f)"/>`),
      'a CSS @import': svg(`<style>@import url("${remote}");</style><rect width="9" height="9"/>`),
      'a CSS url() to a remote font': svg(
        `<style>@font-face{font-family:x;src:url(${remote})}</style><text style="font-family:x">a</text>`,
      ),
      'a CSS url() in a style attribute': svg(`<rect width="9" height="9" style="fill:url('${remote}')"/>`),
      'a CSS url() split by a comment': svg(`<style>.a{fill:u<!-- -->rl(${remote})}</style><rect class="a" width="9" height="9"/>`),
      'a CSS url() split by CDATA': svg(
        `<style><![CDATA[.a{fill:u]]><![CDATA[rl(${remote})}]]></style><rect class="a" width="9" height="9"/>`,
      ),
      'a CSS escape spelling url': svg(`<style>.a{fill:\\75rl(${remote})}</style><rect class="a" width="9" height="9"/>`),
      'an xml:base': svg('<use href="a.svg#x"/>', 'xml:base="file:///etc/" width="9" height="9"'),
      'a <script>': svg('<script>fetch("http://127.0.0.1")</script>'),
      'a <foreignObject>': svg('<foreignObject width="9" height="9"><iframe src="http://127.0.0.1"/></foreignObject>'),
      'an external entity': `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/hosts">]>${svg('<text>&x;</text>')}`,
      'a billion-laughs entity expansion': laughs,
      'an internal DTD subset with no entity': `<!DOCTYPE svg [<!ELEMENT svg ANY>]>${LOGO}`,
      'a UTF-16 document': Buffer.from(`﻿${svg(`<image href="${remote}" width="1" height="1"/>`)}`, 'utf16le'),
      'a declared non-UTF-8 encoding': `<?xml version="1.0" encoding="ISO-8859-1"?>${LOGO}`,
      'a stylesheet processing instruction': `<?xml-stylesheet href="${remote}"?>${LOGO}`,
      'a huge viewBox': svg('<rect width="10" height="10"/>', 'viewBox="0 0 1000000000 1000000000"'),
      'a huge declared size': svg('<rect width="10" height="10"/>', 'width="100000" height="100000"'),
      'a negative size': svg('<rect width="10" height="10"/>', 'width="-5" height="10"'),
      'more elements than any logo has': svg('<g/>'.repeat(10_001)),
      'a file larger than a logo': svg(`<!-- ${'x'.repeat(1024 * 1024)} -->${LOGO.slice(0, 5)}`) + LOGO,
      'a namespace-prefixed image': `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"><x:image xmlns:x="http://www.w3.org/2000/svg" href="${remote}" width="1" height="1"/></svg>`,
      'a prefix bound to xlink by the document itself': `<svg xmlns="http://www.w3.org/2000/svg" xmlns:q="http://www.w3.org/1999/xlink" width="9" height="9"><use q:href="${remote}#a"/></svg>`,
      'a character-reference-encoded url(': svg(`<style>.a{fill:u&#114;l(${remote})}</style><rect class="a" width="9" height="9"/>`),
      'a hex-reference-encoded url(': svg(`<style>.a{fill:&#x75;rl(${remote})}</style><rect class="a" width="9" height="9"/>`),
      'a character-reference-encoded @import': svg(`<style>&#64;import url(${remote});</style><rect width="9" height="9"/>`),
      'a decoded href that is no local id': svg('<use href="#&#x2F;etc/hosts"/>'),
      'a decoded href that starts as a local id and leaves it': svg(`<use href="#a&#x3a;&#x2F;&#x2F;127.0.0.1"/>`),
      'a > inside a quoted attribute before the size': `<svg xmlns="http://www.w3.org/2000/svg" title="a>b" width="100000" height="100000"><rect width="9" height="9"/></svg>`,
      'a local reference that does not exist': svg('<rect width="9" height="9" fill="url(#nowhere)"/>'),
      'a use of its own ancestor': svg('<g id="a"><use href="#a"/></g>'),
      'a mask inside itself': svg(
        '<mask id="m"><rect width="9" height="9" mask="url(#m)"/></mask><rect width="9" height="9" mask="url(#m)"/>',
      ),
      'a pattern that fills itself (a pattern is no logo element)': svg(
        '<pattern id="p" width="3" height="3"><rect width="3" height="3" fill="url(#p)"/></pattern><rect width="9" height="9" fill="url(#p)"/>',
      ),
      'a marker that marks itself': svg('<marker id="k"><path d="M0 0L1 1" fill="url(#k)"/></marker><path d="M0 0L9 9" stroke="url(#k)"/>'),
      'nesting deeper than any logo': svg(`${'<g>'.repeat(40)}<rect width="9" height="9"/>${'</g>'.repeat(40)}`),
      'a gradient with 50k stops': svg(
        `<linearGradient id="g">${'<stop offset="0"/>'.repeat(50_000)}</linearGradient><rect width="9" height="9" fill="url(#g)"/>`,
      ),
      'a gradient with 300 stops': svg(
        `<linearGradient id="g">${'<stop offset="0"/>'.repeat(300)}</linearGradient><rect width="9" height="9" fill="url(#g)"/>`,
      ),
      'a use expansion bomb (10^11 instances)': (() => {
        let d = '<g id="l0"><rect width="1" height="1"/></g>'
        for (let i = 1; i < 12; i++) d += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`
        return svg(`<defs>${d}</defs><use href="#l11"/>`, 'width="50" height="50"')
      })(),
      'a huge stroke-width': svg('<path d="M0 0L9 9" stroke="#000" stroke-width="1e9"/>'),
      'a stroke-dasharray of dust': svg('<path d="M0 0L9 9" stroke="#000" stroke-dasharray="0.0001"/>'),
      'a huge path coordinate': svg('<path d="M0 0L1e30 1e30" stroke="#000"/>'),
      'a path with a script payload': svg('<path d="M0 0 javascript:alert(1)"/>'),
      'a duplicate id': svg('<rect id="a" width="1" height="1"/><rect id="a" width="1" height="1"/>'),
      'not an SVG at all': '<html><body>hi</body></html>',
    } as Record<string, string | Buffer>
  }

  it('hostile SVGs are refused: no logo, no crash, and nothing is fetched', async () => {
    const all = await cases()
    const files: Record<string, string | Buffer> = {}
    const names = Object.keys(all)
    names.forEach((n, i) => {
      files[`h${i}.svg`] = all[n] as string | Buffer
    })
    const { load } = await loader(files)
    // A hostile element inside a part the allowlist drops whole (a filter) is not refused: it is gone from the document the renderer sees.
    const dropped = new Set(['a <feImage>'])
    for (const [i, n] of names.entries()) {
      const clean = await sanitiseSvg(Buffer.from(all[n] as string | Buffer))
      const url = await load(`h${i}.svg`, { width: 120, height: 40 })
      if (dropped.has(n)) {
        expect(clean, n).not.toBeNull()
        expect(clean?.svg, n).not.toMatch(/127\.0\.0\.1|image|feImage|filter|href/i)
        expect(url, n).toMatch(/^data:image\/png/)
      } else {
        // Refused by the sanitiser (so no renderer ever sees it), and null from the loader: never a throw.
        expect(clean, n).toBeNull()
        expect(url, n).toBeNull()
      }
    }
    expect(hits).toEqual([])
    server.close()
  })

  it('what the allowlist drops is bounded: a filter graph bomb and huge text draw without the filter or the text, promptly', async () => {
    const blur = Array.from(
      { length: 200 },
      (_, i) => `<feGaussianBlur in="${i ? `r${i - 1}` : 'SourceGraphic'}" stdDeviation="1e5" result="r${i}"/>`,
    ).join('')
    const cases = [
      svg(`<filter id="f" x="-1e6" width="1e7">${blur}</filter><rect width="60" height="40" fill="#c00" filter="url(#f)"/>`),
      svg('<text x="0" y="30" font-size="1e9" fill="#c00">Logo</text><rect width="60" height="40" fill="#c00"/>'),
    ]
    for (const c of cases) {
      const t0 = Date.now()
      const out = await rasteriseSvg(Buffer.from(c), { width: 120, height: 40 }, 40_000_000)
      expect(out).not.toBeNull()
      expect(Date.now() - t0).toBeLessThan(5000)
      const m = await sharp(out as Buffer).metadata()
      expect(m).toMatchObject({ width: 120, height: 40 })
      const clean = (await sanitiseSvg(Buffer.from(c))) as { svg: string }
      expect(clean.svg).not.toMatch(/filter|feGaussianBlur|<text|font-size/)
    }
  })

  it('a render that outlives the worker timeout is cut off: no logo, no hang', async () => {
    const cover = { width: 120, height: 40 }
    expect(await rasteriseSvg(Buffer.from(LOGO), cover, 40_000_000)).not.toBeNull()
    const t0 = Date.now()
    expect(await rasteriseSvg(Buffer.from(LOGO), cover, 40_000_000, { timeoutMs: 1 })).toBeNull()
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('the sanitised document contains only allowlisted elements and attributes', async () => {
    const clean = (await sanitiseSvg(
      Buffer.from(
        svg(
          '<title>t</title><metadata/><g onclick="x()" data-a="1" class="k"><rect width="9" height="9" style="fill:#c00;filter:url(#f);stroke-width:2"/></g><style>.k{opacity:.5}</style>',
        ),
      ),
    )) as { svg: string }
    expect(clean.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><g opacity=".5"><rect width="9" height="9" fill="#c00" stroke-width="2"/></g></svg>',
    )
  })

  const nested = (n: number, open: (i: number) => string) =>
    svg(
      `<defs><mask id="m"><rect width="100" height="100" fill="#fff"/></mask><clipPath id="c"><circle cx="50" cy="50" r="49"/></clipPath></defs>${Array.from({ length: n }, (_, i) => open(i)).join('')}<rect width="100" height="100" fill="#f00"/>${'</g>'.repeat(n)}`,
      'width="100" height="100" viewBox="0 0 100 100"',
    )
  const opacity = (n: number) => nested(n, () => '<g opacity="0.99">')

  it('isolating groups nest at most 8 deep: 30 nested opacity groups (971 MiB of layers at 2800 x 2800) are refused, 8 are drawn', async () => {
    expect(await sanitiseSvg(Buffer.from(opacity(30)))).toBeNull()
    expect(await sanitiseSvg(Buffer.from(opacity(9)))).toBeNull()
    expect(await sanitiseSvg(Buffer.from(opacity(8)))).not.toBeNull()
    // Masks and clip paths isolate too, and a `use` of a deep group counts its depth where it is used.
    expect(await sanitiseSvg(Buffer.from(nested(9, () => '<g mask="url(#m)">')))).toBeNull()
    expect(await sanitiseSvg(Buffer.from(nested(9, () => '<g clip-path="url(#c)">')))).toBeNull()
    const deep = `<defs><g id="d">${'<g opacity=".5">'.repeat(6)}<rect width="9" height="9"/>${'</g>'.repeat(6)}</g></defs>`
    expect(
      await sanitiseSvg(Buffer.from(svg(`${deep}<g opacity=".5"><g opacity=".5"><g opacity=".5"><use href="#d"/></g></g></g>`))),
    ).toBeNull() // 3 + 6 = 9
    expect(await sanitiseSvg(Buffer.from(svg(`${deep}<g opacity=".5"><use href="#d"/></g>`)))).not.toBeNull() // 1 + 6
    expect(
      await sanitiseSvg(Buffer.from(svg('<g opacity="1"><g opacity="100%"><rect width="9" height="9" opacity="1"/></g></g>'.repeat(40)))),
    ).not.toBeNull() // opacity 1 isolates nothing
  })

  it('memory is bounded by arithmetic: the deepest allowed drawing at the pixel cap grows RSS by under 200 MiB', async () => {
    const worst = Buffer.from(opacity(8))
    const cover = { width: 4000, height: 4000 }
    await rasteriseSvg(Buffer.from(LOGO), cover, 40_000_000) // warm: the wasm module compiled, a worker started once
    const rss = () => process.memoryUsage().rss
    const before = rss()
    let peak = before
    const sampler = setInterval(() => {
      peak = Math.max(peak, rss())
    }, 2)
    const out = await rasteriseSvg(worst, cover, 40_000_000)
    clearInterval(sampler)
    peak = Math.max(peak, rss())
    const meta = await sharp(out as Buffer).metadata()
    expect((meta.width ?? 0) * (meta.height ?? 0)).toBeLessThanOrEqual(1_000_000) // the cap held ...
    expect(meta.width).toBeGreaterThan(900) // ... and the drawing really was at it
    expect((peak - before) / 1048576).toBeLessThan(200)
  })

  it('renders one at a time: four worst-case logos at once grow RSS like one (under 60 MiB against about 27 for one), and none is lost', async () => {
    const worst = Buffer.from(opacity(8))
    const cover = { width: 4000, height: 4000 }
    await rasteriseSvg(Buffer.from(LOGO), cover, 40_000_000)
    const before = process.memoryUsage().rss
    let peak = before
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss)
    }, 2)
    const outs = await Promise.all(Array.from({ length: 4 }, () => rasteriseSvg(worst, cover, 40_000_000)))
    clearInterval(sampler)
    expect(outs.every((o) => o !== null)).toBe(true)
    expect((peak - before) / 1048576).toBeLessThan(60)
  })

  it('an upload version is rasterised once per process: a repeat is answered from memory without reading the file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'og-svg-'))
    await writeFile(path.join(dir, 'logo.svg'), LOGO)
    const payload = { collections: { media: { config: { upload: { staticDir: dir } } } } } as unknown as Payload
    const load = heroLoaderFor(payload, {})
    const hero = { id: 'once', filename: 'logo.svg', url: '/m/logo.svg', updatedAt: 'v1' }
    const first = await load(hero, { width: 120, height: 40 }, { collection: 'media' })
    expect(first).toMatch(/^data:image\/png/)
    await writeFile(path.join(dir, 'logo.svg'), svg('<rect width="120" height="40" fill="#00f"/>')) // the file changes, the version does not
    expect(await load(hero, { width: 120, height: 40 }, { collection: 'media' })).toBe(first)
    // A new updatedAt is a new version: read and drawn again.
    const next = await load({ ...hero, updatedAt: 'v2' }, { width: 120, height: 40 }, { collection: 'media' })
    expect(next).not.toBe(first)
  })

  it('a pixel cap bounds the render: a big but legal logo is drawn no larger than the cap', async () => {
    const big = Buffer.from(svg('<rect width="100" height="100" fill="#000"/>', 'width="4000" height="4000" viewBox="0 0 100 100"'))
    const out = await rasteriseSvg(big, { width: 4000, height: 4000 }, 40_000_000)
    const meta = await sharp(out as Buffer).metadata()
    expect((meta.width ?? 0) * (meta.height ?? 0)).toBeLessThanOrEqual(1_000_000)
    expect(meta.width).toBeGreaterThan(900)
  })
})
