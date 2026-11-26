// The layout of both presets as pure functions of the props and a template context: where every box goes, in pixels. A template then draws
// the boxes it is given, so the safe zone is testable without drawing a pixel.
import { contrast, hexColour, luminance, rgbOf } from '../internal/colour.js'
import type { RowFit, RowItem, TemplateContext } from '../template.js'
import { COLOURS, DENSITY, MIN_CONTRAST, PHOTO, SLOTS, type SlotName, TEXT } from './spec.js'

export type PresetProps = {
  title: string
  subtitle?: string
  label?: string
  /** The site's name. */
  site: string
  /** Shown before the domain in the foot of the text preset (`author · domain`). */
  byline?: string
  /** The opacity (0 to 1) of the logo on the right of the text card; default 0.35, 1 draws it in full. */
  artOpacity?: number
  /** The accent (`#rgb` or `#rrggbb`) of the strip, the badge and the accent pill; default: the preset's. A colour that contrasts too little with the ground is drawn in the ink. */
  accent?: string
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
const collapse = (s: string) => s.replace(/\s+/g, ' ')
/** The domain as a reader writes it: no leading `www.`. */
const bare = (host: string) => host.replace(/^www\./, '')

/** `ctx.fitRow`, which the plugin's context always has; a hand-built context must be made with `templateContext`. */
const rowOf = (ctx: TemplateContext): NonNullable<TemplateContext['fitRow']> => {
  if (!ctx.fitRow)
    throw new Error(
      'payload-og-image: the presets need ctx.fitRow: build the TemplateContext with the plugin (a test harness: templateContext())',
    )
  return ctx.fitRow
}

/** The pixel size of a PNG data URL (read from its header), or undefined for anything else. */
export function imageSize(dataUrl: string | undefined): { w: number; h: number } | undefined {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]{32})/.exec(dataUrl ?? '')
  if (!m) return undefined
  const b = Buffer.from(m[1] as string, 'base64')
  const w = b.readUInt32BE(16)
  const h = b.readUInt32BE(20)
  return w > 0 && h > 0 ? { w, h } : undefined
}

/** A contained logo as drawn: its data is at `DENSITY` times the drawn size, scaled down to fit `maxWidth` x `height` and never cropped. */
function drawn(src: string | undefined, maxWidth: number, height: number): { w: number; h: number } | undefined {
  if (!src) return undefined
  const size = imageSize(src) ?? { w: height * DENSITY, h: height * DENSITY }
  const k = Math.min(1, height / (size.h / DENSITY), maxWidth / (size.w / DENSITY))
  return { w: Math.round((size.w / DENSITY) * k), h: Math.round((size.h / DENSITY) * k) }
}

/** The accent the text card draws: the preset's own, or the props' when it is a colour that stays readable against the ground (else the ink, like a logo that would vanish). */
export function accentOf(p: Pick<PresetProps, 'accent'>): string {
  const own = hexColour(typeof p.accent === 'string' ? p.accent.trim() : undefined)
  if (own === undefined) return COLOURS.accent
  return contrast(luminance(rgbOf(own)), luminance(rgbOf(COLOURS.ground))) < MIN_CONTRAST ? COLOURS.ink : own
}

/**
 * The props as the card will draw them, taken before the version: a slot that is empty or over its `maxChars` is not drawn, so it must not be hashed
 * (changing it would move the URL of a card that looks the same). The layout applies the same rule, so a hand-built context cannot disagree.
 */
export function normalizeSlots(p: PresetProps): PresetProps {
  const out: Record<string, unknown> = { ...p }
  for (const name of Object.keys(SLOTS) as SlotName[]) {
    const text = textOf(p[name])
    if (text === '' || [...text].length > SLOTS[name].maxChars) delete out[name]
    else out[name] = text
  }
  // The accent as drawn: the preset's own is no prop at all, so a document that sets it changes no URL.
  const accent = accentOf(p).toLowerCase()
  if (accent === COLOURS.accent.toLowerCase()) delete out.accent
  else out.accent = accent
  return out as PresetProps
}

