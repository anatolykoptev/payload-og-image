// Prints the newest published `<major>.<minor>.<patch>-beta.<n>` of Payload that is older than the release-age cooldown
// (pnpm's `minimumReleaseAge` in pnpm-workspace.yaml: 1440 minutes). Used by the non-blocking `payload-beta` CI job instead of
// the `beta` dist-tag, which can name a version the cooldown refuses, and skips `-internal.` / `-canary.` builds, which are not betas.
// `npm view payload time --json | node scripts/latest-payload-beta.mjs`
import { readFileSync } from 'node:fs'

const BETA = /^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/

/** `time` is the registry's `{ <version | created | modified>: <ISO date> }` map. Returns a version, or undefined. */
export function pickBeta(time, now = Date.now(), minAgeMinutes = 1440) {
  return Object.entries(time)
    .filter(([version, published]) => BETA.test(version) && now - Date.parse(published) >= minAgeMinutes * 60_000)
    .map(([version]) => ({ version, key: BETA.exec(version).slice(1).map(Number) }))
    .sort((a, b) => b.key.reduce((d, n, i) => d || n - a.key[i], 0))[0]?.version
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const beta = pickBeta(JSON.parse(readFileSync(0, 'utf8')))
  if (!beta) {
    console.error('no Payload beta older than the release-age cooldown')
    process.exit(1)
  }
  console.log(beta)
}
