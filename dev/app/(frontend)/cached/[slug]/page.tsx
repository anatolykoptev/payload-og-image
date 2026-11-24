import config from '@payload-config'
import { unstable_cache } from 'next/cache.js'
import { OG_SITE_TAG, ogMetadata, ogTag } from 'payload-og-image/next'
import { getPayload } from 'payload'

// No `force-dynamic`: Next renders this page once and serves it from its cache, `og:image` and its `?v` included, until a tag
// it carries is revalidated. `dev/src/og/revalidate.ts` does that from `afterChange`.
type Props = { params: Promise<{ slug: string }> }

// An empty list: no page is built ahead, and each slug is rendered on its first request and then cached.
export const generateStaticParams = () => []

const bySlug = (slug: string) =>
  unstable_cache(
    async () => {
      const payload = await getPayload({ config })
      const { docs } = await payload.find({ collection: 'posts', where: { slug: { equals: slug } }, limit: 1, depth: 0, draft: false, overrideAccess: false })
      return docs[0] ?? null
    },
    ['cached-post', slug],
    { tags: [ogTag('posts', slug), OG_SITE_TAG] },
  )()

export async function generateMetadata({ params }: Props) {
  const doc = await bySlug((await params).slug)
  return { title: doc?.title ?? 'Not found', ...(await ogMetadata({ config, target: 'posts', doc })) }
}

export default async function Page({ params }: Props) {
  const doc = await bySlug((await params).slug)
  return <h1>{doc?.title ?? 'Not found'}</h1>
}