/** The slot items of a row, in drawn order. A text over `maxChars` is dropped whole (never cut): the resolver does the same on the way in. */
export function slotItems(p: PresetProps, o: { pillSize: number; padX: number; badgePadX: number; textSize: number }): RowItem[] {
  const order: SlotName[] = ['pill', 'pill2', 'badge', 'caption']
  return order.flatMap((name) => {
    const text = textOf(p[name])
    const spec = SLOTS[name]
    if (text === '' || [...text].length > spec.maxChars) return []
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

const kindOf = (key: string): FootItem['kind'] =>
  key === 'pill' || key === 'pill2' || key === 'label' ? 'pill' : key === 'badge' ? 'badge' : 'text'

/** A name that fits one line at some size of the ladder with nothing cut; else undefined (the caller tries the next candidate or draws none). */
function nameFit(ctx: TemplateContext, text: string, width: number) {
  if (text === '' || width <= 0) return undefined
  const f = ctx.fit(
    text,
    { width, height: TEXT.head.height, leading: 1, maxLines: 1, sizes: TEXT.head.name, weight: 700, tracking: -0.01 },
    STACK,
  )
  return f.lines === 1 && f.text === text ? f : undefined
}

export type TextLayout = {
  /** What fills the right side: the site's logo, whole and faint, the uploaded art, or nothing (the column is then 900 px wide). */
  art: 'art' | 'mark' | null
  colW: number
  logo?: Rect
  partner?: Rect
  /** Where the logo on the right is drawn: contained in its 480 x 480 box, centred in it. Bleeds nothing, and is not held to the safe zone. */
  mark?: Rect
  name?: Placed<{ text: string; size: number }>
  rule?: Rect
  label?: Placed<{ text: string; size: number }>
  title: Placed<{ text: string; size: number; lines: number }>
  sub?: Placed<{ text: string; lines: number }>
  foot: FootItem[]
  boxes: NamedRect[]
}

/** The layout with the given art, or undefined when the title would not fit whole beside it (there is no ellipsis next to art). */
function textLayoutFor(p: PresetProps, ctx: TemplateContext, art: TextLayout['art']): TextLayout | undefined {
  const colW = art === 'mark' ? TEXT.columnWidth.mark : art === 'art' ? TEXT.columnWidth.art : TEXT.columnWidth.plain
  const x = TEXT.x
  const boxes: NamedRect[] = []
  const place = (name: string, r: Rect) => {
    boxes.push({ name, ...r })
    return r
  }
  const centred = (h: number) => TEXT.head.y + Math.round((TEXT.head.height - h) / 2)

  // Head: the logo contained (never cropped), a partner logo, the site name (not beside a wide logo), a hairline, the label.
  let cx = x
  const logoSize = drawn(ctx.images.logo?.[0], TEXT.head.logo.maxWidth, TEXT.head.logo.height)
  const logo = logoSize ? place('logo', { x: cx, y: centred(logoSize.h), w: logoSize.w, h: logoSize.h }) : undefined
  if (logo) cx += logo.w + TEXT.head.after
  const partnerSize = drawn(ctx.images.partner?.[0], TEXT.head.partner.maxWidth, TEXT.head.partner.height)
  const partner = partnerSize ? place('partner', { x: cx, y: centred(partnerSize.h), w: partnerSize.w, h: partnerSize.h }) : undefined
  if (partner) cx += partner.w + TEXT.head.after
  const wide = logoSize !== undefined && logoSize.w / logoSize.h > TEXT.head.wide
  const avail = x + colW - cx
  const label = textOf(p.label)
  let name: TextLayout['name']
  let labelPlaced: TextLayout['label']
  let rule: Rect | undefined
  const nameText = wide ? undefined : [textOf(p.site), bare(ctx.host)].find((t) => nameFit(ctx, t, avail) !== undefined)
  const nf = nameText === undefined ? undefined : nameFit(ctx, nameText, avail)
  const size = nf?.size ?? TEXT.head.label
  const head: RowItem[] = [
    ...(nameText !== undefined ? [{ key: 'name', text: nameText, stack: STACK, size, weight: 700, tracking: -0.01, priority: 0 }] : []),
    ...(label !== '' ? [{ key: 'label', text: label, stack: STACK, size, weight: 400, priority: 1 }] : []),
  ]
  const row = rowOf(ctx)(head, avail, TEXT.head.gap * 2)
  // A hairline stands between what came before (a logo, a name) and the label; the row's own gap is twice the hairline's offset.
  let at = cx
  const named = (k: string) => row.some((r) => r.key === k)
  for (const item of row) {
    const rect = { x: at, y: TEXT.head.y, w: item.width, h: TEXT.head.height }
    const family = ctx.font(STACK, item.text, item.weight)
    if (item.key === 'name') {
      name = { text: item.text, size: item.size, rect: place('name', rect), family }
      at += item.width + TEXT.head.gap * 2
    } else {
      const lead = named('name') || logo !== undefined || partner !== undefined
      const lx = named('name') ? at : lead ? at + TEXT.head.gap : at
      labelPlaced = { text: item.text, size: item.size, rect: place('label', { ...rect, x: lx }), family }
      if (lead) rule = place('rule', { x: lx - TEXT.head.gap - 1, y: TEXT.head.y + 4, w: TEXT.head.rule.width, h: TEXT.head.rule.height })
    }
  }

  // Title and sub line, centred between the head and the foot.
  const ladder = art ? TEXT.title.ladder.art : TEXT.title.ladder.plain
  const title = textOf(p.title)
  const t = ctx.fit(
    title,
    {
      width: colW,
      height: TEXT.title.height,
      leading: TEXT.title.leading,
      tracking: TEXT.title.tracking,
      balance: true,
      sizes: ladder,
      weight: TEXT.title.weight,
    },
    STACK,
  )
  if (art && t.text !== collapse(title)) return undefined
  const titleH = Math.ceil(t.lines * t.size * TEXT.title.leading)
  const areaTop = TEXT.head.y + TEXT.head.height + 24
  const areaH = TEXT.sub.bottom + 6 - areaTop
  const subText = textOf(p.subtitle)
  let subFit: ReturnType<TemplateContext['fit']> | undefined
  if (subText !== '' && t.lines <= TEXT.sub.dropTitleLines) {
    const room = areaTop + areaH - (areaTop + titleH + TEXT.sub.gap)
    const f = ctx.fit(
      subText,
      { width: colW, height: room, leading: TEXT.sub.leading, maxLines: TEXT.sub.maxLines, sizes: [TEXT.sub.size], weight: 400 },
      STACK,
    )
    // Whole or not at all: only the title keeps the fitter's ellipsis.
    if (f.lines > 0 && f.text === collapse(subText)) subFit = f
  }
  const subH = subFit ? Math.ceil(subFit.lines * TEXT.sub.size * TEXT.sub.leading) : 0
  const block = titleH + (subFit ? TEXT.sub.gap + subH : 0)
  const top = areaTop + Math.max(0, Math.floor((areaH - block) / 2))
  const placedTitle = {
    text: t.text,
    size: t.size,
    lines: t.lines,
    rect: place('title', { x, y: top, w: t.width ?? colW, h: titleH }),
    family: ctx.font(STACK, t.text, TEXT.title.weight),
  }
  const sub = subFit
    ? {
        text: subFit.text,
        lines: subFit.lines,
        rect: place('sub', { x, y: top + titleH + TEXT.sub.gap, w: colW, h: subH }),
        family: ctx.font(STACK, subFit.text, 400),
      }
    : undefined

  // Foot: `byline · domain`, then the slots; `meta` goes to the end of the row.
  const host = bare(ctx.host)
  const byline = textOf(p.byline)
  const lines = [byline !== '' ? `${byline} · ${host}` : host, host]
  const lead = lines
    .map((text): RowItem => ({ key: 'lead', text, stack: STACK, size: TEXT.foot.size, weight: 400, priority: 0 }))
    .find((i) => rowOf(ctx)([i], colW).every((r) => r.width <= colW))
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
  const fitted = rowOf(ctx)(items, colW, TEXT.foot.gap)
  const foot: FootItem[] = []
  let fx = x
  for (const item of fitted) {
    const end = item.key === 'meta'
    const rect = { x: end ? x + colW - item.width : fx, y: TEXT.foot.y, w: item.width, h: TEXT.foot.height }
    foot.push({
      ...(item as RowFit),
      rect: place(item.key, rect),
      family: ctx.font(STACK, item.text, item.weight),
      kind: item.key === 'lead' || end ? 'text' : kindOf(item.key),
    })
    if (!end) fx += item.width + TEXT.foot.gap
  }
  const markSrc = art === 'mark' ? ctx.images.mark?.[0] : undefined
  const ms = markSrc ? (imageSize(markSrc) ?? { w: TEXT.art.size, h: TEXT.art.size }) : undefined
  const k = ms ? Math.min(1, TEXT.art.size / ms.w, TEXT.art.size / ms.h) : 1
  const mark = ms
    ? {
        x: TEXT.art.x + Math.round((TEXT.art.size - ms.w * k) / 2),
        y: TEXT.art.y + Math.round((TEXT.art.size - ms.h * k) / 2),
        w: Math.round(ms.w * k),
        h: Math.round(ms.h * k),
      }
    : undefined
  return { art, colW, logo, partner, mark, name, rule, label: labelPlaced, title: placedTitle, sub, foot, boxes }
}

export function textLayout(p: PresetProps, ctx: TemplateContext): TextLayout {
  const art = ctx.images.art?.[0] ? 'art' : ctx.images.mark?.[0] ? 'mark' : null
  return (art ? textLayoutFor(p, ctx, art) : undefined) ?? (textLayoutFor(p, ctx, null) as TextLayout)
}

export type PhotoLayout = {
  logo?: Rect
  partner?: Rect
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
  const L = PHOTO.lockup
  const logoSize = drawn(ctx.images.logo?.[0], L.logo.maxWidth, L.logo.height)
  const partnerSize = logoSize ? drawn(ctx.images.partner?.[0], L.partner.maxWidth, L.partner.height) : undefined
  const wide = logoSize !== undefined && logoSize.w / logoSize.h > L.wide
  const gap = PHOTO.fact.gap

  // Facts: the label stands in for a missing `pill` (in the translucent skin). The end of the row is one lockup: the logo, a partner logo, the name.
  // Without a logo the end is `meta`, else the site name, which goes first when the row is full.
  const label = textOf(p.label)
  const site = textOf(p.site)
  const meta = textOf(p.meta)
  const slots = slotItems(p, { pillSize: PHOTO.fact.size - 2, padX: PHOTO.fact.pill.padX, badgePadX: 12, textSize: PHOTO.fact.size })
  const labelItem: RowItem[] =
    textOf(p.pill) === '' && label !== ''
      ? [
          {
            key: 'label',
            text: label,
            stack: STACK,
            size: PHOTO.fact.size - 2,
            weight: 700,
            padX: PHOTO.fact.pill.padX,
            priority: SLOTS.pill.priority,
          },
        ]
      : []
  const metaItem: RowItem[] =
    meta !== '' && [...meta].length <= SLOTS.meta.maxChars
      ? [{ key: 'meta', text: meta, stack: STACK, size: PHOTO.fact.size, weight: 400, priority: SLOTS.meta.priority }]
      : []
  const nameItem: RowItem[] =
    site === '' || wide
      ? []
      : logoSize
        ? [{ key: 'lockup', text: site, stack: STACK, size: L.nameSize, weight: 700, priority: 6 }]
        : metaItem.length > 0
          ? []
          : [{ key: 'site', text: site, stack: STACK, size: PHOTO.fact.size, weight: 700, priority: 6 }]
  // The logo and the partner are never dropped: their width is taken off the row before the rest is fitted.
  const reserve = logoSize ? logoSize.w + (partnerSize ? gap + partnerSize.w : 0) + gap : 0
  const fitted = rowOf(ctx)([...labelItem, ...slots, ...metaItem, ...nameItem], PHOTO.width - reserve, gap)
  const facts: FootItem[] = []
  const rowY = (h: number) => PHOTO.fact.y + Math.round((PHOTO.fact.height - h) / 2)
  const textFor = (item: RowFit, rect: Rect): FootItem => ({
    ...item,
    rect: place(item.key, rect),
    family: ctx.font(STACK, item.text, item.weight),
    kind: kindOf(item.key),
  })
  // Left: the pills and captions from the start. Right, from the end: meta, then the lockup (logo, partner, name).
  let fx = PHOTO.x
  for (const item of fitted.filter((i) => i.key !== 'meta' && i.key !== 'lockup' && i.key !== 'site')) {
    facts.push(textFor(item, { x: fx, y: PHOTO.fact.y, w: item.width, h: PHOTO.fact.height }))
    fx += item.width + gap
  }
  const right = fitted.filter((i) => i.key === 'meta' || i.key === 'lockup' || i.key === 'site')
  const metaFit = right.find((i) => i.key === 'meta')
  const nameFit = right.find((i) => i.key === 'lockup' || i.key === 'site')
  let rx = PHOTO.x + PHOTO.width
  let logo: Rect | undefined
  let partner: Rect | undefined
  if (nameFit) {
    rx -= nameFit.width
    facts.push({ ...textFor(nameFit, { x: rx, y: PHOTO.fact.y, w: nameFit.width, h: PHOTO.fact.height }), kind: 'text' })
    rx -= gap
  }
  if (partnerSize) {
    rx -= partnerSize.w
    partner = place('partner', { x: rx, y: rowY(partnerSize.h), w: partnerSize.w, h: partnerSize.h })
    rx -= gap
  }
  if (logoSize) {
    rx -= logoSize.w
    logo = place('logo', { x: rx, y: rowY(logoSize.h), w: logoSize.w, h: logoSize.h })
    rx -= gap
  }
  if (metaFit)
    facts.push({ ...textFor(metaFit, { x: rx - metaFit.width, y: PHOTO.fact.y, w: metaFit.width, h: PHOTO.fact.height }), kind: 'text' })

  // Title, bottom-anchored above the facts.
  const hasFacts = facts.length > 0 || logo !== undefined
  const bottom = hasFacts ? PHOTO.fact.y - PHOTO.title.gapAbove : PHOTO.fact.y + PHOTO.fact.height
  const t = ctx.fit(
    textOf(p.title),
    {
      width: PHOTO.width,
      height: 330,
      leading: PHOTO.title.leading,
      tracking: PHOTO.title.tracking,
      balance: true,
      sizes: PHOTO.title.ladder,
      weight: PHOTO.title.weight,
    },
    STACK,
  )
  const h = Math.ceil(t.lines * t.size * PHOTO.title.leading)
  const title = {
    text: t.text,
    size: t.size,
    lines: t.lines,
    rect: place('title', { x: PHOTO.x, y: bottom - h, w: t.width ?? PHOTO.width, h }),
    family: ctx.font(STACK, t.text, PHOTO.title.weight),
  }
  return { logo, partner, title, facts, scrimTop: Math.max(0, bottom - h - PHOTO.scrim.fade), boxes }
}
