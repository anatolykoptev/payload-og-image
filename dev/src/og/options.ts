import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { OgImagePluginInput, OgImagePluginOptions } from 'payload-og-image'
import { postCard } from './exampleTemplate.js'

// Run from the repository root (`pnpm dev`, `payload run`, vitest): `import.meta.url` is not a plain file URL inside Next's RSC layer.
const fonts = path.resolve(process.cwd(), 'test/fixtures/fonts')

export const ogOptions: OgImagePluginOptions = {
  site: async ({ payload }) => ({
    name: ((await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })).businessName as string) || 'Dev Site',
  }),
  siteGlobals: ['site-settings'],
  fonts: [{ family: 'Inter', weight: 800, data: () => readFile(path.join(fonts, 'inter-latin-cyrillic-800.woff')) }],
  stacks: { title: ['Inter'], default: ['Inter'] },
  templates: [postCard],
  targets: {
    posts: {
      path: '/og/:kind/:slug/card.png',
      template: 'post',
      props: ({ doc, site, overrides }: { doc: { title: string }; site: { name: string }; overrides?: { headline?: string } }) => ({
        label: 'Blog',
        title: overrides?.headline ?? doc.title,
        site: site.name,
      }),
      hero: ({ doc }: { doc: { heroImage?: never } }) => doc.heroImage,
    },
  },
  fields: { enabled: true },
  // Production: an absolute path on a volume only the app writes. Without one, cards stay in memory.
  store: process.env.OG_STORE_DIR ? { dir: process.env.OG_STORE_DIR } : { memory: true },
}

/** `OG_DEV_MODE=preset`: zero config. No collections listed: every public collection is served with the bundled fonts, a memory store and the built-in presets. */
export const presetOptions: OgImagePluginInput = {
  siteName: 'Dev Site',
  fields: { enabled: true },
}
