import config from '@payload-config'
import { ogMetadata } from 'payload-og-image/next'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

const bySlug = async (slug: string) => {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'posts', where: { slug: { equals: slug } }, limit: 1, depth: 0, draft: false, overrideAccess: false })
  return docs[0]
}

// Next 16.4.6, measured in this app: a page component's `params` arrive percent-encoded ("a%25b"), while
// `generateMetadata` params and a route handler's params arrive already decoded ("a%b"). Decode in the page
// component only: decoding the others again throws on a literal "%".
export async function generateMetadata({ params }: Props) {
  const doc = await bySlug((await params).slug)
  return { title: doc?.title ?? 'Not found', ...(await ogMetadata({ config, target: 'posts', doc })) }
}

export default async function Page({ params }: Props) {
  const doc = await bySlug(decodeURIComponent((await params).slug))
  return <h1>{doc?.title ?? 'Not found'}</h1>
}
