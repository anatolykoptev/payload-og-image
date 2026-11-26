# Writing a template

Source: `docs/templates.md`, `src/template.ts`, and the working template [`dev/src/og/exampleTemplate.tsx`](https://github.com/anatolykoptev/payload-og-image/blob/main/dev/src/og/exampleTemplate.tsx) in the repository (`dev/` is not in the npm package; the example below is self-contained).

```tsx
import { defineTemplate } from 'payload-og-image'

type PostCardProps = { label: string; title: string; site: string }

export const postCard = defineTemplate<PostCardProps>({
  id: 'post', // part of every version
  revision: '1', // bump with the design: every cached card is drawn again
  required: (p) => p.title.trim() !== '', // false = the page advertises no image
  textFields: ['title'], // string props set as text: unsupported glyphs are stripped before layout
  stacks: { title: 'title' }, // field -> stack name. Lookup per text field: this mapping, else the stack named like the field, else `default`
  heroBox: { width: 460, height: 630 },
  render: ({ label, title, site }, ctx) => {
    const fit = ctx.fit(title, { width: ctx.hero ? 596 : 1000, height: 380, maxSize: 96, minSize: 44, leading: 1.05, maxLines: 4 }, 'title')
    return (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: '#0d1512', color: '#eef2ee' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flexGrow: 1, padding: 72 }}>
          <div style={{ display: 'flex', fontSize: 28, fontFamily: ctx.font('title', label) }}>{label}</div>
          <div style={{ display: 'flex', fontSize: fit.size, lineHeight: 1.05, fontFamily: ctx.font('title', fit.text) }}>{fit.text}</div>
          <div style={{ display: 'flex', fontSize: 28, fontFamily: ctx.font('title', site) }}>{site}</div>
        </div>
        {ctx.hero ? <img src={ctx.hero} width={460} height={630} alt="" /> : null}
      </div>
    )
  },
})
```

This is the shape of [`dev/src/og/exampleTemplate.tsx`](https://github.com/anatolykoptev/payload-og-image/blob/main/dev/src/og/exampleTemplate.tsx), the working version.

## Rules

- **Everything drawn goes through props.** `ctx` has no site data on purpose. A name, colour or label read from anywhere else changes the card without changing its URL and crawlers keep the old one. Put it in `props` from the target.
- A template is pure: no fetch, no clock, no random. Images arrive as `ctx.hero`, a data URL prepared before the render (or `null`). Other images must be `data:` URLs.
- `size` defaults to 1200x630, at most 4000 px a side. `heroBox` sets the hero's box.
- **CSS subset** (satori through `next/og`): flexbox only (`display: 'flex'` on any element with several children), no grid, no `calc()`, no CSS variables. Unsupported properties are dropped silently: look at the card, not the console. `kit.templatesRender` catches a `div` with several children and no flex.
- **Text does not auto-fit.** Use `ctx.fit(text, box, stack)`; it measures with the face's own advances, shrinks in steps of 2 and ends with an ellipsis at `minSize`. Opt-in box options: `sizes` ladder (with `[size, maxLines]` entries), `tracking`, `descent`, `fewerLines`, `balance`. Changing a ladder changes the card: bump `revision`.
- **Fonts**: only TTF, OTF or WOFF; WOFF2 is refused at start-up naming the family. A stack is an ordered list of families; `ctx.font(stack, text)` returns the first family that draws the whole run, else the list as one `font-family`. A family name may not contain a comma or quote. Swapping a font file or reordering a stack changes every card URL.
- **No emoji or symbol outside the registered faces.** `next/og` would fetch a CDN font or Twemoji; the plugin makes the render offline: unsupported characters are stripped and reported as `glyph_missing`, and a remote `<img>` fails the draw (fallback card, `render_error` naming the host). Draw a symbol with a registered face that has it, or a `data:` image.
- **Start-up check**: every stack must draw `requiredSample` (default `Aa’‘“”–—…`). Add the glyphs the site needs, for example `«»„№₽` for Russian. Outside production the app refuses to start; in production it logs an error. The plugin also draws the brand fallback card at boot.
- **Fonts in Next**: build paths from `process.cwd()` (`path.join(process.cwd(), 'assets/fonts', name)`), not `new URL(..., import.meta.url)`. A `output: 'standalone'` build needs `outputFileTracingIncludes: { '/**': ['./assets/fonts/**'] }` so the fonts are copied.

## Alt text and hero ground

- `alt` on a target (or static card) is `og:image:alt`; default `<label>: <title>` from props. Not part of the URL.
- `heroBackground` on a target or template flattens a transparent hero; target wins over template over plugin.
