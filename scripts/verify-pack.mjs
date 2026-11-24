// Release gate: pack the package, install the tarball into a clean project, import every entry point and
// compare its exports with the agreed public surface (S§D1). Fails while any entry is empty or a declared
// bin is missing, so a release is impossible until the surface is real.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EXPECTED = {
  'payload-og-image': ['defineTarget', 'defineTemplate', 'ogImagePlugin'],
  'payload-og-image/next': ['createOgRoute', 'ogMetadata', 'withHead'],
  'payload-og-image/testing': ['installTestRuntime', 'ogKit'],
}
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const errors = []

const work = mkdtempSync(join(tmpdir(), 'og-pack-'))
const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], process.cwd()))[0]
const tarball = join(work, packed.filename)
const inTarball = new Set(packed.files.map((f) => f.path))

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
for (const [name, file] of Object.entries(pkg.bin ?? {})) {
  if (!inTarball.has(file.replace(/^\.\//, ''))) errors.push(`bin "${name}" -> ${file} is not in the tarball`)
}

const project = join(work, 'project')
run('mkdir', ['-p', project], work)
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'verify', private: true, type: 'module' }))
run('npm', ['install', '--no-audit', '--no-fund', tarball], project)

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
