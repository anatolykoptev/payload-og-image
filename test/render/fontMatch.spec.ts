/** Mutation table (production line -> the test that goes RED). Silent-failure surface: a title measured with another face than the one the renderer draws overflows its box (or leaves a gap) with no error.
 * - fonts.ts `preferred`: the 400/500 pair rule, the below-400 order or the above-500 order replaced by "nearest weight" -> "the face matchFace picks is the face satori draws ..." RED (each names the requests it gets wrong)
 * - fonts.ts `matchFace` back to the nearest weight, the lower on a tie -> the same test RED (request 400, faces 300 and 500: satori draws 500) and the italic/upright test RED
 * - fonts.ts `preferred`: the equal-weight style rule inverted -> "equal weights, an italic and an upright face ..." RED
 * The oracle is satori itself: each case renders a probe through next/og with two real faces registered at the weights under test and sees which one was drawn. */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { type LoadedFont, loadFonts, matchFace } from '../../src/internal/fonts.js'
import { nextOgRenderer } from '../../src/render/nextOg.js'

const file = (n: string) => () => readFile(new URL(`../fixtures/fonts/${n}`, import.meta.url))
// Two real faces that draw "Hello" differently: Archivo and Inter.
const loaded = loadFonts([
  { family: 'Archivo', weight: 400, data: file('archivo-latin-600.woff') },
  { family: 'Inter', weight: 400, data: file('inter-latin-cyrillic-800.woff') },
])

const renderer = nextOgRenderer({ palette: false })
const draw = async (faces: LoadedFont[], weight: number) =>
  Buffer.from(
    await renderer.render(
      { type: 'div', props: { style: { display: 'flex', fontFamily: 'F', fontWeight: weight, fontSize: 56 }, children: 'Hello' } } as never,
      {
        width: 260,
        height: 90,
        fonts: faces,
      },
    ),
  )

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900]
/** Pairs of registered weights whose neighbours the CSS order ranks differently from "nearest weight". */
const PAIRS: [number, number][] = [
  [300, 500],
  [400, 500],
  [300, 700],
  [500, 700],
  [600, 800],
  [400, 900],
  [100, 400],
  [200, 300],
  [800, 900],
  [300, 600],
]

describe('matching a face to a weight', () => {
  it('the face matchFace picks is the face satori draws, for every requested weight over pairs of registered weights', async () => {
    const { fonts } = await loaded
    const archivo = fonts.find((f) => f.family === 'Archivo') as LoadedFont
    const inter = fonts.find((f) => f.family === 'Inter') as LoadedFont
    const only = async (face: LoadedFont, w: number) => draw([{ ...face, family: 'F', weight: w }], w)
    const wrong: string[] = []
    for (const w of WEIGHTS) {
      const refArchivo = await only(archivo, w)
      const refInter = await only(inter, w)
      expect(refArchivo.equals(refInter)).toBe(false) // the probe can tell the two faces apart
      for (const [lo, hi] of PAIRS) {
        for (const swap of [false, true]) {
          const faces: LoadedFont[] = [
            { ...archivo, family: 'F', weight: swap ? hi : lo },
            { ...inter, family: 'F', weight: swap ? lo : hi },
          ]
          const out = await draw(faces, w)
          const drawn = out.equals(refArchivo) ? faces[0] : out.equals(refInter) ? faces[1] : undefined
          const picked = matchFace(faces, 'F', w)
          if (!drawn || drawn.weight !== picked?.weight)
            wrong.push(`request ${w}, faces ${lo}/${hi}${swap ? ' swapped' : ''}: satori ${drawn?.weight}, matchFace ${picked?.weight}`)
        }
      }
    }
    expect(wrong).toEqual([])
  }, 120_000)

  it('equal weights, an italic and an upright face: satori draws the upright one, whatever the registration order', async () => {
    const { fonts } = await loaded
    const archivo = fonts.find((f) => f.family === 'Archivo') as LoadedFont
    const inter = fonts.find((f) => f.family === 'Inter') as LoadedFont
    for (const order of [0, 1]) {
      const faces: LoadedFont[] = [
        { ...archivo, family: 'F', weight: 400, style: 'normal' },
        { ...inter, family: 'F', weight: 400, style: 'italic' },
      ]
      if (order) faces.reverse()
      const upright = faces.find((f) => f.style === 'normal') as LoadedFont
      const out = await draw(faces, 400)
      const ref = await draw([{ ...upright, family: 'F' }], 400)
      expect(out.equals(ref)).toBe(true)
      expect(matchFace(faces, 'F', 400)).toBe(upright)
    }
  })
})
