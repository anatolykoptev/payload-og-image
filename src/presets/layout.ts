// The layout of both presets as pure functions of the props and a template context: where every box goes, in pixels. A template then draws
// the boxes it is given, so the safe zone is testable without drawing a pixel.
import type { RowFit, RowItem, TemplateContext } from '../template.js'
import { PHOTO, SLOTS, type SlotName, TEXT } from './spec.js'

export type PresetProps = {
  title: string
  subtitle?: string
  label?: string
  /** The site's name. */
  site: string
  /** Shown before the domain in the foot of the text preset (`author · domain`). */
  byline?: string
  pill?: string
  pill2?: string
  badge?: string
  caption?: string
  meta?: string
}

export type Rect = { x: number; y: number; w: number; h: number }
export type Placed<T = unknown> = T & { rect: Rect; family: string }
export type FootItem = RowFit & { rect: Rect; family: string; kind: 'pill' | 'badge' | 'text' }

/** Every box a layout draws as text, a logo or a pill, which must stay inside `ZONE`. */
export type NamedRect = Rect & { name: string }

const STACK = 'default'
const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** The slot items of a row, in drawn order. A text over `maxChars` is dropped whole (never cut): the resolver does the same on the way in. */
export function slotItems(
  p: PresetProps,
  o: { pillSize: number; padX: number; badgePadX: number; textSize: number; skip?: SlotName[] },
): RowItem[] {
  const order: SlotName[] = ['pill', 'pill2', 'badge', 'caption']
  return order.flatMap((name) => {
    const text = textOf(p[name])
    const spec = SLOTS[name]
    if (text === '' || [...text].length > spec.maxChars || o.skip?.includes(name)) return []
    return [
      {
        key: name,
        text,
        stack: STACK,
        size: spec.kind === 'text' ? o.textSize : o.pillSize,
        weight: spec.kind === 'text' ? 400 : 700,
        padX: spec.kind === 'pill' ? o.padX : spec.kind === 'badge' ? o.badgePadX : 0,
        priority: spec.priority,
      },
    ]
  })
}

const kindOf = (key: string): FootItem['kind'] => (key === 'pill' || key === 'pill2' ? 'pill' : key === 'badge' ? 'badge' : 'text')

/** A name that fits one line at some size of the ladder with nothing cut; else undefined (the caller tries the next candidate or draws none). */
function nameFit(ctx: TemplateContext, text: string, width: number) {
  if (text === '' || width <= 0) return undefined
  const f = ctx.fit(text, { width, height: TEXT.head.height, leading: 1, maxLines: 1, sizes: TEXT.head.name }, STACK)
  return f.lines === 1 && f.text === text ? f : undefined
}

export type TextLayout = {
  art: 'art' | 'mark' | null
  colW: number
  logo?: Rect
  name?: Placed<{ text: string; size: number }>
  rule?: Rect
  label?: Placed<{ text: string; size: number }>
  title: Placed<{ text: string; size: number; lines: number }>
  sub?: Placed<{ text: string; lines: number }>
  foot: FootItem[]
  boxes: NamedRect[]
}

