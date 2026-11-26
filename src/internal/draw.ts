import type { ImageLists, RowFit, RowItem, TemplateContext } from '../template.js'
import { coveringFamily, fitText, fontFamilyFor, type LoadedFont, measureText, type Stacks } from './fonts.js'
import type { Renderer } from './handler.js'
import { stripUndrawable } from './sanitize.js'
import type { CardEncoding } from './types.js'

/** What a template's `render` gets: the site host, the prepared hero (or null), the prepared named images, and font helpers over the stacks. */
export function templateContext(a: {
  host: string
  fonts: LoadedFont[]
  stacks: Stacks
  hero: string | null
  /** The prepared named images; none when absent. */
  images?: ImageLists
}): TemplateContext {
  /** The same rule `resolveCard` uses to strip: the named stack, else the explicit `default`. */
  const stackOf = (name: string): string[] => {
    const s = a.stacks[name] ?? a.stacks.default
    if (!s || s.length === 0) throw new Error(`payload-og-image: unknown font stack "${name}" (and no "default" stack)`)
    return s
  }
  return {
    host: a.host,
    hero: a.hero,
    // A null-prototype dictionary: a list named `constructor` or `toString` is a list, never an inherited function.
    images: a.images ?? Object.create(null),
    // A run no single family draws is measured and drawn glyph by glyph across the stack, never with its first family alone.
    fit: (text, box, stack) => {
      const s = stackOf(stack)
      return fitText(a.fonts, coveringFamily(a.fonts, s, text, box.weight) ?? s, text, box)
    },
    font: (stack, text, weight) => fontFamilyFor(a.fonts, stackOf(stack), text, weight),
    fitRow: (items, width, gap = 16) => fitRow(a.fonts, stackOf, items, width, gap),
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

/**
 * A row of items in `width`: each is measured (text plus its padding), and while the row with its gaps is wider than `width` the item with the
 * highest `priority` goes, whole (the first of equals from the end). Priority 0 is never dropped, so a row of nothing but such items may be wider
 * than `width`: the caller sized the text itself. The widths are rounded up to whole pixels, so a layout never claims less than is drawn.
 */
export function fitRow(fonts: LoadedFont[], stackOf: (name: string) => string[], items: RowItem[], width: number, gap: number): RowFit[] {
  if (!Number.isFinite(width) || !Number.isFinite(gap) || gap < 0)
    throw new Error('payload-og-image: fitRow needs a finite width and a gap of at least 0')
  let row: RowFit[] = items
    .filter((i) => i.text.trim() !== '')
    .map((i) => ({
      ...i,
      // A padded item (a pill) is drawn at exactly its width; a bare text gets 2 px of slack, so the box that holds it never wraps it.
      width: Math.ceil(
        measureText(fonts, stackOf(i.stack), i.text, i.size, { weight: i.weight, tracking: i.tracking }) + (i.padX ? 2 * i.padX : 2),
      ),
    }))
  const total = (r: RowFit[]) => r.reduce((sum, i) => sum + i.width, 0) + gap * Math.max(0, r.length - 1)
  while (row.length > 0 && total(row) > width) {
    const worst = Math.max(...row.map((i) => i.priority))
    if (worst <= 0) break
    const at = row.map((i) => i.priority).lastIndexOf(worst)
    row = row.filter((_, n) => n !== at)
  }
  return row
}
