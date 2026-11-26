import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { SaxesParser as Parser, SaxesTagNS } from 'saxes'
import { MAX_SVG_BYTES } from './sniff.js'

/**
 * SVG logos, rasterised safely. An SVG is a document that can name other resources, define entities, nest and reference itself without
 * bound, and declare a size no memory holds. So nothing of the document as received reaches a renderer:
 *
 * 1. `sanitiseSvg` parses it with a namespace-aware XML parser (saxes: no DTD, no entity beyond the five predefined, so a billion-laughs
 *    document is a parse error) and serialises a NEW document from an allowlist of elements and attributes that logos need (shapes,
 *    paths, groups, gradients, clip paths, masks, `use`). Every attribute value is validated after decoding; every reference is a
 *    `#id` that exists; `<style>` and `style=` are reduced to allowlisted presentation properties; depth, element count, reference
 *    expansion and numeric magnitudes are bounded. Anything outside the allowlist is dropped, and anything that tries to leave the
 *    document (or exceeds a bound) refuses the whole file.
 * 2. `rasteriseSvg` renders the sanitised text with resvg compiled to WebAssembly (no file system, no network, no fonts) in a worker
 *    thread with a heap limit and a hard timeout, at a size capped in pixels. Anything refused or unrenderable is `null`: no logo, never
 *    a crash, never a fetch.
 */

/** Elements read from the document (kept or dropped), and elements kept. */
const MAX_PARSED = 20_000
const MAX_KEPT = 5_000
const MAX_DEPTH = 32
/** Nested isolating groups along any path of the drawing, references included. */
const MAX_ISOLATING = 8
/** Stops of one gradient, and `<use>`/reference expansion: the elements one drawing would instantiate. */
const MAX_STOPS = 256
const MAX_EXPANDED = 50_000
/**
 * The most pixels one rasterisation produces (1000 x 1000). WebAssembly memory is not capped by a worker's `resourceLimits`, so memory is bounded by
 * arithmetic: every isolating group (opacity below 1, a mask, a clip path) is a full-size layer, so render pixels x MAX_ISOLATING x 4 bytes (about 32 MB
 * of layers at the caps) is what a drawing can ask for, one render at a time.
 */
const MAX_RENDER_PIXELS = 1_000_000
/** No coordinate, size or width of a logo is beyond this. */
const MAX_COORD = 1_000_000
const MAX_STROKE = 10_000
const MAX_PATH_CHARS = 600_000
const RENDER_TIMEOUT_MS = 4000
const WORKER_LIMITS = { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }
const CONCURRENT_RENDERS = 1

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

/** Elements that run code, embed another document or load a resource: a file that has one is refused, not trimmed. */
const HOSTILE = new Set([
  'script',
  'foreignObject',
  'image',
  'feImage',
  'iframe',
  'embed',
  'object',
  'audio',
  'video',
  'animate',
  'set',
  'animateTransform',
  'animateMotion',
])
/** Kept as they are (an `a` is kept as a group). */
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const CONTAINERS = new Set(['svg', 'g', 'defs', 'symbol', 'clipPath', 'mask', 'a'])
const GRADIENTS = new Set(['linearGradient', 'radialGradient'])
const KEPT = new Set([...SHAPES, ...CONTAINERS, ...GRADIENTS, 'stop', 'use'])

type Kind =
  | 'length'
  | 'number'
  | 'colour'
  | 'paint'
  | 'ref'
  | 'url'
  | 'enum'
  | 'path'
  | 'points'
  | 'transform'
  | 'dash'
  | 'viewBox'
  | 'id'
  | 'opacity'
  | 'aspect'
