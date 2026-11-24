import { defineTemplate, type Template } from '../template.js'

export type Brand = { ink?: string; paper?: string }

/** The card served when a card cannot be drawn: the site name, centred. Uses the `default` font stack. */
export function createFallbackTemplate(brand: Brand = {}): Template<{ site: string }> {
  const ink = brand.ink ?? '#111111'
  const paper = brand.paper ?? '#f4f4f0'
  return defineTemplate<{ site: string }>({
    id: 'payload-og-image:fallback',
    revision: '1',
    textFields: ['site'],
    stacks: { site: 'default' },
    render: ({ site }, ctx) => {
      const fit = ctx.fit(site, { width: 1000, height: 300, maxSize: 96, minSize: 36, leading: 1.1, maxLines: 2 }, 'default')
      return (
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            background: paper,
            color: ink,
          }}
        >
          <div
            style={{
              display: 'flex',
              width: 1000,
              textAlign: 'center',
              justifyContent: 'center',
              fontFamily: ctx.font('default', fit.text),
              fontSize: fit.size,
              lineHeight: 1.1,
            }}
          >
            {fit.text}
          </div>
        </div>
      )
    },
  })
}

export const fallbackTemplate: Template<{ site: string }> = createFallbackTemplate()
