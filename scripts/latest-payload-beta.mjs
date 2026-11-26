// Picks the Payload 4 beta the `payload-beta` CI matrix installs. Every `@payloadcms/*` package the job installs
// (the devDependencies) has to have the version, and has to have had it for longer than pnpm's `minimumReleaseAge` cooldown
// (pnpm-workspace.yaml: 1440 minutes), so one sibling published a few minutes after `payload` cannot slip through. The `beta`
// dist-tag is not used: it can name a version the cooldown refuses, and `-internal.` / `-canary.` builds are not betas.
//   node scripts/latest-payload-beta.mjs newest   newest beta every package has cleared the cooldown on
//   node scripts/latest-payload-beta.mjs floor    the oldest beta the peer range claims (`^4.0.0-beta.N`), if every package has it
//   node scripts/latest-payload-beta.mjs specs <version>   `pkg@version ...` for `pnpm add`
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const BETA = /^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/
const key = (version) => BETA.exec(version).slice(1).map(Number)

/** `times` is a list of registry `{ <version | created | modified>: <ISO date> }` maps, one per package. Returns a version, or undefined. */
export function pickBeta(times, now = Date.now(), minAgeMinutes = 1440) {
  const [first, ...rest] = times
  if (!first) return undefined
  const eligible = (version) =>
    [first, ...rest].every((time) => time[version] !== undefined && now - Date.parse(time[version]) >= minAgeMinutes * 60_000)
  return Object.keys(first)
    .filter((version) => BETA.test(version) && eligible(version))
    .sort((a, b) => key(b).reduce((d, n, i) => d || n - key(a)[i], 0))[0]
}

/** The beta in a peer range such as `^3.93.0 || ^4.0.0-beta.12`: `4.0.0-beta.12`, or undefined when the range names none. */
export function floorBeta(peerRange) {
  for (const part of peerRange.split('||')) {
    const version = /^\^?(\d+\.\d+\.\d+-beta\.\d+)$/.exec(part.trim())?.[1]
    if (version) return version
  }
  return undefined
}

/** `payload` plus every `@payloadcms/*` devDependency: the packages the job pins to one version. */
export function payloadPackages(devDependencies) {
  return ['payload', ...Object.keys(devDependencies).filter((name) => name.startsWith('@payloadcms/'))]
}

const npmTime = (name) => JSON.parse(execFileSync('npm', ['view', name, 'time', '--json'], { encoding: 'utf8' }))

// Node resolves symlinks in `import.meta.url` but not in `argv[1]`, so the entry path is resolved too.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [mode, arg] = process.argv.slice(2)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const names = payloadPackages(pkg.devDependencies)
  let out
  if (mode === 'specs' && arg) {
    out = names.map((name) => `${name}@${arg}`).join(' ')
  } else if (mode === 'newest' || mode === 'floor') {
    const times = names.map(npmTime)
    if (mode === 'newest') {
      out = pickBeta(times)
    } else {
      const floor = floorBeta(pkg.peerDependencies.payload)
      out = floor && times.every((time) => time[floor] !== undefined) ? floor : undefined
    }
  } else {
    console.error('usage: latest-payload-beta.mjs newest | floor | specs <version>')
    process.exit(2)
  }
  if (!out) {
    console.error(`no Payload beta for "${mode}" that every package has past the release-age cooldown`)
    process.exit(1)
  }
  console.log(out)
}
