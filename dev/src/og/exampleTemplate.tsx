import { defineTemplate } from '../../../src/template.js'

export type PostCardProps = { label: string; title: string; site: string }

const HERO_WIDTH = 460

/**
 * An example template (the docs link here). Everything it draws arrives through `props`, so it is part of the
 * card's version; it fetches nothing. `ctx.fit` sizes the title from the registered font's real advance widths.
 * When the target supplies a hero, `ctx.hero` is a ready data URL and the card is drawn with it on the right.
 */
export const postCard = defineTemplate<PostCardProps>({
  id: 'post',
  revision: '1',
  required: (p) => p.title.trim() !== '',
  textFields: ['title'],
  stacks: { title: 'title' },
  heroBox: { width: HERO_WIDTH, height: 630 },
  render: ({ label, title, site }, ctx) => {
    const textWidth = ctx.hero ? 1200 - HERO_WIDTH - 144 : 1000
    const fit = ctx.fit(title, { width: textWidth, height: 380, maxSize: 96, minSize: 44, leading: 1.05, maxLines: 4 }, 'title')
    return (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: '#0d1512', color: '#eef2ee' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flexGrow: 1, padding: 72 }}>
          <div style={{ display: 'flex', fontSize: 28, letterSpacing: '0.08em', color: '#2ed46a', fontFamily: ctx.font('title', label) }}>
            {label}
          </div>
          <div style={{ display: 'flex', fontSize: fit.size, lineHeight: 1.05, fontFamily: ctx.font('title', fit.text) }}>{fit.text}</div>
          <div style={{ display: 'flex', fontSize: 28, color: '#8fa097', fontFamily: ctx.font('title', site) }}>{site}</div>
        </div>
        {/* satori draws a plain <img>; next/image does not apply inside a card */}
        {/* biome-ignore lint/performance/noImgElement: satori renders a plain img */}
        {ctx.hero ? <img src={ctx.hero} width={HERO_WIDTH} height={630} alt="" /> : null}
      </div>
    )
  },
})
