#!/usr/bin/env node
import { readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

export type ParityRow = { card: string; layoutEqual: boolean; pixelDiff: number; note?: string }

const pngs = async (dir: string) =>
  (await readdir(dir))
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(0, -4))
    .sort()
const layoutOf = async (dir: string, card: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path.join(dir, `${card}.layout.json`), 'utf8'))
  } catch {
    return undefined
  }
}
const canonical = (v: unknown): string =>
  v === null || typeof v !== 'object'
    ? (JSON.stringify(v) ?? 'undefined')
    : Array.isArray(v)
      ? `[${v.map(canonical).join(',')}]`
      : `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(',')}}`

/** RGBA pixels, decoded by sharp: an exact comparison needs no other dependency. */
const pixels = async (file: string) => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/**
 * Compares the cards of two directories: `<card>.png` and `<card>.layout.json` (the fitText results per text field).
 * `pixelDiff` counts pixels with ANY differing channel. That is stricter than a perceptual diff (no
 * anti-aliasing allowance): a card either matches exactly or the difference is reported.
 */
export async function parity(oldDir: string, newDir: string): Promise<ParityRow[]> {
  const [a, b] = await Promise.all([pngs(oldDir), pngs(newDir)])
  const rows: ParityRow[] = []
  for (const card of [...new Set([...a, ...b])].sort()) {
    if (!a.includes(card) || !b.includes(card)) {
      rows.push({ card, layoutEqual: false, pixelDiff: Number.POSITIVE_INFINITY, note: `only in ${a.includes(card) ? 'old' : 'new'}` })
      continue
    }
    const [l1, l2] = await Promise.all([layoutOf(oldDir, card), layoutOf(newDir, card)])
    const layoutEqual = l1 !== undefined && l2 !== undefined && canonical(l1) === canonical(l2)
    const [p1, p2] = await Promise.all([pixels(path.join(oldDir, `${card}.png`)), pixels(path.join(newDir, `${card}.png`))])
    if (p1.width !== p2.width || p1.height !== p2.height) {
      rows.push({
        card,
        layoutEqual,
        pixelDiff: Number.POSITIVE_INFINITY,
        note: `size ${p1.width}x${p1.height} vs ${p2.width}x${p2.height}`,
      })
      continue
    }
    let pixelDiff = 0
    for (let i = 0; i < p1.data.length; i += 4) {
      if (
        p1.data[i] !== p2.data[i] ||
        p1.data[i + 1] !== p2.data[i + 1] ||
        p1.data[i + 2] !== p2.data[i + 2] ||
        p1.data[i + 3] !== p2.data[i + 3]
      )
        pixelDiff += 1
    }
    rows.push({ card, layoutEqual, pixelDiff, ...(l1 === undefined || l2 === undefined ? { note: 'layout.json missing' } : {}) })
  }
  return rows
}

/** `og-parity --old <dir> --new <dir>`: a table per card; exit 1 if any card differs. */
export async function main(argv: string[]): Promise<number> {
  const get = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined)
  const [oldDir, newDir] = [get('--old'), get('--new')]
  if (!oldDir || !newDir) {
    console.error('usage: og-parity --old <dir> --new <dir>')
    return 2
  }
  const rows = await parity(oldDir, newDir)
  const bad = rows.filter((r) => !r.layoutEqual || r.pixelDiff !== 0)
  console.log(['card', 'layoutEqual', 'pixelDiff', 'note'].join('\t'))
  for (const r of rows) console.log([r.card, r.layoutEqual, Number.isFinite(r.pixelDiff) ? r.pixelDiff : 'n/a', r.note ?? ''].join('\t'))
  console.log(`${rows.length - bad.length}/${rows.length} cards identical`)
  return rows.length === 0 || bad.length > 0 ? 1 : 0
}

// Run only as the bin (also through npm's symlink), never when imported.
const entry = process.argv[1] ? await realpath(process.argv[1]).catch(() => process.argv[1]) : undefined
if (entry && import.meta.url === pathToFileURL(entry).href) process.exit(await main(process.argv.slice(2)))