const ENUMS: Record<string, readonly string[]> = {
  'fill-rule': ['nonzero', 'evenodd'],
  'clip-rule': ['nonzero', 'evenodd'],
  'stroke-linecap': ['butt', 'round', 'square'],
  'stroke-linejoin': ['miter', 'round', 'bevel', 'miter-clip', 'arcs'],
  display: ['inline', 'none', 'block'],
  visibility: ['visible', 'hidden', 'collapse'],
  gradientUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  maskUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  maskContentUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  spreadMethod: ['pad', 'reflect', 'repeat'],
}
/** Attributes kept, and how each is validated. Everything else is dropped (event handlers, `filter`, `marker-*`, `font-*`, `xml:*`, data). */
const ATTR: Record<string, Kind> = {
  id: 'id',
  d: 'path',
  points: 'points',
  transform: 'transform',
  gradientTransform: 'transform',
  x: 'length',
  y: 'length',
  width: 'length',
  height: 'length',
  cx: 'length',
  cy: 'length',
  r: 'length',
  rx: 'length',
  ry: 'length',
  x1: 'length',
  y1: 'length',
  x2: 'length',
  y2: 'length',
  fx: 'length',
  fy: 'length',
  fr: 'length',
  offset: 'length',
  fill: 'paint',
  stroke: 'paint',
  'stop-color': 'colour',
  'fill-opacity': 'opacity',
  'stroke-opacity': 'opacity',
  'stop-opacity': 'opacity',
  opacity: 'opacity',
  'stroke-width': 'length',
  'stroke-miterlimit': 'number',
  'stroke-dashoffset': 'length',
  'stroke-dasharray': 'dash',
  'clip-path': 'url',
  mask: 'url',
  href: 'ref',
  viewBox: 'viewBox',
  preserveAspectRatio: 'aspect',
  ...Object.fromEntries(Object.keys(ENUMS).map((k) => [k, 'enum' as Kind])),
}
/** Properties a `<style>` rule or `style=` may set: the presentation subset of `ATTR`. */
const CSS_PROPS = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'fill-opacity',
  'stroke-opacity',
  'stop-color',
  'stop-opacity',
  'opacity',
  'fill-rule',
  'clip-rule',
  'display',
  'visibility',
])