export function textLayout(p: PresetProps, ctx: TemplateContext): TextLayout {
  const art = ctx.images.art?.[0] ? 'art' : ctx.images.mark?.[0] ? 'mark' : null
  const colW = art ? TEXT.columnWidth.art : TEXT.columnWidth.plain
  const x = TEXT.x
  const boxes: NamedRect[] = []
  const place = (name: string, r: Rect) => {
    boxes.push({ name, ...r })
    return r
  }

  // Head: logo mark, site name, a hairline, the label.
  const hasLogo = Boolean(ctx.images.logo?.[0])
  const logo = hasLogo ? place('logo', { x, y: TEXT.head.y, w: 44, h: 44 }) : undefined
  const cx = x + (hasLogo ? 44 + 16 : 0)
  const avail = x + colW - cx
  const label = textOf(p.label)
  let name: TextLayout['name']
  let labelPlaced: TextLayout['label']
  let rule: Rect | undefined
  const nameText = [textOf(p.site), ctx.host].find((t) => nameFit(ctx, t, avail) !== undefined)
  const nf = nameText === undefined ? undefined : nameFit(ctx, nameText, avail)
  const size = nf?.size ?? TEXT.head.label
  const head: RowItem[] = [
    ...(nameText !== undefined ? [{ key: 'name', text: nameText, stack: STACK, size, weight: 700, tracking: -0.01, priority: 0 }] : []),
    ...(label !== '' ? [{ key: 'label', text: label, stack: STACK, size, weight: 400, priority: 1 }] : []),
  ]
  const row = ctx.fitRow(head, avail, TEXT.head.gap * 2)
  let at = cx
  for (const item of row) {
    const rect = { x: at, y: TEXT.head.y, w: item.width + 2, h: TEXT.head.height }
    const family = ctx.font(STACK, item.text)
    if (item.key === 'name') name = { text: item.text, size: item.size, rect: place('name', rect), family }
    else {
      labelPlaced = { text: item.text, size: item.size, rect: place('label', rect), family }
      rule = place('rule', { x: at - TEXT.head.gap - 1, y: TEXT.head.y + 4, w: TEXT.head.rule.width, h: TEXT.head.rule.height })
    }
    at += item.width + TEXT.head.gap * 2
  }

  // Title and sub line, centred between the head and the foot.
  const ladder = art ? TEXT.title.ladder.art : TEXT.title.ladder.plain
  const t = ctx.fit(
    textOf(p.title),
    { width: colW, height: TEXT.title.height, leading: TEXT.title.leading, tracking: TEXT.title.tracking, balance: true, sizes: ladder },
    STACK,
  )
  const titleH = Math.ceil(t.lines * t.size * TEXT.title.leading)
  const areaTop = TEXT.head.y + TEXT.head.height + 24
  const areaH = TEXT.sub.bottom + 6 - areaTop
  const subText = textOf(p.subtitle)
  let subFit: ReturnType<TemplateContext['fit']> | undefined
  if (subText !== '' && t.lines <= TEXT.sub.dropTitleLines) {
    const room = areaTop + areaH - (areaTop + titleH + TEXT.sub.gap)
    const f = ctx.fit(
      subText,
      { width: colW, height: room, leading: TEXT.sub.leading, maxLines: TEXT.sub.maxLines, sizes: [TEXT.sub.size] },
      STACK,
    )
    if (f.lines > 0) subFit = f
  }
  const subH = subFit ? Math.ceil(subFit.lines * TEXT.sub.size * TEXT.sub.leading) : 0
  const block = titleH + (subFit ? TEXT.sub.gap + subH : 0)
  const top = areaTop + Math.max(0, Math.floor((areaH - block) / 2))
  const title = {
    text: t.text,
    size: t.size,
    lines: t.lines,
    rect: place('title', { x, y: top, w: t.width ?? colW, h: titleH }),
    family: ctx.font(STACK, t.text),
  }
  const sub = subFit
    ? {
        text: subFit.text,
        lines: subFit.lines,
        rect: place('sub', { x, y: top + titleH + TEXT.sub.gap, w: colW, h: subH }),
        family: ctx.font(STACK, subFit.text),
      }
    : undefined

  // Foot: `byline · domain`, then the slots; `meta` goes to the end of the row.
  const host = ctx.host
  const byline = textOf(p.byline)
  const lines = [byline !== '' ? `${byline} · ${host}` : host, host]
  const lead = lines
    .map((text): RowItem => ({ key: 'lead', text, stack: STACK, size: TEXT.foot.size, weight: 400, priority: 0 }))
    .find((i) => ctx.fitRow([i], colW).every((r) => r.width <= colW))
  const meta = textOf(p.meta)
  const metaItem: RowItem[] =
    meta !== '' && [...meta].length <= SLOTS.meta.maxChars
      ? [{ key: 'meta', text: meta, stack: STACK, size: TEXT.foot.size, weight: 400, priority: SLOTS.meta.priority }]
      : []
  const items = [
    ...(lead ? [lead] : []),
    ...slotItems(p, { pillSize: TEXT.foot.pill.size, padX: TEXT.foot.pill.padX, badgePadX: 10, textSize: TEXT.foot.size }),
    ...metaItem,
  ]
  const fitted = ctx.fitRow(items, colW, TEXT.foot.gap)
  const foot: FootItem[] = []
  let fx = x
  for (const item of fitted) {
    const w = item.width + (item.padX ? 0 : 2)
    const end = item.key === 'meta'
    const rect = { x: end ? x + colW - w : fx, y: TEXT.foot.y, w, h: TEXT.foot.height }
    foot.push({
      ...(item as RowFit),
      rect: place(item.key, rect),
      family: ctx.font(STACK, item.text),
      kind: item.key === 'lead' || end ? 'text' : kindOf(item.key),
    })
    if (!end) fx += item.width + TEXT.foot.gap
  }
  return { art, colW, logo, name, rule, label: labelPlaced, title, sub, foot, boxes }
}

