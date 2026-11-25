/** Mutation table (production line -> the test that goes RED). A route file is a card route only if it exports the GET of a createOgRoute() call from payload-og-image/next; the file is parsed with the TypeScript compiler API.
 * - routeSource.ts:141 accept createOgRoute imported from any module -> "createOgRoute imported from another module" RED
 * - routeSource.ts:213 check only the first binding of an export statement -> "every binding of one export statement is checked, not the first" RED
 * - routeSource.ts:167 credit a conditional expression as its first branch -> "a compound expression that mentions a card alias" RED
 * - routeSource.ts:224 accept `export { GET } from './x'` as a route export -> "a GET re-exported from another module" RED
 * - routeSource.ts:171 the first of two declarations of a name wins -> "a name declared twice is not guessed at" RED
 * - routeSource.ts:171 the LAST of two declarations of a name wins -> "a name declared twice, the card GET last" RED
 * - routeSource.ts:148 ignore a namespace import (`og.createOgRoute`) -> "a namespace import" and "... called in place" RED
 * - routeSource.ts:44  try only the first location (the project's) -> "falls back to the plugin own typescript when the project has none" and "a compiler-less typescript (7) in the project does not hide a usable one in the plugin" RED
 * - routeSource.ts:51  drop the `notes.push` of a failed require -> "the final error keeps the real require error of every skipped location" RED
 * - routeSource.ts:33  look in the plugin before the project's working directory -> "takes the typescript of the working directory over the plugin own" RED
 * - routeSource.ts:54  accept a module without createSourceFile (TypeScript 7) -> every card-route test and the loader tests RED
 * - routeSource.ts:23  never try @typescript/typescript6 -> the same tests RED
 * - exports.spec.ts: a static `import ... from 'typescript'` in routeSource.ts -> "no entry imports the TypeScript compiler" RED
 * - The old hand-rolled scanner (origin/main) fails "a helper and the module both declare `handler`", "an uninitialised typed `let GET`", "a logical expression over the card alias" and "every binding of one export statement".  */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeRouteSource, compilerLocations, loadTypescript } from '../../src/testing/routeSource.js'

const IMPORT = "import { createOgRoute } from 'payload-og-image/next'\n"
const yes = (src: string) => expect(analyzeRouteSource(src).exportsGetFromCreateOgRoute).toBe(true)
const no = (src: string) => expect(analyzeRouteSource(src).exportsGetFromCreateOgRoute).toBe(false)

describe('analyzeRouteSource: shapes that ARE a card route', () => {
  it.each([
    [
      'export const GET = route.GET',
      `${IMPORT}const route = createOgRoute({ config })\nexport const GET = route.GET\nexport const HEAD = GET\n`,
    ],
    ['a direct member of the call', `${IMPORT}export const GET = createOgRoute({ config, target: 'posts' }).GET\n`],
    ['a destructured export', `${IMPORT}export const { GET, HEAD } = createOgRoute({ config })\n`],
    ['a destructured const exported by name', `${IMPORT}const { GET } = createOgRoute({ config })\nexport { GET }\n`],
    ['a destructured export of a route variable', `${IMPORT}const route = createOgRoute({ config })\nexport const { GET } = route\n`],
    ['GET: GET', `${IMPORT}export const { GET: GET } = createOgRoute({ config })\n`],
    ['an import alias', "import { createOgRoute as og } from 'payload-og-image/next'\nexport const GET = og({ config }).GET\n"],
    [
      'nested parentheses and a template in the arguments',
      `${IMPORT}export const GET = createOgRoute({ config: load(\`a\${(1)}\`), target: ('p') }).GET\n`,
    ],
    ['a double-quoted import', 'import { createOgRoute } from "payload-og-image/next"\nexport const GET = createOgRoute({ config }).GET\n'],
    [
      'a type-annotated destructured export',
      `${IMPORT}export const { GET, HEAD }: { GET: unknown; HEAD: unknown } = createOgRoute({ config })\n`,
    ],
    [
      'a type-annotated destructure of a route variable, exported by name',
      `${IMPORT}const route = createOgRoute({ config })\nconst { GET }: Pick<typeof route, 'GET'> = route\nexport { GET }\n`,
    ],
    [
      'a type-annotated GET with an arrow type',
      `${IMPORT}const route = createOgRoute({ config })\nexport const GET: (r: Request, c: RouteContext) => Promise<Response> = route.GET\n`,
    ],
    ['a type-annotated GET taken from the call', `${IMPORT}export const GET: Handler<(a: A) => B> = createOgRoute({ config }).GET\n`],
    [
      'a type-annotated route variable',
      `${IMPORT}const route: ReturnType<typeof createOgRoute> = createOgRoute({ config })\nexport const GET = route.GET\n`,
    ],
    ['a GET constant exported by name', `${IMPORT}const route = createOgRoute({ config })\nconst GET = route.GET\nexport { GET }\n`],
    ['GET also exported as HEAD', `${IMPORT}const { GET } = createOgRoute({ config })\nexport { GET, GET as HEAD }\n`],
    [
      'a handler exported under the name GET',
      `${IMPORT}const route = createOgRoute({ config })\nconst handler = route.GET\nexport { handler as GET }\n`,
    ],
    ['a destructured rename exported as GET', `${IMPORT}const { GET: card } = createOgRoute({ config })\nexport { card as GET }\n`],
    [
      'a handler constant re-exported as a GET declaration',
      `${IMPORT}const route = createOgRoute({ config })\nconst handler = route.GET\nexport const GET = handler\n`,
    ],
    [
      'every binding of one export statement is checked, not the first (HEAD before GET)',
      `${IMPORT}const cardGet = createOgRoute({ config }).GET\nexport const HEAD = cardGet, GET = cardGet\n`,
    ],
    [
      'a typed route variable and an `as` cast around the call',
      `${IMPORT}const route = createOgRoute({ config }) as ReturnType<typeof createOgRoute>\nexport const GET = (route.GET)!\n`,
    ],
    ['GET read with a string key', `${IMPORT}export const GET = createOgRoute({ config })['GET']\n`],
    [
      'a namespace import',
      "import * as og from 'payload-og-image/next'\nconst route = og.createOgRoute({ config })\nexport const GET = route.GET\n",
    ],
    [
      'a namespace import called in place',
      "import * as og from 'payload-og-image/next'\nexport const { GET } = og.createOgRoute({ config })\n",
    ],
  ])('%s', (_, src) => yes(src))
})

