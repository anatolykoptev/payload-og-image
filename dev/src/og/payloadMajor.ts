import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The major version of the installed `payload`, read from its package.json (it does not export it). The dev app is run from the
 * repository root, as its other paths assume. `PAYLOAD_MAJOR` is the way out where that layout does not hold.
 */
export const payloadMajor = (): number => {
  try {
    const { version } = JSON.parse(readFileSync(path.resolve(process.cwd(), 'node_modules/payload/package.json'), 'utf8')) as {
      version: string
    }
    return Number(version.split('.')[0])
  } catch {
    return Number(process.env.PAYLOAD_MAJOR) || 3
  }
}
