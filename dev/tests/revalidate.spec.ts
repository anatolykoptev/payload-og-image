/** The dev app's save hooks, taken from its REAL config, with Next's cache replaced by a spy. Vitest has no Next page cache:
 * that a cached page then shows the new `og:image` over HTTP is proven by `scripts/probe-dev-server.mjs` (a built app under `next start`).
 * - dev/payload.config.ts:22  leave `revalidatePost` out of the posts collection's `afterChange` -> "saving a published post expires the tag of its page" RED
 * - dev/payload.config.ts:37  leave `revalidateSite` out of the site global's `afterChange` -> "saving a site global expires every page that draws site data" RED
 * - dev/src/og/revalidate.ts:15  revalidate with another tag than `ogTag('posts', slug)` -> the same post test RED */
import config from '@payload-config'
import { OG_SITE_TAG, ogTag } from 'payload-og-image/next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }))
vi.mock('next/cache.js', () => ({ revalidateTag }))

const sanitized = await config
const hooksOf = (kind: 'collections' | 'globals', slug: string) =>
  (sanitized[kind] as Array<{ slug: string; hooks: { afterChange: Array<(a: any) => unknown> } }>).find((c) => c.slug === slug)?.hooks
    .afterChange ?? []
const save = async (hooks: Array<(a: any) => unknown>, args: object, context: Record<string, unknown> = {}) => {
  for (const h of hooks) await h({ req: { context }, ...args })
}

beforeEach(() => revalidateTag.mockClear())

describe('dev app save hooks', () => {
  it('saving a published post expires the tag of its page, now', async () => {
    await save(hooksOf('collections', 'posts'), {
      doc: { slug: 'a', _status: 'published' },
      previousDoc: { slug: 'a', _status: 'published' },
    })
    expect(revalidateTag).toHaveBeenCalledWith(ogTag('posts', 'a'), { expire: 0 })
  })
  it('a renamed slug expires the old page too; a never-published document and a script outside Next expire nothing', async () => {
    const hooks = hooksOf('collections', 'posts')
    await save(hooks, { doc: { slug: 'b', _status: 'published' }, previousDoc: { slug: 'a', _status: 'published' } })
    expect(revalidateTag.mock.calls.map((c) => c[0]).sort()).toEqual([ogTag('posts', 'a'), ogTag('posts', 'b')])
    revalidateTag.mockClear()
    await save(hooks, { doc: { slug: 'c', _status: 'draft' }, previousDoc: undefined })
    await save(hooks, { doc: { slug: 'd', _status: 'published' }, previousDoc: undefined }, { disableRevalidate: true })
    expect(revalidateTag).not.toHaveBeenCalled()
  })
  it('saving a site global expires every page that draws site data', async () => {
    await save(hooksOf('globals', 'site-settings'), { doc: { businessName: 'X' } })
    expect(revalidateTag).toHaveBeenCalledWith(OG_SITE_TAG, { expire: 0 })
  })
})