describe('analyzeRouteSource: shapes that are NOT', () => {
  it.each([
    [
      'createOgRoute only in a comment',
      `${IMPORT}// export const GET = createOgRoute({ config }).GET\nexport const GET = () => new Response()\n`,
    ],
    [
      'createOgRoute only in a block comment',
      `${IMPORT}/* export const GET = createOgRoute({ config }).GET */\nexport const POST = () => new Response()\n`,
    ],
    [
      'the whole route inside a string',
      `export const GET = () => new Response("import { createOgRoute } from 'payload-og-image/next'; export const GET = createOgRoute({}).GET")\n`,
    ],
    [
      'the whole route inside a template',
      `${IMPORT}export const GET = () => new Response(\`export const GET = createOgRoute({ config }).GET\`)\n`,
    ],
    [
      'an unused call next to a hand-written GET',
      `${IMPORT}const unused = createOgRoute({ config })\nexport const GET = () => new Response('x')\nexport const POST = unused.GET\n`,
    ],
    [
      'GET taken from something else',
      `${IMPORT}const route = createOgRoute({ config })\nconst other = { GET: () => new Response() }\nexport const GET = other.GET\n`,
    ],
    ['another member of the call result as GET', `${IMPORT}export const GET = createOgRoute({ config }).HEAD\n`],
    [
      'an escaped backtick does not end a template that quotes a route',
      `${IMPORT}export const X = \`a \\\` export const GET = createOgRoute({ config }).GET \`\n`,
    ],
    [
      'a destructured GET that is never exported',
      `${IMPORT}const { GET } = createOgRoute({ config })\nexport const POST = () => new Response()\n`,
    ],
    ['a destructured GET exported under another name', `${IMPORT}const { GET } = createOgRoute({ config })\nexport { GET as POST }\n`],
    ['route.GET exported under another name', `${IMPORT}const route = createOgRoute({ config })\nexport const POST = route.GET\n`],
    ['the call result not exported at all', `${IMPORT}const route = createOgRoute({ config })\nroute.GET\n`],
    [
      'createOgRoute imported from another module',
      "import { createOgRoute } from './my-og'\nexport const GET = createOgRoute({ config }).GET\n",
    ],
    ['no import at all', 'export const GET = createOgRoute({ config }).GET\n'],
    ['a destructure without GET', `${IMPORT}export const { HEAD } = createOgRoute({ config })\n`],
    [
      'an export list naming a GET that is not from the route',
      `${IMPORT}const route = createOgRoute({ config })\nconst GET = () => new Response()\nexport { GET }\n`,
    ],
    [
      'a type-annotated GET taken from something else',
      `${IMPORT}const other = { GET: () => new Response() }\nexport const GET: Handler = other.GET\n`,
    ],
    [
      'a type-annotated destructure that is never exported',
      `${IMPORT}const { GET }: Handlers = createOgRoute({ config })\nexport const POST = () => new Response()\n`,
    ],
    [
      'a type annotation that never reaches an initialiser',
      `${IMPORT}declare const GET: Handler\nexport { GET }\nconst route = createOgRoute({ config })\n`,
    ],
    [
      'a hand-written handler exported as GET',
      `${IMPORT}const route = createOgRoute({ config })\nconst handler = () => new Response()\nexport { handler as GET }\nexport const POST = route.GET\n`,
    ],
    ['a route GET exported under another name', `${IMPORT}const { GET } = createOgRoute({ config })\nexport { GET as HEAD }\n`],
    [
      'a GET re-exported from another module',
      `${IMPORT}const { GET } = createOgRoute({ config })\nexport { GET } from './elsewhere'\nexport const POST = () => GET\n`,
    ],
    ['the result of calling route.GET', `${IMPORT}const route = createOgRoute({ config })\nexport const GET = route.GET()\n`],
    ['an empty file', ''],
    [
      'a helper and the module both declare `handler`: the exported one is the hand-written one (shadowing)',
      `${IMPORT}const route = createOgRoute({ config })\nfunction helper() {\n  const handler = route.GET\n  return handler\n}\nconst handler = () => new Response()\nexport { handler as GET }\nexport const POST = helper\n`,
    ],
    [
      'a name declared by a function parameter is not the module one',
      `${IMPORT}const route = createOgRoute({ config })\nconst use = (handler: unknown) => handler\nuse(route.GET)\nexport const GET = (handler: unknown) => handler\n`,
    ],
    [
      'an uninitialised typed GET with no semicolon does not borrow the next declaration',
      `${IMPORT}declare const GET: Handler\nconst route = createOgRoute({ config })\nexport { GET }\n`,
    ],
    [
      'an uninitialised typed `let GET` before the route call',
      `${IMPORT}let GET: Handler\nconst route = createOgRoute({ config }).GET\nexport { GET }\n`,
    ],
    [
      'a compound expression that mentions a card alias',
      `${IMPORT}const cardGet = createOgRoute({ config }).GET\nexport const GET = process.env.X ? cardGet : () => new Response()\n`,
    ],
    [
      'a logical expression over the card alias',
      `${IMPORT}const cardGet = createOgRoute({ config }).GET\nexport const GET = cardGet ?? other\n`,
    ],
    ['a wrapper call around the card alias', `${IMPORT}const cardGet = createOgRoute({ config }).GET\nexport const GET = wrap(cardGet)\n`],
    [
      'a GET with a default in the pattern may be the default',
      `${IMPORT}const route = createOgRoute({ config })\nexport const { GET = () => new Response() } = route\n`,
    ],
    [
      'createOgRoute imported as a type only',
      "import type { createOgRoute } from 'payload-og-image/next'\nexport const GET = createOgRoute({ config }).GET\n",
    ],
    [
      'a name declared twice is not guessed at',
      `${IMPORT}const route = createOgRoute({ config })\nvar GET = route.GET\nvar GET = () => new Response()\nexport { GET }\n`,
    ],
    [
      'a name declared twice, the card GET last (the first declaration is not the route one either)',
      `${IMPORT}const route = createOgRoute({ config })\nvar GET = () => new Response()\nvar GET = route.GET\nexport { GET }\n`,
    ],
    ['a namespace import of another module', "import * as og from 'other-lib'\nexport const GET = og.createOgRoute({ config }).GET\n"],
    [
      'a namespace import used for another member',
      "import * as og from 'payload-og-image/next'\nexport const GET = og.withHead(() => new Response())\n",
    ],
    [
      'a type-only namespace import',
      "import type * as og from 'payload-og-image/next'\nexport const GET = og.createOgRoute({ config }).GET\n",
    ],
    [
      'a namespace name that is declared again',
      "import * as og from 'payload-og-image/next'\nvar og = { createOgRoute: () => ({ GET: () => new Response() }) }\nexport const GET = og.createOgRoute({ config }).GET\n",
    ],
    ['a name defined through itself', `${IMPORT}const a = b\nconst b = a\nexport { a as GET }\n`],
    [
      'GET re-exported from another module next to a route GET export under another name',
      `${IMPORT}const cardGet = createOgRoute({ config }).GET\nexport { cardGet as HEAD }\nexport { GET } from './elsewhere'\n`,
    ],
  ])('%s', (_, src) => no(src))
})

