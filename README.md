# payload-og-image

A [Payload CMS](https://payloadcms.com) plugin that draws Open Graph share cards from your content. Every card
URL carries a version derived from what the card shows, so a changed title or a replaced hero image gives a new
URL and an unchanged one stays cached forever. Finished cards live on disk (or in memory), behind a bounded
render queue, and a crash never leaves a half-written card behind.

**Status:** pre-1.0. The API can still change in a minor release. Every release is published to npm
automatically from this repository, with provenance.

**Compatibility:** Payload `^3.93.0` or `^4.0.0-beta.12` (see [Payload 3 and 4](#payload-3-and-4)), Next.js `^16.4.5`, React `^19.3.1`, sharp `^0.35.4`, Node
`^22.23.5 || ^24.22.3 || >=26.13.1`. ESM only. Node runtime only: edge and serverless platforms need `store: { memory: true }` and are untested.

## Payload 3 and 4

One build serves both majors. The suite, the type check and the dev-app HTTP probe run on the Payload 3 line and on the newest
Payload 4 beta in CI. Payload 4 is a pre-release until it is out, so its range names a beta floor (`^4.0.0-beta.12`) and a
newer beta may still move. On Payload 4: run `payload generate:importmap` after installing (the admin component paths are the
same, the map is per major), use the Node version Payload 4 itself requires (24.22.3 or later), and expect the extra
authorship fields and tables Payload 4 adds to every collection; their migration is your site's, not the plugin's.

The plugin's own Local API calls all state `overrideAccess: false` (the visitor's access, the signed-in editor's for drafts and
previews), so they read the same on both majors. Payload 4 changes the Local API default from `overrideAccess: true` to `false`,
and that reaches **your** code that the plugin calls: inside `options.site({ payload })` (and a target's `props` through `related()`
or your own reads) a call that leaves `overrideAccess` out now runs with no user and the collection's access. State what you mean:

```ts
site: async ({ payload }) => ({
  // trusted site data, the same for every visitor: read it as the system, as Payload 3 did by default
  name: ((await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })).businessName as string) || 'Example',
}),
```

## Install

```sh
pnpm add payload-og-image
```

Keep `fontkit` out of the Next bundle, in `next.config`:

```js
serverExternalPackages: ['fontkit']
```

SVG logos are drawn by `@resvg/resvg-wasm` (a dependency of the plugin), found next to the plugin or from the project's working directory. A server
bundle that cannot reach it (pnpm's strict layout with a bundled plugin) draws the no-logo card: add `@resvg/resvg-wasm` to your own dependencies.

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

**Photo cards.** Cards are PNG by default. For a photo-first card set `format: 'jpeg'` (plugin level, or on one target) and give the
target a `.jpg` path: the same card is about a quarter of the size of the palette PNG on one sample photograph and keeps the photograph's colour. `format: 'webp'` is smaller still
but opt-in, because not every link-preview crawler reads WebP. See [JPEG and WebP cards](docs/reference.md#jpeg-and-webp-cards) and
[crawlers](docs/crawlers.md#image-formats).

## Zero config: the built-in presets

Install the plugin and it serves every public page. No templates, fonts, store or list of collections: one option and one route file.

```ts
ogImagePlugin({ siteName: 'Example' }) // or ogImagePlugin({}): the site name is then the serverURL host
```

```ts
// app/(frontend)/og/[kind]/[slug]/[file]/route.ts
import config from '@payload-config'
import { createOgRoute } from 'payload-og-image/next'

const route = createOgRoute({ config })
export const GET = route.GET
export const HEAD = GET
```

With neither `collections` nor `targets`, the plugin discovers every collection that is not an upload or auth collection, that an anonymous request may read
(its `access.read` is called when the config is built and answers `true` or a `Where`; none, a throw, a Promise or `false` skips it), and that has a title field the
public may read. A collection that is unclear is skipped with one start-up line naming it and the reason; a fresh install always boots. Each collection becomes an ordinary target
built from two named, versioned presets: `payload-og-image:photo@1` (a JPEG: the hero full-bleed with a scrim under the title) and `payload-og-image:text@1`
(a PNG: a dark ground, the site's logo, name and label on the left, the title, and the logo again, whole and faint, on the right). A document whose hero is at least 800 x 420 draws the photo preset, any other the
text preset; the page's `ogMetadata` advertises `card.jpg` or `card.png` accordingly, and the route answers 404 for any other file name, for classic cards too.

With no `serverURL` in the Payload config (a default install) the plugin still boots: card URLs then use `http://localhost:3000` and one start-up line says so; the origin is never taken from a request (a spoofed `Host` would end in a cached page), so set `serverURL` before you deploy.

Everything is optional customisation on top: `exclude: ['internal']` opts a collection out; `collections: { posts: { preset: 'text', label: 'News' } }` customises one
(and adds a collection discovery skipped); a list, `collections: ['posts']`, is exactly those; explicit `targets` win and are untouched (precedence on overlaps: an explicit target of the same name, then `exclude`, then `collections`). Per collection, what is detected and how to override it:
the title (`admin.useAsTitle`, then `title`, then `name`; `title`), the hero (a single upload field named `hero`, `heroImage`, `image`, `cover`, `coverImage` or `featuredImage`, else `meta.image`;
`hero`, or `false` for never a photo), the label (`labels.plural`; `label`), the sub line (none; `subtitle`), the path (`:slug`, or `:id` when
the collection has no `slug` field; `path`, ending in `.:ext`), and `preset: 'text' | 'photo'` to force one. Only fields the public may read are ever detected: not `hidden`,
`admin.hidden`, under such a group, named `_...`, with an `access.read` that does not say `true` to an anonymous request, or `hasMany`.
The site name is `siteName`, else the `serverURL` host. `site()` may return `logo`, `partnerLogo` and `brandArt` (an upload id); `artOpacity` (0 to 1, default 0.35) sets how faint the logo on the right is.
The bundled fonts (Inter 400 and 700, latin, latin-ext and cyrillic; SIL OFL 1.1) are registered only when you give no `fonts` and `stacks`, so a site with
fonts of its own keeps every card URL it has. See [reference](docs/reference.md#zero-config-presets).

## What you get

- `payload-og-image`: `ogImagePlugin`, `defineTemplate`, `defineTarget`, `presets` (the two built-in templates), and `ogFields()` for the optional per-document
  `og` group (mode, headline, subtitle, label, accent; see [reference](docs/reference.md#per-document-share-card-fields)).
- `payload-og-image/client`: the admin's live card preview (`OgPreviewField`), referenced by the `og` group; run
  `payload generate:importmap` after adding the plugin.
- `payload-og-image/next`: `createOgRoute`, `ogMetadata`, `withHead` for Payload's REST route (which does not
  answer HEAD, and LinkedIn sends one), and `ogTag` / `OG_SITE_TAG` for revalidating cached pages on save.
- `payload-og-image/testing`: `installTestRuntime` and `ogKit`, a test kit that calls your real route and metadata
  modules and checks the failures this plugin exists to prevent (a draft cached, a stale version served as
  immutable, a HEAD that differs from GET).
- `payload-og-image/mcp` (`ogImageMcpToolMap`, plugin-mcp 4) and `payload-og-image/mcp/v3` (`ogImageMcpTools`,
  plugin-mcp 3): read-only `og_card`, `og_audit` and `og_preview` tools for `@payloadcms/plugin-mcp`, so an agent can
  check which pages have a card, whether it is stored, and what it looks like (see [reference](docs/reference.md#mcp-tools)).
- `og-parity`, a bin that compares two directories of rendered cards pixel for pixel.

## For AI coding agents

The package ships an [Agent Skill](skills/payload-og-image/SKILL.md) that teaches a coding agent (Claude Code, Codex, Cursor and
others that read the open `SKILL.md` format) to install and configure the plugin: the mental model, a decision checklist, the
per-document fields and migration, the test kit, and a verification routine. Install it in the project, from the installed package:

```sh
mkdir -p .claude/skills
cp -R node_modules/payload-og-image/skills/payload-og-image .claude/skills/
```

Use your agent's own skills folder in place of `.claude/skills/`. Or leave it in `node_modules` and point `AGENTS.md` or `CLAUDE.md`
at `node_modules/payload-og-image/skills/payload-og-image/SKILL.md`. Copy the whole folder: `SKILL.md` loads its `references/` on demand.

## Documentation

Start at [docs/INDEX.md](docs/INDEX.md): [reference](docs/reference.md) (image selection, cache headers, drafts,
the store, the admin preview, the endpoints, the MCP tools), [templates](docs/templates.md), [crawlers](docs/crawlers.md), [operations](docs/operations.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
