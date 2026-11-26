import config from '@payload-config'
import { createOgRoute } from 'payload-og-image/next'

export const dynamic = 'force-dynamic'

// `OG_DEV_MODE=preset`: one route serves both formats (`card.png`, `card.jpg`); the file name is checked against the request path.
const route = createOgRoute({ config })
export const GET = route.GET
export const HEAD = GET
