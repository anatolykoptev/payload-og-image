import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { OgImagePluginOptions } from 'payload-og-image'
import { postCard } from './exampleTemplate.js'

// Run from the repository root (`pnpm dev`, `payload run`, vitest): `import.meta.url` is not a plain file URL inside Next's RSC layer.
const fonts = path.resolve(process.cwd(), 'test/fixtures/fonts')

export const ogOptions: OgImagePluginOptions = {
  site: async ({ payload }) => ({ name: ((await payload.findGlobal({ slug: 'site-settings' })).businessName as string) || 'Dev Site' }),
  siteGlobals: ['site-settings'],
  fonts: [{ family: 'Inter', weight: 800, data: () => readFile(path.join(fonts, 'inter-latin-cyrillic-800.woff')) }],
  stacks: { title: ['Inter'], default: ['Inter'] },
  templates: [postCard],
  targets: {
    posts: {
      path: '/og/:kind/:slug/card.png',
      template: 'post',
      props: ({ doc, site }: { doc: { title: string }; site: { name: string } }) => ({ label: 'Blog', title: doc.title, site: site.name }),
      hero: ({ doc }: { doc: { heroImage?: never } }) => doc.heroImage,
    },
  },
  // Production: an absolute path on a volume only the app writes. Without one, cards stay in memory.
  store: process.env.OG_STORE_DIR ? { dir: process.env.OG_STORE_DIR } : { memory: true },
}