export type PhotoLayout = {
  logo?: Rect
  title: Placed<{ text: string; size: number; lines: number }>
  facts: FootItem[]
  /** Where the bottom scrim starts (it runs to the bottom edge). */
  scrimTop: number
  boxes: NamedRect[]
}

export function photoLayout(p: PresetProps, ctx: TemplateContext): PhotoLayout {
  const boxes: NamedRect[] = []
  const place = (name: string, r: Rect) => {
    boxes.push({ name, ...r })
    return r
  }
  const logo = ctx.images.logo?.[0]
    ? place('logo', { x: PHOTO.logo.x, y: PHOTO.logo.y, w: PHOTO.logo.size, h: PHOTO.logo.size })
    : undefined

  // Facts: the label stands in for a missing `pill`; the end of the row is `meta`, else the site name (which goes first when the row is full).
  const label = textOf(p.label)
  const withPill: PresetProps = textOf(p.pill) === '' && label !== '' ? { ...p, pill: label } : p
  const site = textOf(p.site)
  const meta = textOf(p.meta)
  const endItem: RowItem[] =
    meta !== '' && [...meta].length <= SLOTS.meta.maxChars
      ? [{ key: 'meta', text: meta, stack: STACK, size: PHOTO.fact.size, weight: 400, priority: SLOTS.meta.priority }]
      : site !== ''
        ? [{ key: 'site', text: site, stack: STACK, size: PHOTO.fact.size, weight: 700, priority: 6 }]
        : []
  const items = [
    ...slotItems(withPill, { pillSize: PHOTO.fact.size - 2, padX: PHOTO.fact.pill.padX, badgePadX: 12, textSize: PHOTO.fact.size }),
    ...endItem,
  ]
  const fitted = ctx.fitRow(items, PHOTO.width, PHOTO.fact.gap)
  const facts: FootItem[] = []
  let fx = PHOTO.x
  for (const item of fitted) {
    const end = item.key === 'meta' || item.key === 'site'
    const w = item.width + (item.padX ? 0 : 2)
    const rect = { x: end ? PHOTO.x + PHOTO.width - w : fx, y: PHOTO.fact.y, w, h: PHOTO.fact.height }
    facts.push({
      ...(item as RowFit),
      rect: place(item.key, rect),
      family: ctx.font(STACK, item.text),
      kind: end ? 'text' : kindOf(item.key),
    })
    if (!end) fx += item.width + PHOTO.fact.gap
  }

  // Title, bottom-anchored above the facts.
  const bottom = facts.length > 0 ? PHOTO.fact.y - PHOTO.title.gapAbove : PHOTO.fact.y + PHOTO.fact.height
  const t = ctx.fit(
    textOf(p.title),
    {
      width: PHOTO.width,
      height: 330,
      leading: PHOTO.title.leading,
      tracking: PHOTO.title.tracking,
      balance: true,
      sizes: PHOTO.title.ladder,
    },
    STACK,
  )
  const h = Math.ceil(t.lines * t.size * PHOTO.title.leading)
  const title = {
    text: t.text,
    size: t.size,
    lines: t.lines,
    rect: place('title', { x: PHOTO.x, y: bottom - h, w: t.width ?? PHOTO.width, h }),
    family: ctx.font(STACK, t.text),
  }
  return { logo, title, facts, scrimTop: Math.max(0, bottom - h - PHOTO.scrim.fade), boxes }
}
