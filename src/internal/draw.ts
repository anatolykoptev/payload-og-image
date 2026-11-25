import type { TemplateContext } from '../template.js'
import { coveringFamily, fitText, fontFamilyFor, type LoadedFont, type Stacks } from './fonts.js'
import type { Renderer } from './handler.js'
import { stripUndrawable } from './sanitize.js'
import type { CardEncoding } from './types.js'

/** What a template's `render` gets: the site host, the prepared hero (or null), and font helpers over the stacks. */
export function templateContext(a: { host: string; fonts: LoadedFont[]; stacks: Stacks; hero: string | null }): TemplateContext {
  /** The same rule `resolveCard` uses to strip: the named stack, else the explicit `default`. */
  const stackOf = (name: string): string[] => {
    const s = a.stacks[name] ?? a.stacks.default
    if (!s || s.length === 0) throw new Error(`payload-og-image: unknown font stack "${name}" (and no "default" stack)`)
    return s
  }
  return {
    host: a.host,
    hero: a.hero,
    // A run no single family draws is measured and drawn glyph by glyph across the stack, never with its first family alone.
    fit: (text, box, stack) => {
      const s = stackOf(stack)
      return fitText(a.fonts, coveringFamily(a.fonts, s, text) ?? s, text, box)
    },
    font: (stack, text) => fontFamilyFor(a.fonts, stackOf(stack), text),
  }
}

/**
 * The one way a template's element is drawn: characters no registered face draws are removed from it first (so the renderer
 * has nothing to fetch), then the renderer draws. `dropped` is what was removed.
 */
export async function drawElement(
  renderer: Renderer,
  el: unknown,
  o: { width: number; height: number; fonts: LoadedFont[]; encoding?: CardEncoding },
): Promise<{ bytes: Uint8Array; dropped: string[] }> {
  const { node, dropped } = await stripUndrawable(el, o.fonts)
  return { bytes: await renderer.render(node as never, o), dropped }
}
