import config from '@payload-config'
import { createOgRoute } from 'payload-og-image/next'

export const dynamic = 'force-dynamic'

const route = createOgRoute({ config })
export const GET = route.GET
// Next would answer HEAD from GET; exporting it keeps the intent visible.
export const HEAD = GET
