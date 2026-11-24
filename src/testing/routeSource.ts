/**
 * A small tokenizer and structural matcher for a Next route file: does it export `GET` as the value of a `createOgRoute()` call
 * imported from `payload-og-image/next`? Comments and strings are tokens of their own, so a mention in either never counts, and
 * `export const GET = () => ...` next to an unused `createOgRoute()` call does not either. It is not a full parser: it
 * recognises the shapes a card route is written in.
 */

type Tok = { t: 'id' | 'str' | 'tpl' | 'p'; v: string }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const n = src.length
  const skipTemplate = () => {
    // at the opening backtick; leaves i after the closing one, skipping `${ ... }` (which may nest strings and templates)
    i += 1
    while (i < n) {
      const c = src[i]
      if (c === '\\') i += 2
      else if (c === '`') {
        i += 1
        return
      } else if (c === '$' && src[i + 1] === '{') {
        i += 2
        let depth = 1
        while (i < n && depth > 0) {
          const d = src[i]
          if (d === '`') skipTemplate()
          else if (d === '"' || d === "'") skipString(d)
          else {
            if (d === '{') depth += 1
            else if (d === '}') depth -= 1
            i += 1
          }
        }
      } else i += 1
    }
  }
  const skipString = (quote: string) => {
    i += 1
    let value = ''
    while (i < n && src[i] !== quote) {
      if (src[i] === '\\') i += 1
      value += src[i] ?? ''
      i += 1
    }
    i += 1
    return value
  }
  while (i < n) {
    const c = src[i] as string
    if (/\s/.test(c)) i += 1
    else if (c === '/' && src[i + 1] === '/') while (i < n && src[i] !== '\n') i += 1
    else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
    } else if (c === '"' || c === "'") toks.push({ t: 'str', v: skipString(c) })
    else if (c === '`') {
      skipTemplate()
      toks.push({ t: 'tpl', v: '' })
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1
      while (j < n && /[\w$]/.test(src[j] as string)) j += 1
      toks.push({ t: 'id', v: src.slice(i, j) })
      i = j
    } else {
      toks.push({ t: 'p', v: c })
      i += 1
    }
  }
  return toks
}

const isP = (t: Tok | undefined, v: string) => t?.t === 'p' && t.v === v
const isId = (t: Tok | undefined, v?: string) => t?.t === 'id' && (v === undefined || t.v === v)

/** Index of the token after the `)` that closes the `(` at `open`. */
function afterParen(toks: Tok[], open: number): number {
  let depth = 0
  for (let k = open; k < toks.length; k++) {
    if (isP(toks[k], '(')) depth += 1
    else if (isP(toks[k], ')') && --depth === 0) return k + 1
  }
  return -1
}

/** One entry of a `{ a, b: c, ...}` destructuring pattern starting at `open`: the property read and the local name it binds. */
type PatternEntry = { key: string; local: string }

function patternEntries(toks: Tok[], open: number): { entries: PatternEntry[]; end: number } {
  const entries: PatternEntry[] = []
  let depth = 0
  let k = open
  for (; k < toks.length; k++) {
    if (isP(toks[k], '{')) depth += 1
    else if (isP(toks[k], '}')) {
      depth -= 1
      if (depth === 0) break
    } else if (depth === 1 && isId(toks[k]) && (isP(toks[k - 1], '{') || isP(toks[k - 1], ','))) {
      const key = (toks[k] as Tok).v
      if (!isP(toks[k + 1], ':'))
        entries.push({ key, local: key }) // GET
      else if (isId(toks[k + 2])) entries.push({ key, local: (toks[k + 2] as Tok).v }) // GET: handler
    }
  }
  return { entries, end: k + 1 }
}

/**
 * The index of the `=` of a declaration whose binding ends at `k`, stepping over a type annotation (`const GET: Handler = ...`,
 * `const { GET }: { GET: Handler } = ...`). The `=` of an arrow type (`=>`) is not the assignment. -1: no initialiser.
 */
function assignAt(toks: Tok[], k: number): number {
  if (isP(toks[k], '=')) return isP(toks[k + 1], '=') || isP(toks[k + 1], '>') ? -1 : k
  if (!isP(toks[k], ':')) return -1
  let depth = 0
  for (let j = k + 1; j < toks.length; j++) {
    const t = toks[j]
    if (isP(t, '(') || isP(t, '[') || isP(t, '{') || isP(t, '<')) depth += 1
    else if (isP(t, ')') || isP(t, ']') || isP(t, '}') || isP(t, '>')) depth -= 1
    else if (isP(t, '=') && isP(toks[j + 1], '>'))
      j += 1 // an arrow type
    else if (isP(t, '=') && depth === 0) return j
    else if (isP(t, ';') && depth <= 0) return -1
    if (depth < 0) return -1
  }
  return -1
}

export type RouteAnalysis = { exportsGetFromCreateOgRoute: boolean }

