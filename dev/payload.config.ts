import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import sharp from 'sharp'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Dev app for the plugin. The plugin itself is wired in by the task that ships `ogImagePlugin`.
export default buildConfig({
  admin: { importMap: { baseDir: path.resolve(dirname) } },
  collections: [
    {
      slug: 'posts',
      versions: { drafts: true },
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'slug', type: 'text' },
      ],
    },
    { slug: 'media', fields: [], upload: { staticDir: path.resolve(dirname, 'media') } },
  ],
  db: sqliteAdapter({ client: { url: process.env.DATABASE_URL || 'file:./dev.db' } }),
  editor: lexicalEditor(),
  jobs: { autoRun: [] },
  secret: process.env.PAYLOAD_SECRET || 'dev-only-secret',
  sharp,
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
})
