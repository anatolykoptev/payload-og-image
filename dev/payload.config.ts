import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import { ogImagePlugin } from 'payload-og-image'
import sharp from 'sharp'
import { postCard } from './src/og/exampleTemplate.js'

// Run from the repository root (`pnpm dev`, `payload run`): `import.meta.url` is not a plain file URL inside Next's RSC layer.
const dirname = path.resolve(process.cwd(), 'dev')
const font = (name: string) => () => readFile(path.resolve(dirname, '../test/fixtures/fonts', name))

// Dev app for the plugin: posts with drafts, one example template, fonts from the OFL test fixtures.
export default buildConfig({
  admin: { importMap: { baseDir: path.resolve(dirname) } },
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
  collections: [
    { slug: 'users', auth: true, fields: [] },
    {
      slug: 'posts',
      versions: { drafts: true },
      access: { read: ({ req: { user } }) => (user ? true : { _status: { equals: 'published' } }) },
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'slug', type: 'text' },
      ],
    },
    { slug: 'media', fields: [], upload: { staticDir: path.resolve(dirname, 'media') } },
  ],
  globals: [{ slug: 'site-settings', access: { read: () => true }, fields: [{ name: 'businessName', type: 'text' }] }],
  db: sqliteAdapter({ client: { url: process.env.DATABASE_URL || 'file:./dev.db' } }),
  editor: lexicalEditor(),
  jobs: { autoRun: [] },
  plugins: [
    ogImagePlugin({
      site: async ({ payload }) => ({ name: ((await payload.findGlobal({ slug: 'site-settings' })).businessName as string) || 'Dev Site' }),
      siteGlobals: ['site-settings'],
      fonts: [{ family: 'Inter', weight: 800, data: font('inter-latin-cyrillic-800.woff') }],
      stacks: { title: ['Inter'], default: ['Inter'] },
      templates: [postCard],
      targets: {
        posts: {
          path: '/og/:kind/:slug/card.png',
          template: 'post',
          props: ({ doc, site }: { doc: { title: string }; site: { name: string } }) => ({
            label: 'Blog',
            title: doc.title,
            site: site.name,
          }),
        },
      },
      store: { memory: true },
    }),
  ],
  secret: process.env.PAYLOAD_SECRET || 'dev-only-secret',
  sharp,
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
})
