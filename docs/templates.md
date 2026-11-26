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
- `size` defaults to 1200x630 and may not exceed 4000 pixels on a side. Keep text and logos inside the safe zone of the [share image specification](share-image-spec.md#2-safe-zones).

## Related documents in props

`props` and `share` receive `{ doc, site, related }`. `doc` is read at depth 0 (relations are bare ids). `await related('authors', doc.author)`
returns the related document if it is published and the visitor may read it, `null` if it is missing, unpublished or forbidden, and rejects when the read itself fails (a database error). Do not catch that rejection: the route then answers 503 without storing anything and the next request draws the card from the real data, where a caught error would store a card without the related document under a new immutable URL. Call it for every related
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

A template is pure. It fetches nothing; images arrive as `ctx.hero`, a data URL prepared before the render, and as `ctx.images`, an object of data URL lists, one list for each name the target gave in `images` (declare each name's box in the template's `imageBoxes`; see [reference](reference.md#several-images-per-card)).

## What the renderer draws

Cards are drawn by satori through `next/og`, which supports a subset of CSS:

- flexbox only (`display: 'flex'`); no grid, no `calc()`, no CSS variables.
- Unsupported properties are dropped silently, so look at the card, not the console.
- Fonts must be TTF, OTF or WOFF files. WOFF2 is refused when the plugin starts, naming the family.
- Text has no automatic fitting: use `ctx.fit(text, box, stack)`, which measures with the registered font's own
  advance widths, shrinks the size in steps of 2 until the text fits, and cuts with an ellipsis at `minSize`.
  A design that sets its title from a fixed ladder can say so in the box instead of keeping its own fitter; every option
  below is opt-in, and a box without them measures and answers exactly as before:

  ```ts
  const fit = ctx.fit(title, {
    width: 1000, height: 380, leading: 0.98,
    sizes: [104, 96, 88, [80, 3], [72, 3], 60, 50, 42], // largest first; [size, maxLines] caps the lines a size may take
    tracking: -0.02,    // em, added to every character's advance (set the same `letterSpacing` on the text)
    descent: 0.14,      // em kept under the last line, so a descender is never cut
    fewerLines: true,   // take the next size down when it needs fewer lines (a lone last word, or one line fewer)
    balance: true,      // also answer `width`: the narrowest width that keeps the line count; set it as the text block's width
  }, 'title')
  ```

  With `sizes`, `maxSize` and `minSize` are not needed; the last size is where a text that still does not fit is cut with an
  ellipsis. Changing a ladder changes the card, so bump the template's `revision`.

## Alt text and the hero's ground, per target

`alt` on a target is the card's alt text, as the page advertises it (`og:image:alt`), from the props the template draws; a
static card takes a string or the same function. The default stays `<label>: <title>`, and an empty answer takes it. It is
not drawn, so it is not part of a card's URL.

`heroBackground` on a target or a template flattens that card's transparent hero onto the colour (`#rgb` or `#rrggbb`); the
target's wins over the template's, which wins over the plugin's. A card that sets one is versioned by it like the
plugin's option, only when it is set.

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

(The one read before the draw is a hero from a host you list in `allowedImageHosts`; that option is empty by default.)

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

## Using the built-in presets in your own target

`presets.text` and `presets.photo` (from `payload-og-image`) are ordinary templates. Register them in `templates`, then point a target at them with props
`{ title, subtitle?, label?, site, byline?, artOpacity?, pill?, pill2?, badge?, caption?, meta? }`; the text preset takes the images `logo`, `partner`, `mark` and `art`, the photo preset `logo` and `partner` (the zero-config targets feed them from `site()`; see [reference](reference.md#zero-config-presets)).
`ctx.fitRow(items, width, gap?)` is available to any template: it lays a row out and drops whole items, the highest `priority` first, never cutting one (priority 0 stays). A template may set
`format` (`'png' | 'jpeg' | 'webp'`); a target's own `format` wins, and a path with `:ext` takes its extension from the result.

`Template.imageShapes` (contain, trim, key, contrast tint, aspect) and `Template.heroColours` change what a card draws without changing its props: a change to either needs a bump of the template's `revision`, or the old URLs keep serving the old bytes.
