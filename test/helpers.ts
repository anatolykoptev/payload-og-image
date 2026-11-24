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

import sharp from 'sharp'

/** A real, tiny PNG whose bytes depend on `text`, so two different cards never share bytes. */
export const realPng = async (text: string): Promise<Uint8Array> => {
  let h = 7
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const background = { r: h & 255, g: (h >> 8) & 255, b: (h >> 16) & 255 }
  return new Uint8Array(
    await sharp({ create: { width: 8, height: 8, channels: 3, background } })
      .png()
      .toBuffer(),
  )
}
