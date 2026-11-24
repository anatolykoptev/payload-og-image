import type { KitDocs } from 'payload-og-image/testing'

export const docs: KitDocs = {
  published: {
    posts: [
      { id: 1, slug: 'a', title: 'Alpha' },
      { id: 2, slug: 'hero', title: 'A post with a hero', heroImage: { id: 9, url: '/media/h.jpg', filename: 'h.jpg', updatedAt: 'u1' } },
      {
        id: 3,
        slug: 'hero-missing-file',
        title: 'Its hero file is gone',
        heroImage: { id: 10, url: '/media/x.jpg', filename: 'missing.jpg', updatedAt: 'u1' },
      },
      { id: 4, slug: 'a%b', title: 'A slug that needs encoding' },
      ...Array.from({ length: 60 }, (_, i) => ({ id: 100 + i, slug: `cold-${i}`, title: `Cold ${i}` })),
    ],
  },
  drafts: { posts: [{ id: 1, slug: 'a', title: 'Alpha, a draft' }] },
  globals: { 'site-settings': { businessName: 'Dev Site' } },
}
