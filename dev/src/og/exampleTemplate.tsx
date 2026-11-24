import { defineTemplate } from '../../../src/template.js'

export type PostCardProps = { label: string; title: string; site: string }

/**
 * An example template (the docs link here). Everything it draws arrives through `props`, so it is part of the
 * card's version; it fetches nothing. `ctx.fit` sizes the title from the registered font's real advance widths.
 */
export const postCard = defineTemplate<PostCardProps>({
  id: 'post',
  revision: '1',
  required: (p) => p.title.trim() !== '',
  textFields: ['title'],
  stacks: { title: 'title' },
  render: ({ label, title, site }, ctx) => {
    const fit = ctx.fit(title, { width: 1000, height: 380, maxSize: 96, minSize: 44, leading: 1.05, maxLines: 4 }, 'title')
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '100%',
          height: '100%',
          padding: 72,
          background: '#0d1512',
          color: '#eef2ee',
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, letterSpacing: '0.08em', color: '#2ed46a', fontFamily: ctx.font('title', label) }}>
          {label}
        </div>
        <div style={{ display: 'flex', fontSize: fit.size, lineHeight: 1.05, fontFamily: ctx.font('title', fit.text) }}>{fit.text}</div>
        <div style={{ display: 'flex', fontSize: 28, color: '#8fa097', fontFamily: ctx.font('title', site) }}>{site}</div>
      </div>
    )
  },
})
