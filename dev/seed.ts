// `PAYLOAD_CONFIG_PATH=dev/payload.config.ts payload run dev/seed.ts`: published posts: one whose slug needs encoding, a plain one, and one a cached page shows.

import { getPayload } from 'payload'
import config from './payload.config.js'

const payload = await getPayload({ config })
// `disableRevalidate`: the save hooks call Next's cache, which a script outside Next has not got.
const context = { disableRevalidate: true }
await payload.create({
  collection: 'posts',
  data: { title: 'Привет, a%b', slug: 'a%b', _status: 'published' },
  context,
  overrideAccess: true,
})
await payload.create({
  collection: 'posts',
  data: { title: 'Plain post', slug: 'plain', _status: 'published' },
  context,
  overrideAccess: true,
})
await payload.create({
  collection: 'posts',
  data: { title: 'Cached post', slug: 'cached', _status: 'published' },
  context,
  overrideAccess: true,
})
console.log('seeded')
process.exit(0)