describe('loadTypescript', () => {
  const real = { createSourceFile: () => ({}), version: '6.0.2' }
  const missing = (id: string): never => {
    throw Object.assign(new Error(`Cannot find module '${id}'`), { code: 'MODULE_NOT_FOUND' })
  }
  it('takes typescript when it has the compiler API', () => {
    expect(loadTypescript((id) => (id === 'typescript' ? real : missing(id)))).toBe(real)
  })
  it('skips a typescript without the compiler API (TypeScript 7) for @typescript/typescript6', () => {
    const seven = { version: '7.0.2' }
    const six = { ...real }
    expect(loadTypescript((id) => (id === 'typescript' ? seven : six))).toBe(six)
  })
  it('falls back to @typescript/typescript6 when typescript is not installed', () => {
    expect(loadTypescript((id) => (id === 'typescript' ? missing(id) : real))).toBe(real)
  })
  it('says what to install when neither is usable', () => {
    expect(() => loadTypescript(missing)).toThrow(/TypeScript compiler API.*`typescript`.*`@typescript\/typescript6`/s)
    expect(() => loadTypescript((id) => (id === 'typescript' ? { version: '7.0.2' } : missing(id)))).toThrow(
      /typescript 7\.0\.2 has no compiler API/,
    )
  })
  it('the final error keeps the real require error of every skipped location', () => {
    const broken = (id: string): never => {
      throw new Error(`Cannot find module '${id}/lib/typescript.js'\nRequire stack:\n- /x`)
    }
    expect(() => loadTypescript(broken, missing)).toThrow(/typescript: Cannot find module 'typescript\/lib\/typescript\.js'/)
    expect(() => loadTypescript(broken, missing)).toThrow(
      /@typescript\/typescript6: Cannot find module '@typescript\/typescript6\/lib\/typescript\.js'/,
    )
    expect(() => loadTypescript(missing)).toThrow(/typescript: Cannot find module 'typescript'/)
    expect(() => loadTypescript(broken)).not.toThrow(/Require stack/)
  })
  it('the default loader finds a compiler in this repository', () => {
    expect(typeof loadTypescript().createSourceFile).toBe('function')
  })
})

