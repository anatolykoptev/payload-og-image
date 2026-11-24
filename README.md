# payload-og-image

A [Payload CMS](https://payloadcms.com) plugin that draws Open Graph share cards from your content. Every card
URL carries a version derived from what the card shows, so a changed title or a replaced hero image gives a new
URL and an unchanged one stays cached forever. Finished cards live on disk (or in memory), behind a bounded
render queue, and a crash never leaves a half-written card behind.

**Status:** pre-1.0. The API can still change in a minor release. Every release is published to npm
automatically from this repository, with provenance.

**Compatibility:** Payload `^3.93.0`, Next.js `^16.4.5`, React `^19.3.1`, sharp `^0.35.4`, Node
`^22.23.5 || ^24.22.3 || >=26.13.1`. ESM only. Node runtime only: edge and serverless platforms need `store: { memory: true }` and are untested.

## Install

```sh
pnpm add payload-og-image
```

Keep `fontkit` out of the Next bundle, in `next.config`:

```js
serverExternalPackages: ['fontkit']
```

## Use

**1. Register the plugin** with your fonts, one template and one target per collection:

```ts
import { readFile } from 'node:fs/promises'
import { ogImagePlugin } from 'payload-og-image'

export default buildConfig({
  serverURL: 'https://example.com',
  plugins: [
    ogImagePlugin({
      site: async ({ payload }) => ({ name: 'Example' }),
      fonts: [{ family: 'Inter', weight: 800, data: () => readFile('/abs/path/inter-800.woff') }],
      stacks: { title: ['Inter'], default: ['Inter'] },
      templates: [postCard], // made with defineTemplate(), see docs/templates.md
      targets: {
        posts: {
          path: '/og/:kind/:slug/card.png',
          template: 'post',
          props: ({ doc, site }) => ({ label: 'Blog', title: doc.title, site: site.name }),
          hero: ({ doc }) => doc.heroImage,
          heroCollection: 'media', // the upload collection the hero lives in
        },
      },
      store: { dir: '/var/lib/app/og-cards' }, // an absolute path on a volume only the app writes; `{ memory: true }` for tests
    }),
  ],
  // ...
})
```

**2. Add the card route**, `app/(frontend)/og/[kind]/[slug]/card.png/route.ts`:

```ts
import config from '@payload-config'
import { createOgRoute } from 'payload-og-image/next'

export const dynamic = 'force-dynamic'

const route = createOgRoute({ config })
export const GET = route.GET
export const HEAD = GET
```

**3. Put the card in a page's metadata:**

```ts
import { ogMetadata } from 'payload-og-image/next'

export async function generateMetadata({ params }: Props) {
  const doc = await bySlug((await params).slug)
  return { title: doc?.title, ...(await ogMetadata({ config, target: 'posts', doc })) }
}
```

A working Payload + Next app that wires all three is in [`dev/`](dev).

## What you get

- `payload-og-image`: `ogImagePlugin`, `defineTemplate`, `defineTarget`, and `ogFields()` for the optional per-document
  `og` group (mode, headline, subtitle; see [reference](docs/reference.md#per-document-share-card-fields)).
- `payload-og-image/client`: the admin's live card preview (`OgPreviewField`), referenced by the `og` group; run
  `payload generate:importmap` after adding the plugin.
- `payload-og-image/next`: `createOgRoute`, `ogMetadata`, and `withHead` for Payload's REST route (which does not
  answer HEAD, and LinkedIn sends one).
- `payload-og-image/testing`: `installTestRuntime` and `ogKit`, a test kit that calls your real route and metadata
  modules and checks the failures this plugin exists to prevent (a draft cached, a stale version served as
  immutable, a HEAD that differs from GET).
- `og-parity`, a bin that compares two directories of rendered cards pixel for pixel.

## Documentation

Start at [docs/INDEX.md](docs/INDEX.md): [reference](docs/reference.md) (image selection, cache headers, drafts,
the store), [templates](docs/templates.md), [crawlers](docs/crawlers.md), [operations](docs/operations.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
