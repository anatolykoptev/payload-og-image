import { readFile } from 'node:fs/promises'
import { loadFonts } from '../src/internal/fonts.js'

const file = (n: string) => () => readFile(new URL(`./fixtures/fonts/${n}`, import.meta.url))

let loaded: ReturnType<typeof loadFonts> | undefined
/** The OFL fixture faces (Archivo 600, Inter 800), loaded once per test file. */
export const loadTestFonts = () => {
  loaded ??= loadFonts([
    { family: 'Archivo', weight: 600, data: file('archivo-latin-600.woff') },
    { family: 'Inter', weight: 800, data: file('inter-latin-cyrillic-800.woff') },
  ])
  return loaded
}
