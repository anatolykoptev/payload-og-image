// biome-ignore-all lint/performance/noImgElement: the card is drawn by satori, which has no next/image
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { defineTemplate, type Template, type TemplateContext } from '../template.js'
import {
  accentOf,
  type FootItem,
  normalizeSlots,
  type PhotoLayout,
  type PresetProps,
  photoLayout,
  type Rect,
  type TextLayout,
  textLayout,
} from './layout.js'
import {
  CARD,
  COLOURS,
  IMAGE_BOXES,
  PHOTO,
  PHOTO_ID,
  PHOTO_IMAGE_BOXES,
  PHOTO_SHAPES,
  REVISION,
  TEXT,
  TEXT_ID,
  TEXT_SHAPES,
} from './spec.js'

export type { PresetProps }

const TEXT_FIELDS: (keyof PresetProps & string)[] = [
  'title',
  'subtitle',
  'label',
  'site',
  'byline',
  'pill',
  'pill2',
  'badge',
  'caption',
  'meta',
]
/** Every text prop is set in the `default` stack: a site's own stack named `title` must not capture a preset's field of that name. */
const STACKS = Object.fromEntries(TEXT_FIELDS.map((f) => [f, 'default']))

const rgba = (hex: string, a: number) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
const abs = (r: Rect): CSSProperties => ({ display: 'flex', position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h })
const single = (v: readonly string[] | undefined) => v?.[0] as string

const Root = (c: { children: ReactNode; ground: string }) => (
  <div style={{ display: 'flex', position: 'relative', width: CARD.width, height: CARD.height, background: c.ground, overflow: 'hidden' }}>
    {c.children}
  </div>
)

const line = (r: Rect, family: string, size: number, color: string, extra: CSSProperties = {}): CSSProperties => ({
  ...abs(r),
  alignItems: 'center',
  whiteSpace: 'nowrap',
  fontFamily: family,
  fontSize: size,
  lineHeight: 1,
  color,
  ...extra,
})

function Pill(c: { item: FootItem; photo: boolean; accent: string }): ReactElement {
  const { item, photo, accent } = c
  const base = {
    ...abs(item.rect),
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
    fontFamily: item.family,
    fontSize: item.size,
    lineHeight: 1,
  } as CSSProperties
  if (item.kind === 'badge')
    return (
      <div
        style={{
          ...base,
          border: `2px solid ${photo ? '#ffffff' : accent}`,
          borderRadius: 8,
          color: photo ? '#ffffff' : accent,
          fontWeight: 700,
        }}
      >
        {item.text}
      </div>
    )
  if (item.key === 'pill2' || item.key === 'label')
    return (
      <div
        style={{
          ...base,
          borderRadius: item.rect.h / 2,
          background: photo ? 'rgba(255, 255, 255, 0.18)' : rgba(COLOURS.ink, 0.1),
          color: photo ? '#ffffff' : COLOURS.ink,
          fontWeight: 700,
        }}
      >
        {item.text}
      </div>
    )
  return (
    <div
      style={{
        ...base,
        borderRadius: item.rect.h / 2,
        background: photo ? '#ffffff' : accent,
        color: COLOURS.ground,
        fontWeight: 700,
      }}
    >
      {item.text}
    </div>
  )
}

function TextRow(c: { item: FootItem; photo: boolean }): ReactElement {
  const { item, photo } = c
  const color = photo
    ? item.key === 'lockup'
      ? `rgba(255, 255, 255, ${PHOTO.lockup.nameOpacity})`
      : 'rgba(255, 255, 255, 0.8)'
    : COLOURS.muted
  return (
    <div
      style={line(item.rect, item.family, item.size, color, {
        fontWeight: item.weight ?? 400,
        ...(item.key === 'meta' ? { justifyContent: 'flex-end' } : {}),
      })}
    >
      {item.text}
    </div>
  )
}

const footEl = (item: FootItem, photo: boolean, accent: string) =>
  item.kind === 'text' ? (
    <TextRow key={item.key} item={item} photo={photo} />
  ) : (
    <Pill key={item.key} item={item} photo={photo} accent={accent} />
  )

const img = (src: string | undefined, r: Rect | undefined) =>
  src && r ? <img src={src} width={r.w} height={r.h} style={{ position: 'absolute', left: r.x, top: r.y }} alt="" /> : undefined

