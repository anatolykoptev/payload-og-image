# Per-document `og` fields, admin preview, MCP tools

Source: `docs/reference.md` (sections "Per-document share card fields", "Live preview in the admin", "Endpoints", "MCP tools"), `src/plugin/fields.ts`, `src/mcp/core.ts`.

## Enable the group

```ts
ogImagePlugin({ /* ... */ fields: { enabled: true } }) // group in the sidebar
ogImagePlugin({ /* ... */ fields: { enabled: true, position: 'tab' } }) // a "Share card" tab
```

Off by default; with it off the schema is exactly what it was. Each target's collection gets a top-level group `og`: `mode` (select), `headline`, `subtitle`, `label`, `accent` (text), a hidden number `nonce` and a UI-only "Card preview".

To place it yourself: `import { ogFields } from 'payload-og-image'`, put `ogFields()` in the collection's `fields`, and leave `fields` off. It must be named `og` and sit at the top level (directly, or inside a row, collapsible or unnamed tab). An `og` under a named group (`meta`), an array or a named tab is never read; the plugin warns at start-up. A collection that already has a top-level `og` is not given a second; one with its own `og.mode` is read as is, so its values must be `inherit`, `generated`, `custom`, `off`.

| `og.mode`           | The page advertises                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `inherit` (default) | the editor's image, else `share`, else the generated card (the pre-fields behaviour; mode is not in the version) |
| `generated`         | the generated card even if an eligible editor image exists                                                       |
| `custom`            | the editor's image only; the generated card if it is not eligible                                                |
| `off`               | no `og:image` of its own; a site-wide default in the layout still applies                                        |

`headline` and `subtitle` appear in `props` as `overrides?.headline` and `overrides?.subtitle`. Wire them: `title: overrides?.headline ?? doc.title`. A document with a headline gets its own URL because they go through `props`. `label` and `accent` (a `#rgb`/`#rrggbb` colour, validated in the admin) are the same through `overrides?.label` and `overrides?.accent`; the presets draw both, and an accent too dark for the ground falls back to the ink (`docs/reference.md`, "Per-document share card fields").

## The migration (the site's job)

The fields are columns. After enabling `fields` or placing `ogFields()`: `payload migrate:create`, review, commit the migration with the plugin bump, run it on deploy. A site that already has the group runs it again for the version that adds `label` and `accent` (two text columns). Postgres limits an enum name to 63 characters; the select's is `enum_<collection>_og_mode`, so for a long collection slug set `dbName` on the `mode` field of the group you place (or shorten the slug). Payload 4 also adds authorship columns to every collection; that migration is the site's too.

Then `payload generate:importmap` so the admin finds `payload-og-image/client#OgPreviewField` (needs `@payloadcms/ui`, an optional peer at your Payload's version; on Payload 4 the map is per major).

## Admin preview and "Force new image"

The preview redraws 800 ms after the last edit with plain-language warnings (a character no font draws, mode Off, a custom image that cannot be shared or is under 600x315, a card over 300 KB). It posts to `/api/payload-og-image/preview`, added whenever a target collection carries `og`: signed-in editor only (admin user collection or `editors`), target collections only, unsaved form merged over the saved draft, `no-store`, never stored. "Force new image" adds 1 to `og.nonce`, a new card URL; it is saved with the document, so it reaches the public page on publish. After a change, re-scrape in LinkedIn Post Inspector or Facebook Sharing Debugger.

`GET /api/payload-og-image/stats` (admin only) returns counters, gate, memo and store state: a quick liveness probe for the store (`store.kind`, `store.enabled`).

## MCP tools for agents

For sites running `@payloadcms/plugin-mcp`. The entries only build tool definitions (read-only; the one write is `og_preview` storing a card under its versioned key). Pick by plugin major:

```ts
// @payloadcms/plugin-mcp 3 (Payload 3): an array under mcp.tools; imports zod (add it to dependencies under strict pnpm)
import { ogImageMcpTools } from 'payload-og-image/mcp/v3'
mcpPlugin({ /* collections... */ mcp: { tools: [...ogImageMcpTools({ describedBy: 'meta.description' })] } })

// @payloadcms/plugin-mcp 4 (Payload 4): a map under top-level tools; no zod
import { ogImageMcpToolMap } from 'payload-og-image/mcp'
mcpPlugin({ /* collections... */ tools: { ...ogImageMcpToolMap({ describedBy: 'meta.description' }) } })
```

Options (both): `tools` (`'card' | 'audit' | 'preview'`, default all), `describedBy` (field path of the SEO description `og_audit` checks), `locate(pathname) => { target, slug }` to map public page paths to cards, `maxPreviewBytes` (default 1.5 MiB). Payload 4 only: `access({ req })` (default: any signed-in MCP user). On Payload 3, enable each tool per API key in the admin.

- `og_card`: card URL with version, which target, whether it is stored, size, hero state, and why there is no card. Input: `target` with `id` or `slug`, or `static`, or `path`.
- `og_audit`: no `scope` lists scopes and counts; with a scope, a page of up to 100 rows (URL, stored, size, has a meta description). `checkHeroes` also reads every hero.
- `og_preview`: the card as an image (`mimeType` is the card's); draws through the route's own queue if not stored.

They read what the public route reads: published documents only, never drafts. Use them to confirm a setup from an agent session: `og_audit` for coverage, `og_card` for one page's URL and reason.
