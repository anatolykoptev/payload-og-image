// `PAYLOAD_CONFIG_PATH=dev/payload.config.ts payload run dev/seed.ts`: a published post whose slug needs encoding.
import config from '@payload-config'
import { getPayload } from 'payload'

const payload = await getPayload({ config })
await payload.create({ collection: 'posts', data: { title: 'Привет, a%b', slug: 'a%b', _status: 'published' } })
await payload.create({ collection: 'posts', data: { title: 'Plain post', slug: 'plain', _status: 'published' } })
console.log('seeded')
process.exit(0)
