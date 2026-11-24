/** Mutation table (production line -> the test that goes RED). A route file is a card route only if it exports the GET of a createOgRoute() call from payload-og-image/next.
 * - routeSource.ts:53  stop skipping `//` comments -> "shapes that are NOT > createOgRoute only in a comment" RED
 * - routeSource.ts:126 accept createOgRoute imported from any module -> "createOgRoute imported from another module" RED
 * - routeSource.ts:161 take GET from any identifier, not a createOgRoute result -> "GET taken from something else" RED
 * - routeSource.ts:160 accept any member of the call result as GET -> "another member of the call result as GET" RED
 * - routeSource.ts:18  an escaped backtick ends a template -> "an escaped backtick does not end a template that quotes a route" RED
 * - routeSource.ts:152 a destructured GET counts as exported without an export -> "a destructured GET that is never exported" RED
 * - routeSource.ts:170 `export { GET as X }` counts as exporting GET -> "a destructured GET exported under another name" RED */
import { describe, expect, it } from 'vitest'
import { analyzeRouteSource } from '../../src/testing/routeSource.js'

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
    ['an empty file', ''],
  ])('%s', (_, src) => no(src))
})