/** The text layout drawn. Also what a photo card draws when its photograph could not be prepared. */
function drawText(p: PresetProps, ctx: TemplateContext): ReactElement {
  const l: TextLayout = textLayout(p, ctx)
  const accent = accentOf(p)
  const art = l.art === 'art' ? single(ctx.images.art) : undefined
  const mark = l.art === 'mark' ? single(ctx.images.mark) : undefined
  return (
    <Root ground={COLOURS.ground}>
      {art && (
        <img
          src={art}
          width={IMAGE_BOXES.art.width}
          height={IMAGE_BOXES.art.height}
          style={{ position: 'absolute', left: TEXT.artX, top: 0 }}
          alt=""
        />
      )}
      {mark && l.mark && (
        // satori ignores `opacity` on an <img>, so the faint logo is an image in a box that has it
        <div style={{ ...abs(l.mark), opacity: p.artOpacity ?? TEXT.art.opacity }}>
          <img src={mark} width={l.mark.w} height={l.mark.h} alt="" />
        </div>
      )}
      {img(single(ctx.images.logo), l.logo)}
      {img(single(ctx.images.partner), l.partner)}
      {l.name && (
        <div style={line(l.name.rect, l.name.family, l.name.size, COLOURS.ink, { fontWeight: 700, letterSpacing: '-0.01em' })}>
          {l.name.text}
        </div>
      )}
      {l.rule && <div style={{ ...abs(l.rule), background: rgba(COLOURS.ink, 0.22) }} />}
      {l.label && <div style={line(l.label.rect, l.label.family, l.label.size, COLOURS.muted)}>{l.label.text}</div>}
      <div
        style={{
          ...abs(l.title.rect),
          fontFamily: l.title.family,
          fontSize: l.title.size,
          fontWeight: TEXT.title.weight,
          lineHeight: TEXT.title.leading,
          letterSpacing: `${TEXT.title.tracking}em`,
          color: COLOURS.ink,
        }}
      >
        {l.title.text}
      </div>
      {l.sub && (
        <div
          style={{
            ...abs(l.sub.rect),
            fontFamily: l.sub.family,
            fontSize: TEXT.sub.size,
            lineHeight: TEXT.sub.leading,
            color: COLOURS.muted,
          }}
        >
          {l.sub.text}
        </div>
      )}
      {l.foot.map((i) => footEl(i, false, accent))}
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: CARD.width,
          height: TEXT.strip.height,
          background: rgba(accent, TEXT.strip.opacity),
        }}
      />
    </Root>
  )
}

function drawPhoto(p: PresetProps, ctx: TemplateContext): ReactElement {
  // The hero could not be prepared (the card is then served briefly and never stored): the text layout, in the same template.
  if (!ctx.hero) return drawText(p, ctx)
  const l: PhotoLayout = photoLayout(p, ctx)
  const S = PHOTO.scrim
  const height = CARD.height - l.scrimTop
  const stops = [...S.stops.map(([px, a]) => `${rgba(COLOURS.ground, a)} ${px}px`), `${rgba(COLOURS.ground, S.peak)} ${height}px`].join(
    ', ',
  )
  return (
    <Root ground={COLOURS.ground}>
      <img src={ctx.hero} width={CARD.width} height={CARD.height} style={{ position: 'absolute', left: 0, top: 0 }} alt="" />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: l.scrimTop,
          width: CARD.width,
          height,
          background: `linear-gradient(to bottom, ${stops})`,
        }}
      />
      <div
        style={{
          ...abs(l.title.rect),
          fontFamily: l.title.family,
          fontSize: l.title.size,
          fontWeight: PHOTO.title.weight,
          lineHeight: PHOTO.title.leading,
          letterSpacing: `${PHOTO.title.tracking}em`,
          color: '#ffffff',
          textShadow: '0 2px 14px rgba(0, 0, 0, 0.35)',
        }}
      >
        {l.title.text}
      </div>
      {l.facts.map((i) => footEl(i, true, accentOf(p)))}
      {img(single(ctx.images.logo), l.logo)}
      {img(single(ctx.images.partner), l.partner)}
    </Root>
  )
}

const common = {
  revision: REVISION,
  size: { width: CARD.width, height: CARD.height },
  textFields: TEXT_FIELDS,
  stacks: STACKS,
  normalize: normalizeSlots,
  required: (p: PresetProps) => typeof p.title === 'string' && p.title.trim() !== '',
}

/** `payload-og-image:text@1`: the brand format on a dark ground (PNG). */
export const textPreset: Template<PresetProps> = defineTemplate<PresetProps>({
  ...common,
  id: TEXT_ID,
  format: 'png',
  imageBoxes: { logo: IMAGE_BOXES.logo, partner: IMAGE_BOXES.partner, mark: IMAGE_BOXES.mark, art: IMAGE_BOXES.art },
  imageShapes: { ...TEXT_SHAPES },
  render: drawText,
})

/** `payload-og-image:photo@1`: a full-bleed hero with a scrim under the words (JPEG). A transparent hero is flattened onto the ground. */
export const photoPreset: Template<PresetProps> = defineTemplate<PresetProps>({
  ...common,
  id: PHOTO_ID,
  format: 'jpeg',
  heroBackground: COLOURS.ground,
  imageBoxes: { ...PHOTO_IMAGE_BOXES },
  imageShapes: { ...PHOTO_SHAPES },
  heroColours: false, // truecolour: a palette PNG shows as a cross-hatch on a smooth sky
  render: drawPhoto,
})
