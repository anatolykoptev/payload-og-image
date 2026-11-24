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

/** Names bound in a `{ a, b: c, ...}` destructuring pattern starting at `open` (the property names; renames are returned as the property). */
function patternKeys(toks: Tok[], open: number): { keys: string[]; end: number } {
  const keys: string[] = []
  let depth = 0
  let k = open
  for (; k < toks.length; k++) {
    if (isP(toks[k], '{')) depth += 1
    else if (isP(toks[k], '}')) {
      depth -= 1
      if (depth === 0) break
    } else if (depth === 1 && isId(toks[k]) && (isP(toks[k - 1], '{') || isP(toks[k - 1], ',')) && !isP(toks[k + 1], ':'))
      keys.push((toks[k] as Tok).v)
    else if (
      depth === 1 &&
      isId(toks[k]) &&
      (isP(toks[k - 1], '{') || isP(toks[k - 1], ',')) &&
      isP(toks[k + 1], ':') &&
      isId(toks[k + 2], (toks[k] as Tok).v)
    ) {
      keys.push((toks[k] as Tok).v) // GET: GET
    }
  }
  return { keys, end: k + 1 }
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
  // names holding GET taken from a call's result: `const { GET } = createOgRoute(...)` / `= route`
  const getNames = new Set<string>()
  let exported = false
  for (let k = 0; k < toks.length; k++) {
    const isDecl = isId(toks[k], 'const') || isId(toks[k], 'let') || isId(toks[k], 'var')
    const exportedDecl = isDecl && isId(toks[k - 1], 'export')
    if (!isDecl) continue
    // const <id> = createOgRoute(...)
    if (isId(toks[k + 1]) && isP(toks[k + 2], '=') && isCall(k + 3)) routes.add((toks[k + 1] as Tok).v)
    // const { ... GET ... } = createOgRoute(...)   or   = <route>
    if (isP(toks[k + 1], '{')) {
      const { keys, end } = patternKeys(toks, k + 1)
      const rhsIsRoute =
        isP(toks[end], '=') &&
        (isCall(end + 1) || (isId(toks[end + 1]) && routes.has((toks[end + 1] as Tok).v) && !isP(toks[end + 2], '.')))
      if (rhsIsRoute && keys.includes('GET')) {
        if (exportedDecl) exported = true
        else getNames.add('GET')
      }
    }
    // export const GET = createOgRoute(...).GET   |   = <route>.GET
    if (exportedDecl && isId(toks[k + 1], 'GET') && isP(toks[k + 2], '=')) {
      if (isCall(k + 3)) {
        const e = callEnd(k + 3)
        if (e > 0 && isP(toks[e], '.') && isId(toks[e + 1], 'GET')) exported = true
      } else if (isId(toks[k + 3]) && routes.has((toks[k + 3] as Tok).v) && isP(toks[k + 4], '.') && isId(toks[k + 5], 'GET'))
        exported = true
    }
  }
  // export { GET }  where GET came out of a route
  if (!exported && getNames.has('GET')) {
    for (let k = 0; k < toks.length; k++) {
      if (!(isId(toks[k], 'export') && isP(toks[k + 1], '{'))) continue
      for (let j = k + 2; j < toks.length && !isP(toks[j], '}'); j++) {
        if (isId(toks[j], 'GET') && !isId(toks[j - 1], 'as') && !isP(toks[j + 1], ':') && !isId(toks[j + 1], 'as')) exported = true
      }
    }
  }
  return { exportsGetFromCreateOgRoute: exported }
}
