// Release gate: pack the package, install the tarball into a clean project, import every entry point and
// compare its exports with the agreed public surface (S§D1). Fails while any entry is empty or a declared
// bin is missing, so a release is impossible until the surface is real.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const EXPECTED = {
  'payload-og-image': ['defineTarget', 'defineTemplate', 'ogFields', 'ogImagePlugin'],
  'payload-og-image/next': ['OG_SITE_TAG', 'createOgRoute', 'ogMetadata', 'ogTag', 'withHead'],
  'payload-og-image/testing': ['installTestRuntime', 'ogKit'],
  'payload-og-image/mcp': ['ogImageMcpToolMap'],
}
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const errors = []

const work = mkdtempSync(join(tmpdir(), 'og-pack-'))
const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], process.cwd()))[0]
const tarball = join(work, packed.filename)
const inTarball = new Set(packed.files.map((f) => f.path))

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
for (const [name, file] of Object.entries(pkg.bin ?? {})) {
  // npm 11 drops a bin whose path starts with `./` at publish ("script name ... was invalid"): v0.1.1 shipped without og-parity.
  if (file.startsWith('./')) errors.push(`bin "${name}" -> ${file}: write it without the leading ./`)
  if (!inTarball.has(file.replace(/^\.\//, ''))) errors.push(`bin "${name}" -> ${file} is not in the tarball`)
}

// The admin entry needs `@payloadcms/ui` (an optional peer), which a clean project does not have: it cannot be imported
// here, so resolve its export map instead: each condition must point at a file that is in the tarball.
const client = pkg.exports?.['./client']
if (!client) errors.push('package.json exports has no ./client entry')
else
  for (const cond of ['types', 'import']) {
    const target = client[cond]
    if (typeof target !== 'string') errors.push(`exports["./client"].${cond} is missing`)
    else if (!inTarball.has(target.replace(/^\.\//, ''))) errors.push(`exports["./client"].${cond} -> ${target} is not in the tarball`)
  }

const project = join(work, 'project')
run('mkdir', ['-p', project], work)
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'verify', private: true, type: 'module' }))
// No zod here on purpose: the mcp entry loads it only when a Payload 3 tool list is built, so a Payload 4 site needs none.
run('npm', ['install', '--no-audit', '--no-fund', tarball], project)

// A `//# sourceMappingURL=` comment must point at a file that ships: the package excludes `*.map`, and a dangling reference is
// ENOENT noise for every consumer that inlines the package under vite/vitest.
const installed = join(project, 'node_modules', pkg.name)
for (const f of packed.files.map((x) => x.path).filter((x) => x.endsWith('.js'))) {
  const m = /^\/\/# sourceMappingURL=(\S+)\s*$/m.exec(readFileSync(join(installed, f), 'utf8'))
  if (m && !existsSync(resolve(dirname(join(installed, f)), m[1]))) errors.push(`${f}: sourceMappingURL ${m[1]} is not in the tarball`)
}

for (const [entry, names] of Object.entries(EXPECTED)) {
  let got = []
  try {
    const out = run(
      'node',
      ['--input-type=module', '-e', `import * as m from '${entry}'; console.log(JSON.stringify(Object.keys(m).sort()))`],
      project,
    )
    got = JSON.parse(out)
  } catch (e) {
    errors.push(`${entry}: import failed: ${e.message.split('\n')[0]}`)
    continue
  }
  if (got.length === 0) errors.push(`${entry}: exports nothing`)
  if (JSON.stringify(got) !== JSON.stringify([...names].sort()))
    errors.push(`${entry}: exports ${JSON.stringify(got)}, expected ${JSON.stringify([...names].sort())}`)
}

if (errors.length > 0) {
  console.error(`verify-pack failed:\n- ${errors.join('\n- ')}`)
  process.exit(1)
}
console.log('verify-pack ok')
