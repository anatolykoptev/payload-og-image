# Zero config: the built-in presets

Source: `docs/reference.md` (Zero-config presets), `src/presets/`, `src/plugin/index.ts`.

```ts
ogImagePlugin({ siteName: 'Example' }) // serves every public collection; add exclude, or collections: { posts: { preset: 'text' } }, to customise
```

```ts
// app/(frontend)/og/[kind]/[slug]/[file]/route.ts
import config from '@payload-config'
import { createOgRoute } from 'payload-og-image/next'

const route = createOgRoute({ config })
export const GET = route.GET
export const HEAD = GET
```

Pages call `ogMetadata({ config, target: 'posts', doc })` as for any target: the target's name is the collection slug.

## What is covered

With neither `collections` nor `targets`, every collection that is not an upload or auth collection, that an anonymous request may read (`access.read` called at config time answers `true` or a `Where`; none, a throw, a Promise or `false` skips it) and that has a title field the public may read. Skipped ones are named once, with the reason, in one start-up line: read it before concluding a card is missing. `exclude` opts out; `collections` as an object customises; as a list it is exactly those.

## What is detected, and how to override each

| Item     | Detected                                                                                                                                     | Override                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| title    | `admin.useAsTitle`, then `title`, then `name` (text or textarea). None: skipped in discovery, a start-up error when you named the collection | `title: 'field.path'`            |
| hero     | first single upload field named `hero`, `heroImage`, `image`, `cover`, `coverImage`, `featuredImage`; else `meta.image`                      | `hero: 'field.path'`, or `false` |
| label    | `labels.plural`, else the capitalised slug                                                                                                   | `label`                          |
| sub line | none                                                                                                                                         | `subtitle: 'text.field.path'`    |
| slug     | a scalar text `slug` field the public may read; else the path uses `:id`                                                                     | `path` (must hold `:ext`)        |
| preset   | `auto`: photo for a raster hero of at least 800 x 420, text otherwise                                                                        | `preset: 'text'` or `'photo'`    |

The site name is `site()`'s `name` when you give a `site`, else `siteName`, else the `serverURL` host. `site()` may return `logo`, `partnerLogo` and `brandArt` (upload ids or objects with an id); set `logoCollection` when the site has several upload collections. `artOpacity` (0 to 1, default 0.35) is how faint the logo on the right of the text card is. A logo is trimmed and contained, never cropped; SVG logos are read through the plugin's sanitiser (see `docs/reference.md`, Logos).

## Rules

- A photo card is `card.jpg`, a text card `card.png`; the other name is a 404 (the name is read from the request path). A page's `ogMetadata` always advertises the right one.
- `og.mode` behaves as for any target. A forced `photo` with no hero field is a start-up error; a forced `photo` on a document with no usable hero draws the text card.
- Only a field the public may read is detected: never `admin.hidden`, `hidden`, an `access.read` that is not `true` for anonymous, or `hasMany`. Never point `title` at an admin-only field.
- Own `fonts` and `stacks` (with a `default` stack) are used as they are and the bundled Inter is not added, so existing card URLs do not move. Give neither and Inter (latin, latin-ext, cyrillic) is used.
- Nothing you give is overwritten: `site`, `templates`, `targets` (an explicit target of the same name wins; `targets` without `collections` turns discovery off), `store`, `format`, `palette`. With no `store` cards live in memory only: set `store: { dir }` for production. The presets are `payload-og-image:text@2` and `photo@2`; a design change is a revision bump that moves only preset cards.
- Never give a target `overrideAccess: true` reads in props: presets draw the title, label and sub line only, read from the published document.

## Refusals and what each means

| Message                                               | Fix                                           |
| ----------------------------------------------------- | --------------------------------------------- |
| `collection "x" has no title field the card can draw` | set `title` to a text field path              |
| `collections names "x", which is not a collection`    | fix the slug                                  |
| `an auth collection`                                  | cards for users are never offered             |
| `path ... needs :ext`                                 | write the path as `/og/:kind/:slug/card.:ext` |
| `preset 'photo' needs a hero upload field`            | set `hero`, or use `preset: 'auto'`           |
