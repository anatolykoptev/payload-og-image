import type { LoadedFont } from './fonts.js'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * The element a template drew, without the characters no registered face can draw.
 *
 * `next/og` answers a character none of the registered faces has by fetching a font (or a Twemoji image) from a third-party
 * CDN while it renders, so text the registered faces cannot draw would leave the host (a draft, in a preview) and make the
 * render depend on a CDN. Removing those characters here, from every text child of the element tree rather than only from
 * the props a template lists in `textFields`, leaves nothing for the renderer to fetch: it draws with the registered faces only.
 *
 * Whether a character is drawn is the renderer's own test (satori looks the character up in every registered face, whatever
 * the element's `fontFamily` names), so coverage here is "any registered face", not the stack of one field.
 */
export async function stripUndrawable(node: unknown, fonts: LoadedFont[]): Promise<{ node: unknown; dropped: string[] }> {
  const known = new Map<string, boolean>()
  const drawn = (ch: string): boolean => {
    let ok = known.get(ch)
    if (ok === undefined) {
      ok = fonts.some((f) => f.has(ch))
      known.set(ch, ok)
    }
    return ok
  }
  const dropped = new Set<string>()
  /**
   * One grapheme cluster. A lone character is drawn when any face has it. A cluster of several (a letter and its accent) is
   * looked up as a whole in the face that has its first character, and which face that is depends on the element's `fontFamily`:
   * so every mark must be in EVERY face that has the first character, or the renderer may look in one that lacks it and fetch.
   */
  const keep = (cluster: string): string => {
    if (/^[\r\n\t]+$/.test(cluster)) return cluster // layout, not glyphs: the renderer folds them itself
    const cps = [...cluster]
    const first = cps[0] as string
    if (cps.length === 1) {
      if (drawn(first)) return first
      dropped.add(first)
      return ''
    }
    const faces = fonts.filter((f) => f.has(first))
    if (faces.length === 0) {
      for (const ch of cps) dropped.add(ch)
      return ''
    }
    let out = first
    for (const ch of cps.slice(1)) {
      if (faces.every((f) => f.has(ch))) out += ch
      else dropped.add(ch)
    }
    return out
  }
  const clean = (raw: string): string => {
    // Composed where a composed letter exists (`e` + U+0301 is `é`): a face usually has the letter and not the mark.
    let kept = ''
    for (const { segment } of segmenter.segment(raw.normalize('NFC'))) kept += keep(segment)
    return kept === raw ? raw : kept
  }

  const walk = async (n: unknown): Promise<unknown> => {
    if (typeof n === 'string') return clean(n)
    if (typeof n === 'number') {
      const text = String(n)
      const kept = clean(text)
      return kept === text ? n : kept
    }
    if (Array.isArray(n)) {
      const out = await Promise.all(n.map(walk))
      return out.every((x, i) => x === n[i]) ? n : out
    }
    if (n === null || typeof n !== 'object' || !('type' in n) || !('props' in n)) return n
    const el = n as { type: unknown; props: Record<string, unknown> | null }
    if (typeof el.type === 'function') {
      // Function components are called by the renderer as `await type(props)`: do the same, then clean what they drew.
      if ((el.type as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent) return n
      try {
        return await walk(await (el.type as (p: unknown) => unknown)(el.props))
      } catch {
        return n // the renderer will call it again and fail the way it does for any template error
      }
    }
    if (!el.props || !('children' in el.props)) return n
    const children = await walk(el.props.children)
    return children === el.props.children ? n : { ...el, props: { ...el.props, children } }
  }

  const out = await walk(node)
  return { node: out, dropped: [...dropped] }
}