export function analyzeRouteSource(source: string): RouteAnalysis {
  const toks = tokenize(source)
  // import { createOgRoute [as x] } from 'payload-og-image/next'
  const locals = new Set<string>()
  for (let k = 0; k < toks.length; k++) {
    if (!isId(toks[k], 'import') || !isP(toks[k + 1], '{')) continue
    let j = k + 2
    const names: string[] = []
    for (; j < toks.length && !isP(toks[j], '}'); j++) {
      if (isId(toks[j], 'createOgRoute'))
        names.push(isId(toks[j + 1], 'as') && isId(toks[j + 2]) ? (toks[j + 2] as Tok).v : 'createOgRoute')
    }
    if (isId(toks[j + 1], 'from') && toks[j + 2]?.t === 'str' && toks[j + 2]?.v === 'payload-og-image/next')
      for (const nme of names) locals.add(nme)
  }
  if (locals.size === 0) return { exportsGetFromCreateOgRoute: false }

  const isCall = (k: number) => isId(toks[k]) && locals.has((toks[k] as Tok).v) && isP(toks[k + 1], '(')
  const callEnd = (k: number) => afterParen(toks, k + 1)

  // names holding the result of a call: `const route = createOgRoute(...)`
  const routes = new Set<string>()
  // local names holding GET taken from a call's result: `const { GET } = createOgRoute(...)`, `const handler = route.GET`
  const getNames = new Set<string>()

  /** What the expression at `r` is: a createOgRoute() result, its GET, or neither. */
  const valueAt = (r: number): 'route' | 'get' | undefined => {
    if (isCall(r)) {
      const e = callEnd(r)
      if (e > 0 && isP(toks[e], '.') && isId(toks[e + 1], 'GET') && !isP(toks[e + 2], '.') && !isP(toks[e + 2], '(')) return 'get'
      return e > 0 && isP(toks[e], '.') ? undefined : 'route'
    }
    if (!isId(toks[r])) return undefined
    const name = (toks[r] as Tok).v
    if (routes.has(name)) {
      if (!isP(toks[r + 1], '.')) return 'route'
      return isId(toks[r + 2], 'GET') && !isP(toks[r + 3], '.') && !isP(toks[r + 3], '(') ? 'get' : undefined
    }
    return getNames.has(name) && !isP(toks[r + 1], '.') && !isP(toks[r + 1], '(') ? 'get' : undefined
  }

  let exported = false
  for (let k = 0; k < toks.length; k++) {
    const isDecl = isId(toks[k], 'const') || isId(toks[k], 'let') || isId(toks[k], 'var')
    if (!isDecl) continue
    const exportedDecl = isId(toks[k - 1], 'export')
    if (isP(toks[k + 1], '{')) {
      // const { ... GET ... } [: T] = createOgRoute(...)   or   = <route>
      const { entries, end } = patternEntries(toks, k + 1)
      const eq = assignAt(toks, end)
      if (eq < 0 || valueAt(eq + 1) !== 'route') continue
      for (const e of entries) {
        if (e.key !== 'GET') continue
        if (exportedDecl && e.local === 'GET') exported = true
        else getNames.add(e.local)
      }
    } else if (isId(toks[k + 1])) {
      // const <id> [: T] = createOgRoute(...)   |   = createOgRoute(...).GET   |   = <route>.GET   |   = <a name holding GET>
      const name = (toks[k + 1] as Tok).v
      const eq = assignAt(toks, k + 2)
      if (eq < 0) continue
      const kind = valueAt(eq + 1)
      if (kind === 'route') routes.add(name)
      else if (kind === 'get') {
        if (exportedDecl && name === 'GET') exported = true
        else getNames.add(name)
      }
    }
  }
  // export { GET }  /  export { handler as GET }  where the local name holds a route's GET (not `export { x } from '...'`)
  if (!exported) {
    for (let k = 0; k < toks.length && !exported; k++) {
      if (!(isId(toks[k], 'export') && isP(toks[k + 1], '{'))) continue
      let j = k + 2
      for (; j < toks.length && !isP(toks[j], '}'); j++) {
        if (!isId(toks[j]) || !(isP(toks[j - 1], '{') || isP(toks[j - 1], ','))) continue
        const local = (toks[j] as Tok).v
        const as = isId(toks[j + 1], 'as') && isId(toks[j + 2]) ? (toks[j + 2] as Tok).v : local
        if (as === 'GET' && getNames.has(local)) exported = !isId(toks[afterBrace(toks, j)], 'from')
      }
    }
  }
  return { exportsGetFromCreateOgRoute: exported }
}

/** Index of the token after the `}` that closes the export list `j` is inside. */
function afterBrace(toks: Tok[], j: number): number {
  let k = j
  while (k < toks.length && !isP(toks[k], '}')) k += 1
  return k + 1
}