const NUM = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`
const NUM_RE = new RegExp(NUM, 'g')
const LENGTH = new RegExp(`^\\s*(${NUM})(px|%)?\\s*$`)
const COLOUR = /^(?:#[\da-fA-F]{3,8}|[a-zA-Z]{3,30}|(?:rgb|rgba|hsl|hsla)\(\s*[\d.\s,%/+-]*\))$/
const URL_REF = /^url\(\s*(["']?)#([A-Za-z_][\w.:-]{0,63})\1\s*\)$/
const ID = /^[A-Za-z_][\w.:-]{0,63}$/
const TRANSFORM = new RegExp(
  `^(?:\\s*(?:matrix|translate|scale|rotate|skewX|skewY)\\s*\\(\\s*${NUM}(?:\\s*[\\s,]\\s*${NUM})*\\s*\\)\\s*,?)+\\s*$`,
)
const PATH = /^[MmLlHhVvCcSsQqTtAaZz\d\s.,eE+-]*$/
const POINTS = /^[\d\s.,eE+-]*$/

const fin = (s: string) => {
  const n = Number(s)
  return Number.isFinite(n) && Math.abs(n) <= MAX_COORD
}
const numbersOk = (s: string) => (s.match(NUM_RE) ?? []).every(fin)

type Node = { name: string; attrs: Record<string, string>; children: Node[]; classes: string[]; text: string }
class Refuse extends Error {}
const refuse = (): never => {
  throw new Refuse()
}

/** A value for an attribute of this kind after decoding, or `undefined` when the attribute is dropped as unusable; throws `Refuse` for one that leaves the document. */
function value(name: string, kind: Kind, raw: string): string | undefined {
  const v = raw.trim()
  switch (kind) {
    case 'id':
      return ID.test(v) ? v : refuse()
    case 'ref': {
      if (!v.startsWith('#') || !ID.test(v.slice(1))) return refuse() // a file, a URL or a data URI: the whole document is refused
      return v
    }
    case 'url': {
      if (v === 'none') return v
      return URL_REF.test(v) ? v : refuse()
    }
    case 'paint': {
      if (/^url\(/i.test(v)) return URL_REF.test(v) ? v : refuse()
      if (/url\s*\(/i.test(v)) return refuse()
      return v === 'none' || v === 'currentColor' || COLOUR.test(v) ? v : refuse()
    }
    case 'colour':
      return v === 'currentColor' || COLOUR.test(v) ? v : refuse()
    case 'length': {
      const m = LENGTH.exec(v)
      if (!m || !fin(m[1] as string)) return refuse()
      if (name === 'stroke-width' && Math.abs(Number(m[1])) > MAX_STROKE) return refuse()
      return v
    }
    case 'number':
      return fin(v) ? v : refuse()
    case 'opacity':
      return fin(v.replace(/%$/, '')) ? v : refuse()
    case 'enum':
      return (ENUMS[name] as readonly string[]).includes(v) ? v : refuse()
    case 'path':
      return PATH.test(v) && v.length <= MAX_PATH_CHARS && numbersOk(v) ? v : refuse()
    case 'points':
      return POINTS.test(v) && v.length <= MAX_PATH_CHARS && numbersOk(v) ? v : refuse()
    case 'transform':
      return TRANSFORM.test(v) && numbersOk(v) ? v : refuse()
    case 'dash': {
      if (v === 'none') return v
      const parts = v.split(/[\s,]+/).filter(Boolean)
      // A dash pattern of dust draws millions of dashes: each must be a plain number of at least 0.05, and there are few.
      if (
        parts.length === 0 ||
        parts.length > 16 ||
        !parts.every((p) => LENGTH.test(p) && fin(p.replace(/(px|%)$/, '')) && Number.parseFloat(p) >= 0.05)
      )
        return refuse()
      return v
    }
    case 'viewBox': {
      const p = v.split(/[\s,]+/)
      const n = p.map(Number)
      return p.length === 4 &&
        n.every((x) => Number.isFinite(x) && Math.abs(x) <= MAX_COORD) &&
        (n[2] as number) > 0 &&
        (n[3] as number) > 0
        ? v
        : refuse()
    }
    case 'aspect':
      return /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(?:meet|slice))?$/.test(v) ? v : undefined
  }
}

type Rule = { sel: string; decls: [string, string][] }
const SIMPLE_SELECTOR = /^(\*|[A-Za-z][\w-]*)?(?:\.([A-Za-z_][\w-]*)|#([A-Za-z_][\w.:-]*))?$/

/** The rules of a `<style>` text that this module understands: simple type, class and id selectors, presentation properties, no at-rules, no escapes. */
function parseCss(text: string): Rule[] {
  if (text.includes('\\') || text.includes('@') || /\bexpression\b|\bimage(?:-set)?\s*\(/i.test(text)) return refuse()
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
  if (plain.includes('/*') || plain.includes('*/')) return refuse()
  const rules: Rule[] = []
  for (const block of plain.split('}')) {
    const open = block.indexOf('{')
    if (open < 0) continue
    const decls = declarations(block.slice(open + 1))
    for (const sel of block
      .slice(0, open)
      .split(',')
      .map((s) => s.trim()))
      if (SIMPLE_SELECTOR.test(sel)) rules.push({ sel, decls })
  }
  return rules
}

function declarations(text: string): [string, string][] {
  const out: [string, string][] = []
  for (const d of text.split(';')) {
    const at = d.indexOf(':')
    if (at < 0) continue
    const prop = d.slice(0, at).trim().toLowerCase()
    if (CSS_PROPS.has(prop))
      out.push([
        prop,
        d
          .slice(at + 1)
          .replace(/\s*!important\s*$/i, '')
          .trim(),
      ])
  }
  return out
}

const matches = (sel: string, n: Node) => {
  const m = SIMPLE_SELECTOR.exec(sel) as RegExpExecArray
  if (m[1] && m[1] !== '*' && m[1] !== n.name) return false
  if (m[2] && !n.classes.includes(m[2])) return false
  if (m[3] && n.attrs.id !== m[3]) return false
  return true
}

type Sanitised = { svg: string; width: number; height: number }

/**
 * The sanitised document and the size it declares, or null when the input is no SVG this module renders: not UTF-8 text, too large,
 * not well-formed (an entity or DTD subset included), or carrying anything that leaves the document or exceeds a bound.
 */
export async function sanitiseSvg(bytes: Uint8Array, maxPixels = 40_000_000): Promise<Sanitised | null> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SVG_BYTES || bytes.includes(0)) return null
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
    const { SaxesParser } = await import('saxes') // loaded when an SVG is first seen, not at start-up
    const root = parse(SaxesParser, text)
    return root && serialise(root, maxPixels)
  } catch (error) {
    if (error instanceof Refuse) return null
    return null // a parse error, a bound, anything unforeseen: no logo
  }
}

function parse(SaxesParser: typeof Parser, text: string): Node | null {
  const parser = new SaxesParser({ xmlns: true, position: false })
  let seen = 0
  let rootNode = null as Node | null
  const stack: (Node | null)[] = [] // null: inside a dropped subtree
  const css: Rule[] = []
  let styleText: string | null = null
  parser.on('error', (e) => {
    throw e
  })
  parser.on('doctype', (d) => {
    if (d.includes('[') || /<!/.test(d)) refuse() // an internal subset can declare entities
  })
  parser.on('processinginstruction', (pi) => {
    if (pi.target.toLowerCase() !== 'xml') refuse()
  })
  parser.on('xmldecl', (d) => {
    if (d.encoding && d.encoding.toLowerCase() !== 'utf-8') refuse()
  })
  parser.on('opentag', (tag: SaxesTagNS) => {
    if (++seen > MAX_PARSED || stack.length >= MAX_DEPTH) refuse()
    const parent = stack[stack.length - 1]
    if (parent === null) return void stack.push(null)
    const local = tag.uri === SVG_NS ? tag.local : ''
    if (HOSTILE.has(tag.local) && (tag.uri === SVG_NS || tag.uri === '')) refuse()
    if (stack.length === 0) {
      if (local !== 'svg') refuse()
    } else if (!KEPT.has(local)) {
      if (local === 'style') styleText = ''
      return void stack.push(null)
    }
    const name = local === 'a' ? 'g' : local
    const node: Node = { name, attrs: {}, children: [], classes: [], text: '' }
    for (const a of Object.values(tag.attributes)) {
      if (a.uri === 'http://www.w3.org/2000/xmlns/' || a.prefix === 'xmlns' || a.local === 'xmlns') continue
      if (a.uri === XLINK_NS || a.uri === 'http://www.w3.org/XML/1998/namespace') {
        if (a.uri === XLINK_NS && a.local === 'href') node.attrs.href = a.value
        else if (a.uri !== XLINK_NS && a.local === 'base') refuse()
        continue
      }
      if (a.uri !== '') continue
      if (a.local === 'class') node.classes = a.value.split(/\s+/).filter(Boolean)
      else if (a.local === 'style') node.attrs.style = a.value
      else if (Object.hasOwn(ATTR, a.local)) {
        if (a.local === 'href' && Object.hasOwn(node.attrs, 'href')) continue
        node.attrs[a.local] = a.value
      }
    }
    if (parent) parent.children.push(node)
    else rootNode = node
    stack.push(node)
  })
  const text_ = (t: string) => {
    if (styleText !== null) styleText += t
  }
  parser.on('text', text_)
  parser.on('cdata', text_)
  parser.on('closetag', (tag) => {
    const top = stack.pop()
    if (top === null && styleText !== null && tag.local === 'style') {
      css.push(...parseCss(styleText))
      styleText = null
    }
  })
  parser.write(text).close()
  if (rootNode === null) return null
  applyCss(rootNode, css)
  return rootNode
}

/** Folds `<style>` rules (in document order) and `style=` into attributes; a later source wins, `style=` last. */
function applyCss(n: Node, rules: Rule[]) {
  for (const rule of rules) if (matches(rule.sel, n)) for (const [p, v] of rule.decls) n.attrs[p] = v
  if (n.attrs.style !== undefined) {
    for (const [p, v] of declarations(n.attrs.style)) n.attrs[p] = v
    delete n.attrs.style
  }
  for (const c of n.children) applyCss(c, rules)
}

function serialise(root: Node, maxPixels: number): Sanitised | null {
  const ids = new Map<string, Node>()
  let kept = 0
  const walk = (n: Node) => {
    if (++kept > MAX_KEPT) refuse()
    const attrs: Record<string, string> = {}
    for (const [k, v] of Object.entries(n.attrs)) {
      if (!Object.hasOwn(ATTR, k)) continue
      const kind = ATTR[k] as Kind
      // `href` is only for `use` and gradients; `x`, `width` ... are kept where they are read, harmless elsewhere.
      const ok = value(k, kind, v)
      if (ok !== undefined) attrs[k] = ok
    }
    n.attrs = attrs
    if (attrs.id !== undefined) {
      if (ids.has(attrs.id)) refuse()
      ids.set(attrs.id, n)
    }
    if (n.name === 'linearGradient' || n.name === 'radialGradient')
      if (n.children.filter((c) => c.name === 'stop').length > MAX_STOPS) refuse()
    for (const c of n.children) walk(c)
  }
  walk(root)

  // Every reference exists, and the reference graph (a `use`, a gradient `href`, a paint, a clip path, a mask) has no cycle and a bounded expansion.
  const refsOf = (n: Node): string[] =>
    [
      ...(n.attrs.href === undefined ? [] : [n.attrs.href.slice(1)]),
      ...[n.attrs.fill, n.attrs.stroke, n.attrs['clip-path'], n.attrs.mask].map((v) =>
        v === undefined ? '' : (URL_REF.exec(v)?.[2] ?? ''),
      ),
    ].filter(Boolean)
  const weight = new Map<Node, number>()
  const layers = new Map<Node, number>()
  const visiting = new Set<Node>()
  const isolating = (n: Node) =>
    (n.attrs.opacity !== undefined && Number.parseFloat(n.attrs.opacity) / (n.attrs.opacity.endsWith('%') ? 100 : 1) < 1) ||
    (n.attrs.mask !== undefined && n.attrs.mask !== 'none') ||
    (n.attrs['clip-path'] !== undefined && n.attrs['clip-path'] !== 'none')
  const cost = (n: Node): number => {
    const known = weight.get(n)
    if (known !== undefined) return known
    if (visiting.has(n)) return refuse() // a cycle: a `use` of an ancestor, a mask inside itself
    visiting.add(n)
    let w = 1
    let deepest = 0
    for (const c of n.children) {
      w += cost(c)
      deepest = Math.max(deepest, layers.get(c) as number)
    }
    for (const id of refsOf(n)) {
      const target = ids.get(id)
      if (!target) return refuse()
      w += cost(target)
      deepest = Math.max(deepest, layers.get(target) as number)
    }
    if (w > MAX_EXPANDED) refuse()
    const nested = deepest + (isolating(n) ? 1 : 0)
    if (nested > MAX_ISOLATING) refuse()
    visiting.delete(n)
    weight.set(n, w)
    layers.set(n, nested)
    return w
  }
  cost(root)

  const w0 = root.attrs.width !== undefined ? LENGTH.exec(root.attrs.width) : null
  const h0 = root.attrs.height !== undefined ? LENGTH.exec(root.attrs.height) : null
  const vb = root.attrs.viewBox?.split(/[\s,]+/).map(Number)
  if ((root.attrs.width !== undefined && (!w0 || w0[2] === '%')) || (root.attrs.height !== undefined && (!h0 || h0[2] === '%'))) return null
  const width = w0 ? Number(w0[1]) : vb?.[2]
  const height = h0 ? Number(h0[1]) : vb?.[3]
  if (!width || !height || width <= 0 || height <= 0 || width * height > maxPixels) return null
  root.attrs.width = String(width)
  root.attrs.height = String(height)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  const out = (n: Node): string => {
    const attrs = Object.entries(n.attrs)
      .map(([k, v]) => ` ${k}="${esc(v)}"`)
      .join('')
    const open = n.name === 'svg' ? `<svg xmlns="${SVG_NS}"${attrs}` : `<${n.name}${attrs}`
    return n.children.length === 0 ? `${open}/>` : `${open}>${n.children.map(out).join('')}</${n.name}>`
  }
  return { svg: out(root), width, height }
}

// Where a package is looked for: next to this module (an installed package, a linked checkout), then from the working directory (a bundled
// server, where this module's own location is a build chunk). `resolve` is bound, not called on the `createRequire` result: a bundler follows
// `require.resolve(...)` calls it can see into the package.
const resolvers = () =>
  [createRequire(import.meta.url), createRequire(path.join(process.cwd(), 'noop.js'))].map((r): ((id: string) => string) =>
    r.resolve.bind(r),
  )
const locate = (id: string): string => {
  let last: unknown
  for (const resolve of resolvers()) {
    try {
      return resolve(id)
    } catch (error) {
      last = error
    }
  }
  throw last
}
// Named through a variable: a bundler (Turbopack, webpack) would otherwise follow the literal into the package and try to bundle its WebAssembly,
// which this module only reads from disk and hands to a worker.
const RESVG = ['@resvg', 'resvg-wasm'].join('/')
let wasm: Promise<WebAssembly.Module> | undefined
const compiled = () => {
  wasm ??= readFile(locate(`${RESVG}/index_bg.wasm`)).then((b) => WebAssembly.compile(b))
  wasm.catch(() => {
    wasm = undefined
  })
  return wasm
}

/** The worker's program: resvg (WebAssembly: no file system, no network) over the sanitised text, no fonts. Evaluated as text so it runs from `src` and `dist` alike. */
const WORKER = `
const { parentPort, workerData: d } = require('node:worker_threads')
const { initWasm, Resvg } = require(d.resvg)
;(async () => {
  await initWasm(d.module)
  const r = new Resvg(d.svg, { fitTo: { mode: 'width', value: d.width }, font: { loadSystemFonts: false, fontBuffers: [] } })
  const image = r.render()
  const png = image.asPng()
  image.free()
  r.free()
  parentPort.postMessage(png)
})().catch(() => parentPort.postMessage(null))
`

let running = 0
const waiting: (() => void)[] = []
async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENT_RENDERS) await new Promise<void>((r) => waiting.push(r))
  running += 1
  try {
    return await run()
  } finally {
    running -= 1
    waiting.shift()?.()
  }
}

/** Renders in a worker with a heap limit and a hard timeout; null on a timeout, a limit, a crash or an error. */
const renderInWorker = (svg: string, width: number, timeoutMs: number): Promise<Buffer | null> =>
  slot(async () => {
    const module = await compiled()
    return new Promise<Buffer | null>((resolve) => {
      const worker = new Worker(WORKER, {
        eval: true,
        resourceLimits: WORKER_LIMITS,
        workerData: { svg, width, module, resvg: locate(RESVG) },
      })
      const done = (png: Buffer | null) => {
        clearTimeout(timer)
        void worker.terminate()
        resolve(png)
      }
      const timer = setTimeout(() => done(null), timeoutMs)
      worker.once('message', (m: Uint8Array | null) => done(m ? Buffer.from(m) : null))
      worker.once('error', () => done(null))
      worker.once('exit', () => done(null))
    })
  })

/**
 * The SVG as a PNG (alpha kept), drawn at least `cover.width` x `cover.height` where the size cap allows (a vector scales up without
 * loss, so the later crop and scale start from enough pixels), or null. A declared size above `maxPixels` is refused, as a raster of that
 * size would be.
 */
export async function rasteriseSvg(
  bytes: Uint8Array,
  cover: { width: number; height: number },
  maxPixels: number,
  o: { timeoutMs?: number } = {},
): Promise<Buffer | null> {
  const clean = await sanitiseSvg(bytes, maxPixels)
  if (!clean) return null
  const wanted = Math.max(cover.width / clean.width, cover.height / clean.height)
  const scale = Math.min(wanted, Math.sqrt(MAX_RENDER_PIXELS / (clean.width * clean.height)))
  const width = Math.max(1, Math.floor(clean.width * scale))
  try {
    return await renderInWorker(clean.svg, width, o.timeoutMs ?? RENDER_TIMEOUT_MS)
  } catch {
    return null
  }
}
