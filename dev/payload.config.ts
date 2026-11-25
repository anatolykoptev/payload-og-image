import path from 'node:path'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import { ogImagePlugin } from 'payload-og-image'
import sharp from 'sharp'
import { ogOptions } from './src/og/options.js'
import { revalidateDeletedPost, revalidatePost, revalidateSite } from './src/og/revalidate.js'

// Run from the repository root (`pnpm dev`, `payload run`): `import.meta.url` is not a plain file URL inside Next's RSC layer.
const dirname = path.resolve(process.cwd(), 'dev')

// Dev app for the plugin: posts with drafts, one example template, fonts from the OFL test fixtures.
export default buildConfig({
  admin: { importMap: { baseDir: path.resolve(dirname), importMapFile: path.resolve(dirname, 'app/(payload)/admin/importMap.js') } },
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
  collections: [
    { slug: 'users', auth: true, fields: [] },
    {
      slug: 'posts',
      versions: { drafts: true },
      hooks: { afterChange: [revalidatePost], afterDelete: [revalidateDeletedPost] },
      access: { read: ({ req: { user } }) => (user ? true : { _status: { equals: 'published' } }) },
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'slug', type: 'text' },
        { name: 'heroImage', type: 'upload', relationTo: 'media' },
      ],
    },
    // Public: a crawler fetches an editor-chosen share image without a login.
    { slug: 'media', access: { read: () => true }, fields: [], upload: { staticDir: path.resolve(dirname, 'media') } },
  ],
  globals: [
    {
      slug: 'site-settings',
      access: { read: () => true },
      hooks: { afterChange: [revalidateSite] },
      fields: [{ name: 'businessName', type: 'text' }],
    },
  ],
  db: sqliteAdapter({ client: { url: process.env.DATABASE_URL || 'file:./dev.db' } }),
  editor: lexicalEditor(),
  jobs: { autoRun: [] },
  plugins: [ogImagePlugin(ogOptions)],
  secret: process.env.PAYLOAD_SECRET || 'dev-only-secret',
  // Payload 4 removed the top-level `sharp` option and throws on the key even when it is undefined; the v4 CI job sets PAYLOAD_MAJOR=4.
  ...(process.env.PAYLOAD_MAJOR === '4' ? {} : { sharp }),
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
})
