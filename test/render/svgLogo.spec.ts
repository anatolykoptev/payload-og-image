/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a hostile SVG that is rendered instead of refused (a read or fetch outside the file, an unbounded render), with no error.
 * - hero.ts `decode`: `looksLikeSvg(bytes) ? rasteriseSvg(...) : bytes` -> `bytes` -> "a normal SVG logo is rasterised" RED (sharp refuses the SVG)
 * - svg.ts `rasteriseSvg`: `screenSvg(bytes)` replaced by the raw bytes -> "hostile SVGs are refused: no logo" RED (the hostile ones render)
 * - svg.ts `screenSvg`: the href / url() / DOCTYPE / entity / encoding / size checks, one at a time -> the same test RED for the case it guards
 * - hero.ts hasAlpha: `decode` dropped -> "a transparent SVG logo is reported as transparent" RED */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { Payload } from 'payload'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { heroLoaderFor } from '../../src/internal/runtime.js'
import { looksLikeSvg, rasteriseSvg, screenSvg } from '../../src/render/svg.js'

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
    for (const [i, n] of names.entries()) {
      // The screen itself refuses (so the renderer never sees it) ...
      // (a huge declared size is the renderer's to refuse: the cap is the loader's maxPixels)
      if (n !== 'not an SVG at all' && n !== 'a huge declared size') expect(screenSvg(Buffer.from(all[n] as string | Buffer)), n).toBeNull()
      // ... and so does the loader, as null (never a throw).
      expect(await load(`h${i}.svg`, { width: 120, height: 40 }), n).toBeNull()
    }
    expect(hits).toEqual([])
    server.close()
  })

  it('a <use> expansion bomb (10^11 references) is refused at once', async () => {
    let d = '<g id="l0"><rect width="1" height="1"/></g>'
    for (let i = 1; i < 12; i++) d += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`
    const bomb = Buffer.from(svg(`<defs>${d}</defs><use href="#l11"/>`, 'width="50" height="50"'))
    const t0 = Date.now()
    expect(await rasteriseSvg(bomb, { width: 50, height: 50 }, 40_000_000)).toBeNull()
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('a pixel cap bounds the render: a big but legal logo is drawn no larger than the cap', async () => {
    const big = Buffer.from(svg('<rect width="100" height="100" fill="#000"/>', 'width="4000" height="4000" viewBox="0 0 100 100"'))
    const out = await rasteriseSvg(big, { width: 4000, height: 4000 }, 40_000_000)
    const meta = await sharp(out as Buffer).metadata()
    expect((meta.width ?? 0) * (meta.height ?? 0)).toBeLessThanOrEqual(8_000_000)
    expect(meta.width).toBeGreaterThan(1000)
  })
})
