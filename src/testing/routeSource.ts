/**
 * Does a Next route file export `GET` as the GET of a `createOgRoute()` call imported from `payload-og-image/next`? The file is
 * parsed with the TypeScript compiler API (syntax only, no type checking) and `GET` is resolved through the module's own
 * declarations, so a comment or a string never counts, a name declared twice is not guessed at, and an export list is read as
 * an export list. Only `createOgRoute(...)`, its `.GET`, and names that hold either are credited: any other expression
 * (`cond ? card : other`, a call of `route.GET`) is not.
 *
 * The compiler is an optional peer: the main entry never loads it, this module does so on the first call. It is looked up from
 * the project the tests run in (the working directory) first, then from this package, so a linked or workspace-symlinked copy
 * of the plugin still finds the consumer's `typescript`.
 *
 * Limits, by design: `GET` is read from the module's top-level declarations, so a `let GET = route.GET` that is reassigned
 * later is not modelled (use `const`), and `export * from` is not followed. `import * as og from 'payload-og-image/next'` with
 * `og.createOgRoute(...)` is understood.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import type * as TS from '@typescript/typescript6'

type Ts = typeof TS

/** In order of preference. TypeScript 7 ships no in-process compiler API (its main entry exports a version only), so it is skipped. */
const COMPILERS = ['typescript', '@typescript/typescript6'] as const

type Load = (id: string) => unknown

/**
 * The places a compiler is looked for, in order: the project the tests run in (`cwd`), then this package. The consumer's own
 * compiler wins: a plugin that is linked or symlinked into a workspace resolves from its real location, which may not hold the
 * project's `typescript`.
 */
export function compilerLocations(cwd: string = process.cwd()): Load[] {
  return [createRequire(path.join(cwd, 'noop.js')), createRequire(import.meta.url)]
}

/**
 * The TypeScript compiler API, from the first of `typescript` (5 or 6) or `@typescript/typescript6` that has it, looked up in each
 * location in turn (default: the working directory, then this package; a test substitutes its own). A package without the API
 * (TypeScript 7) in one location does not hide a usable one in the next. Throws an Error that says what to install when none has it.
 */
export function loadTypescript(...locations: Load[]): Ts {
  const notes: string[] = []
  for (const load of locations.length > 0 ? locations : compilerLocations()) {
    for (const id of COMPILERS) {
      let found: unknown
      try {
        found = load(id)
      } catch {
        continue
      }
      if (typeof (found as Partial<Ts> | undefined)?.createSourceFile === 'function') return found as Ts
      notes.push(
        `${id} ${String((found as { version?: unknown } | undefined)?.version ?? '')}`.trim() + ' has no compiler API (TypeScript 7)',
      )
    }
  }
  throw new Error(
    `payload-og-image/testing reads route files with the TypeScript compiler API, and none is installed${notes.length > 0 ? ` (${[...new Set(notes)].join('; ')})` : ''}. ` +
      'Add `typescript` (5 or 6) as a dev dependency or, on TypeScript 7, `@typescript/typescript6`.',
  )
}

let loaded: Ts | undefined
const defaultTs = () => {
  loaded ??= loadTypescript()
  return loaded
}

const FACTORY_MODULE = 'payload-og-image/next'
const FACTORY = 'createOgRoute'

/** What a module-level name holds. */
type Binding =
  | { kind: 'import'; from: string; imported: string; typeOnly: boolean }
  | { kind: 'namespace'; from: string; typeOnly: boolean }
  | { kind: 'variable'; node: TS.VariableDeclaration | TS.BindingElement }
  | { kind: 'other' }

/** What an expression is: the result of a `createOgRoute()` call, the GET handler of one, or neither. */
type Kind = 'route' | 'get' | undefined

export type RouteAnalysis = { exportsGetFromCreateOgRoute: boolean }