describe('loadTypescript: the project the tests run in comes before the plugin', () => {
  const real = { createSourceFile: () => ({}), version: '6.0.2' }
  const missingFrom = (id: string): never => {
    throw Object.assign(new Error(`Cannot find module '${id}'`), { code: 'MODULE_NOT_FOUND' })
  }
  const dirs: string[] = []
  /** A project with its own fake `typescript` (a CommonJS module that carries a marker), or none. */
  const project = (withTypescript: boolean) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'og-ts-'))
    dirs.push(dir)
    if (withTypescript) {
      const pkg = path.join(dir, 'node_modules', 'typescript')
      mkdirSync(pkg, { recursive: true })
      writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'typescript', version: '0.0.0-project', main: 'index.js' }))
      writeFileSync(path.join(pkg, 'index.js'), "exports.createSourceFile = () => ({})\nexports.marker = 'the project'\n")
    }
    return dir
  }
  afterEach(() => {
    vi.restoreAllMocks()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('takes the typescript of the working directory over the plugin own', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(project(true))
    expect((loadTypescript() as unknown as { marker?: string }).marker).toBe('the project')
  })
  it('falls back to the plugin own typescript when the project has none', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(project(false))
    const ts = loadTypescript() as unknown as { marker?: string; createSourceFile: unknown }
    expect(ts.marker).toBeUndefined()
    expect(typeof ts.createSourceFile).toBe('function')
  })
  it('a compiler-less typescript (7) in the project does not hide a usable one in the plugin', () => {
    const project7 = (id: string) => (id === 'typescript' ? { version: '7.0.2' } : missingFrom(id))
    const plugin6 = (id: string) => (id === 'typescript' ? real : missingFrom(id))
    expect(loadTypescript(project7, plugin6)).toBe(real)
    expect(() => loadTypescript(project7, project7)).toThrow(/typescript 7\.0\.2 has no compiler API/)
  })
  it('compilerLocations lists the project directory before the plugin', () => {
    expect(compilerLocations(project(false))).toHaveLength(2)
  })
})
