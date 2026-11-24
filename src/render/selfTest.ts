import { drawElement, templateContext } from '../internal/draw.js'
import type { LoadedFont, Stacks } from '../internal/fonts.js'
import { isCompletePng } from '../internal/store/png.js'
import { type Brand, createFallbackTemplate, fallbackTemplate } from './fallback.js'
import { nextOgRenderer } from './nextOg.js'

/**
 * Draws the brand fallback card once, the way the route would: it needs no document and no props, so it proves the faces, the
 * `default` stack and the renderer work together. Loaded lazily (it imports `next/og` and `sharp`, which the Payload CLI's config
 * load must not pull in).
 */
export async function drawFallbackCard(a: {
  brand?: Brand
  fonts: LoadedFont[]
  stacks: Stacks
  host: string
  siteName: string
}): Promise<void> {
  const template = a.brand ? createFallbackTemplate(a.brand) : fallbackTemplate
  const { bytes } = await drawElement(
    nextOgRenderer(),
    template.render({ site: a.siteName }, templateContext({ host: a.host, fonts: a.fonts, stacks: a.stacks, hero: null })),
    { ...template.size, fonts: a.fonts },
  )
  if (!isCompletePng(bytes)) throw new Error('the renderer produced an invalid PNG')
}