/** `fileName` picks the script kind from its extension (`.ts`, `.tsx`, `.js`, `.mjs`). */
export function analyzeRouteSource(source: string, fileName = 'route.ts', ts: Ts = defaultTs()): RouteAnalysis {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)

  // The module scope: every name a top-level statement declares. A name declared more than once is ambiguous and never credited.
  const bindings = new Map<string, Binding[]>()
  const bind = (name: string, b: Binding) => {
    const list = bindings.get(name)
    if (list) list.push(b)
    else bindings.set(name, [b])
  }
  const bindPattern = (name: TS.BindingName, owner: TS.VariableDeclaration | TS.BindingElement, top: boolean) => {
    if (ts.isIdentifier(name)) return bind(name.text, top ? { kind: 'variable', node: owner } : { kind: 'other' })
    for (const el of name.elements) if (ts.isBindingElement(el)) bindPattern(el.name, el, ts.isObjectBindingPattern(name))
  }
  const exported = (node: TS.Node) =>
    (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  for (const st of file.statements) {
    if (ts.isImportDeclaration(st)) {
      const clause = st.importClause
      const from = ts.isStringLiteralLike(st.moduleSpecifier) ? st.moduleSpecifier.text : ''
      if (clause?.name) bind(clause.name.text, { kind: 'other' })
      const named = clause?.namedBindings
      if (named && ts.isNamespaceImport(named)) bind(named.name.text, { kind: 'namespace', from, typeOnly: clause.isTypeOnly })
      else if (named)
        for (const el of named.elements)
          bind(el.name.text, {
            kind: 'import',
            from,
            imported: (el.propertyName ?? el.name).text,
            typeOnly: clause.isTypeOnly || el.isTypeOnly,
          })
    } else if (ts.isVariableStatement(st)) {
      for (const decl of st.declarationList.declarations) bindPattern(decl.name, decl, true)
    } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) {
      bind(st.name.text, { kind: 'other' })
    }
  }

  const unwrap = (e: TS.Expression): TS.Expression => {
    let cur = e
    while (
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isSatisfiesExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isTypeAssertionExpression(cur)
    )
      cur = cur.expression
    return cur
  }
  const isFactory = (name: string) => {
    const list = bindings.get(name)
    const b = list?.length === 1 ? list[0] : undefined
    return b?.kind === 'import' && !b.typeOnly && b.from === FACTORY_MODULE && b.imported === FACTORY
  }

  /** `og` in `og.createOgRoute`: a value import of the whole module. */
  const isFactoryNamespace = (name: string) => {
    const list = bindings.get(name)
    const b = list?.length === 1 ? list[0] : undefined
    return b?.kind === 'namespace' && !b.typeOnly && b.from === FACTORY_MODULE
  }
  const isFactoryCallee = (callee: TS.Expression): boolean => {
    const c = unwrap(callee)
    if (ts.isIdentifier(c)) return isFactory(c.text)
    return (
      ts.isPropertyAccessExpression(c) && c.name.text === FACTORY && ts.isIdentifier(c.expression) && isFactoryNamespace(c.expression.text)
    )
  }

  const memo = new Map<TS.Node, Kind>()
  const classify = (expr: TS.Expression): Kind => {
    const e = unwrap(expr)
    if (ts.isCallExpression(e)) return isFactoryCallee(e.expression) ? 'route' : undefined
    if (ts.isPropertyAccessExpression(e)) return e.name.text === 'GET' && classify(e.expression) === 'route' ? 'get' : undefined
    if (ts.isElementAccessExpression(e))
      return ts.isStringLiteralLike(e.argumentExpression) && e.argumentExpression.text === 'GET' && classify(e.expression) === 'route'
        ? 'get'
        : undefined
    return ts.isIdentifier(e) ? classifyName(e.text) : undefined
  }
  const classifyName = (name: string): Kind => {
    const list = bindings.get(name)
    const b = list?.length === 1 ? list[0] : undefined
    return b?.kind === 'variable' ? classifyDeclaration(b.node) : undefined
  }
  const classifyDeclaration = (node: TS.VariableDeclaration | TS.BindingElement): Kind => {
    if (memo.has(node)) return memo.get(node)
    memo.set(node, undefined) // a name defined through itself is nothing
    let kind: Kind
    if (ts.isVariableDeclaration(node)) {
      // No initialiser (`declare const GET: Handler`, `let GET: Handler`): nothing is held.
      kind = node.initializer ? classify(node.initializer) : undefined
    } else {
      // `const { GET } = <route>` / `const { GET: card } = <route>`: one level of an object pattern, no default, no rest.
      const decl = node.parent.parent
      const key = node.propertyName ?? node.name
      if (
        ts.isObjectBindingPattern(node.parent) &&
        ts.isVariableDeclaration(decl) &&
        decl.initializer &&
        !node.initializer &&
        !node.dotDotDotToken &&
        (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) &&
        key.text === 'GET' &&
        classify(decl.initializer) === 'route'
      )
        kind = 'get'
    }
    memo.set(node, kind)
    return kind
  }

  const holdsGet = (local: string) => classifyName(local) === 'get'
  let exportsGet = false
  for (const st of file.statements) {
    if (ts.isVariableStatement(st) && exported(st)) {
      // `export const A = x, GET = y`, `export const { GET } = route`: every binding is an export under its own name.
      for (const decl of st.declarationList.declarations) {
        const names: string[] = []
        const collect = (n: TS.BindingName) => {
          if (ts.isIdentifier(n)) names.push(n.text)
          else for (const el of n.elements) if (ts.isBindingElement(el)) collect(el.name)
        }
        collect(decl.name)
        if (names.includes('GET') && holdsGet('GET')) exportsGet = true
      }
    } else if (
      ts.isExportDeclaration(st) &&
      !st.moduleSpecifier &&
      !st.isTypeOnly &&
      st.exportClause &&
      ts.isNamedExports(st.exportClause)
    ) {
      // `export { GET }`, `export { handler as GET }`; `export { GET } from './x'` has a specifier and is another module's.
      for (const el of st.exportClause.elements)
        if (!el.isTypeOnly && el.name.text === 'GET' && holdsGet((el.propertyName ?? el.name).text)) exportsGet = true
    }
  }
  return { exportsGetFromCreateOgRoute: exportsGet }
}
