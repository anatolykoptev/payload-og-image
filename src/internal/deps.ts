/**
 * The two heavy dependencies, loaded on first use and cached for the life of the process. Nothing on the plugin or `/next` import path
 * may import `sharp` or `fontkit` statically: Payload loads the config on every start (the CLI included), and neither is needed until a
 * card is drawn or a font is read. A test pins this (test/plugin/bootBudget.spec.ts).
 */
let sharp: Promise<typeof import('sharp').default> | undefined
let fontkit: Promise<typeof import('fontkit')> | undefined

export const loadSharp = (): Promise<typeof import('sharp').default> => {
  sharp ??= import('sharp').then((m) => m.default)
  sharp.catch(() => {
    sharp = undefined // a failed load (a missing native binary) is retried by the next draw, not remembered
  })
  return sharp
}

export const loadFontkit = (): Promise<typeof import('fontkit')> => {
  fontkit ??= import('fontkit')
  fontkit.catch(() => {
    fontkit = undefined
  })
  return fontkit
}
