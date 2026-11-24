# Templates

A template turns props into a card. [`dev/src/og/exampleTemplate.tsx`](https://github.com/anatolykoptev/payload-og-image/blob/main/dev/src/og/exampleTemplate.tsx) is a
working one; every snippet below comes from it.

```tsx
export const postCard = defineTemplate<PostCardProps>({
  id: 'post',
  revision: '1',
  required: (p) => p.title.trim() !== '',
  textFields: ['title'],
  stacks: { title: 'title' },
  render: ({ label, title, site }, ctx) => {
    const fit = ctx.fit(title, { width: 1000, height: 380, maxSize: 96, minSize: 44, leading: 1.05, maxLines: 4 }, 'title')
    // ...
  },
})
```

- `id` and `revision` are part of every card's version. Change `revision` with the design, and every cached
  card is drawn again.
- `required` decides whether a card exists at all. A document whose title is empty advertises no image,
  instead of a link to a card that would be blank. It runs after unsupported glyphs are removed from
  `textFields`.
- `textFields` are the string props set as text. Characters that no font in the field's stack can draw are
  removed before layout (and reported as a `glyph_missing` event), so a card never shows empty boxes.
- `size` defaults to 1200x630 and may not exceed 4000 pixels on a side.

## Related documents in props

`props` and `share` receive `{ doc, site, related }`. `doc` is read at depth 0 (relations are bare ids). `await related('authors', doc.author)`
returns the related document if it is published and the visitor may read it, otherwise `null`. Call it for every related
document the card draws: its fields are part of the card's version only through the props you return.

## Everything drawn goes through props

`ctx` has no site data on purpose. The card's URL version is computed from the props, so a site name, a
colour or a label that the template reads from anywhere else would change the card without changing the
URL, and a crawler would keep the old one. Put it in `props`, from the target:

```ts
props: ({ doc, site }) => ({ label: 'Blog', title: doc.title, site: site.name }),
```

Props are plain JSON: strings, finite numbers, booleans, null, arrays, plain objects, and a `Date` (which the
template receives as its ISO string). A `Map`, a class instance or a function throws, naming the field. Type
the template with `Normalized<YourProps>` if the target returns dates.

A template is pure. It fetches nothing; images arrive as `ctx.hero`, a data URL prepared before the render.

## What the renderer draws

Cards are drawn by satori through `next/og`, which supports a subset of CSS:

- flexbox only (`display: 'flex'`); no grid, no `calc()`, no CSS variables.
- Unsupported properties are dropped silently, so look at the card, not the console.
- Fonts must be TTF, OTF or WOFF files. WOFF2 is refused when the plugin starts, naming the family.
- Text has no automatic fitting: use `ctx.fit(text, box, stack)`, which measures with the registered font's own
  advance widths, shrinks the size in steps of 2 until the text fits, and cuts with an ellipsis at `minSize`.

## Fonts and stacks

```ts
fonts: [{ family: 'Inter', weight: 800, data: () => readFile(path.join(fonts, 'inter-latin-cyrillic-800.woff')) }],
stacks: { title: ['Inter'], default: ['Inter'] },
```

A stack is an ordered list of families. `ctx.font(stack, text)` returns the first family with one face that
draws every character of the run, so a Latin title uses the display face and a Cyrillic one falls over to a face
that has Cyrillic, whole. When no single family draws the run (Latin and Cyrillic words, with a Latin-only and a
Cyrillic-only face), it returns the stack's families in order as one `font-family` list (`'Latin, Cyr'`), and each
character is drawn by the first family that has it; `ctx.fit` measures it the same way. A family name may not contain a
comma or a quote. Only characters no family of the stack draws are removed. For a Cyrillic site put a
Cyrillic-covering face in the stack.

### No request leaves the host while a card is drawn

`next/og` downloads a font (the missing characters in the query) or a Twemoji image from a third-party CDN for any
character none of the registered faces has, and has no option to turn that off. The plugin makes the render offline:

- Before drawing, every text child of the element a template returns (not only the `textFields` props, and including a
  character written in the template itself) loses the characters no registered face draws. Each is reported as a
  `glyph_missing` event, and in the editor's preview warnings. Composed forms are used where they exist (`e` + U+0301
  is drawn as `é`), and an accent that a face lacks is dropped from its letter.
- The draw runs with `fetch` refused, as a last line: anything that still tries (a remote `<img src>`, say) makes the card fail
  with a `render_error` that names the host, and the fallback card is served. The version of a card does not change.

A template that needs an emoji or a symbol must draw it with a registered face that has it, or as an `<img>` with a
`data:` URL.

The `default` stack is required: the fallback card and any text field without a stack of its own use it.
At start-up every stack must draw `requiredSample` (default `Aa’‘“”–—…`; add `«»„№₽` for Russian), or the
app refuses to start outside production and logs an error in production.

Swapping a font file changes every card URL (the face bytes are part of the version), as does reordering a stack.
