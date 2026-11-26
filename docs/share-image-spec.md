# Share image specification

The one specification every share card and every agent that makes or changes one must conform to: what the platforms
require, what each of them crops, the zone the plugin keeps text inside, the design of the two built-in presets, which image goes
where, and the checklist to run before a design ships. "Must" is binding; "should" has a reason you can name when you break it.

Two kinds of fact live here, and they are kept apart on purpose:

- **Design constants** (sizes, ladders, the safe zone, colours, the revision) come from `src/presets/spec.ts`. They sit between
  `<!-- spec:... -->` markers, are written by `pnpm docs:spec`, and a test fails when a block is stale. Do not edit a block by hand and do
  not copy its numbers into prose elsewhere: name the constant, or link to this file.
- **Platform rules** are external facts, written by hand with a source and a date. Where a platform says nothing, the cell says
  "undocumented", never a guess. A number from a third-party guide is marked as such.

Last researched 2026-11-25. Platforms change these pages without notice: re-read the source before relying on a number for money.

## 1. Platform rules

Aspect ratios and sizes are for the link-share image (`og:image` with `twitter:card` set to `summary_large_image`). "Undocumented" means the
platform's own pages say nothing and we found no first-hand test; "secondary" means a third-party guide, not the platform.

| Platform                | Aspect, recommended size                                                 | Minimum                                                                 | Largest file                     | Formats                                                                        | What is cropped, and how                                                                                              |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Facebook and Meta       | 1.91:1; at least 1200 x 630                                              | 200 x 200 allowed; 600 x 315 for the large layout                       | 8 MB                             | `og:image:type` is one of `image/jpeg`, `image/gif`, `image/png`               | Keep to 1.91:1 "to display the full image in Feed without any cropping"; the anchor of a crop is undocumented         |
| X                       | 2:1; 1200 x 600 is secondary (derived from 2:1)                          | 300 x 157; at most 4096 x 4096                                          | under 5 MB                       | JPG, PNG, WEBP, GIF (first frame); not SVG                                     | 2:1 documented; 1200 x 630 is slightly taller, so X trims a few px top and bottom (secondary). `summary` is a square  |
| LinkedIn                | 1.91:1; 1200 x 627 is the stated minimum                                 | 1200 x 627 for the share module; under 401 px wide shows as a thumbnail | 5 MB                             | undocumented for the share module (JPG, PNG, GIF is the single-image ads spec) | Square and vertical images "might be cropped" when shared organically; the anchor is undocumented                     |
| Telegram                | undocumented; 1200 x 630 is secondary                                    | undocumented (about 200 x 200, secondary)                               | undocumented (5 MB, secondary)   | undocumented; WebP see [crawlers](crawlers.md#image-formats)                   | Large or small preview is not documented, and secondary sources disagree (below). Crop undocumented                   |
| VK                      | large snippet 510 x 228 (2.24:1); small 150 x 83                         | 160 px on each side                                                     | undocumented                     | undocumented                                                                   | A larger image is shown at 510 x 228, so a 1.91:1 card loses height; the anchor and today's behaviour are unconfirmed |
| WhatsApp                | width at least 300 px, aspect 4:1 or flatter; 1200 x 630 is secondary    | 300 px wide                                                             | image under 600 KB               | undocumented (SVG is not shown, secondary)                                     | Undocumented. The `<head>` with the tags must be within the first 300 KB of the HTML (a different limit)              |
| iMessage and Apple      | undocumented; at least 900 px wide                                       | 150 px wide (smaller may be ignored or shown as an icon)                | page 1 MB, all resources 10 MB   | undocumented                                                                   | Undocumented: "images may be displayed at varying sizes", so avoid text in them                                       |
| Slack                   | undocumented; 1200 x 630 is secondary                                    | undocumented                                                            | undocumented (1 MB is contested) | undocumented (an SVG draws a grey box, secondary test)                         | Undocumented; one secondary test saw a centred crop in a small unfurl                                                 |
| Discord                 | one `og:image`: small image, large with `twitter:card`; 1200 x 630 shown | undocumented                                                            | none stated for the image        | `.png`, `.gif`, `.jpg`, `.jpeg`, `.webp`, `.avif`                              | Undocumented. Two or more `og:image` tags become a gallery of up to four                                              |
| Pinterest               | pin images 2:3, 1000 x 1500; a link card is not a pin                    | undocumented                                                            | 20 MB (web upload)               | BMP, JPEG, PNG, TIFF, WEBP (pins)                                              | Not a link-preview platform: rich pins read `og:image` ("high-resolution", up to six) and the pin spec is vertical    |
| Yandex                  | undocumented                                                             | undocumented                                                            | undocumented                     | search indexes JPG, PJPG, PNG, GIF, BMP, SVG, PNM, TIFF, WEBP                  | The snippet picture is chosen by an algorithm; `schema.org/ImageObject` is a precondition, not a promise              |
| Google Search           | no size rule; avoid extreme ratios, logos and text                       | undocumented                                                            | undocumented                     | BMP, GIF, JPEG, PNG, WebP, SVG, AVIF                                           | Google chooses the preview and crops it itself                                                                        |
| Google Discover         | 16:9, at least 1200 px wide                                              | more than 300,000 total pixels                                          | undocumented                     | as Google Images                                                               | Google "tries to automatically crop"; needs `max-image-preview:large` (or AMP); no logo, no text-heavy image          |
| Article structured data | 16x9, 4x3 and 1x1                                                        | 50,000 pixels (width x height)                                          | undocumented                     | as Google Images                                                               | None: you supply each ratio. Crawlable, relevant, not a logo or a caption                                             |

### Notes, disagreements and what is not confirmed

- **Facebook and Meta.** Images are cached by URL: a changed image needs a new URL, and an old share keeps its old preview until it is
  refreshed. `og:image:width` and `og:image:height` let the crawler render at once; without them the first share can show no image.
  The "cached for about 30 days" figure repeated in guides is not on Meta's pages: unconfirmed.
- **X.** X's card pages no longer exist on its developer site (the old URLs redirect to a generic docs home), so the numbers come from
  the last archived copy of the "Summary Card with Large Image" page (snapshot 2023-12-17), which says: 2:1, minimum 300 x 157, maximum
  4096 x 4096, under 5 MB, JPG, PNG, WEBP and GIF, SVG not supported, "do not use a generic image such as your website logo". Whether X
  still enforces them today is unconfirmed. The one-image rule holds: `twitter:image` falls back to `og:image`.
- **LinkedIn.** The help page states a 5 MB cap, a 1200 x 627 minimum and 1.91:1 for the share module, and "images less than 401 pixels
  wide display as a thumbnail". Its JPG, PNG and GIF list and the 1.91:1 and 1:1 ranges belong to the single-image ads specification on the
  same page. The page itself says "Last updated: 3 years ago". Cache duration: not confirmed (guides say about seven days).
- **Telegram.** Telegram documents no `og:image` size, aspect or crop. Its API only says a preview may allow the sender to enlarge or
  shrink the media (`has_large_media`, `LinkPreviewOptions.prefer_large_media`). Secondary guides disagree on what picks the large
  layout: some say the image's dimensions (a wide image gives a large photo, a small or square one a thumbnail), others say the
  `twitter:card` value. Do not depend on either: send `twitter:card=summary_large_image` (the plugin does) and a 1200 x 630 image, and check in a
  real chat. `@WebpageBot` re-fetches a cached preview (secondary).
- **VK.** The one primary statement: the snippet takes `vk:image`, else `og:image`, `twitter:image` or `image`; "we recommend images of at least
  510x228 pixels" for the enlarged 510 x 228 picture; a smaller one (at least 160 px each way), or a post with other attachments, gets
  150 x 83. The crop anchor and what the feed does today are not documented and not tested by us. Cache is cleared with `pages.clearCache`.
- **WhatsApp.** Meta's page (updated 2026-05-21): the `<head>` must be inside the first 300 KB of the HTML, and the image should be under 600 KB,
  at least 300 px wide, aspect 4:1 or flatter. The often-quoted "300 KB image" is not on that page. Meta also says WhatsApp "will make the
  best attempt" and falls back to a small preview, which "should not be relied on". The preview is made by the sender's app.
- **iMessage.** Apple's limits are labelled "guidelines only" and "may change". The main resource (the HTML) is capped at 1 MB; that is not the image.
- **Slack.** The robot fetches little of the page (HTTP Range), reads Open Graph, Twitter Card and oEmbed tags, then fetches the image to
  check it. Responses are cached about 30 minutes across Slack. No size limit is documented. A secondary source quotes a 1 MB cap; another
  secondary test displayed a 5 MB PNG, so the cap is not confirmed. Tags should sit near the top of `<head>`.
- **Discord.** Previews are cached about 30 minutes; the Embed Debugger shows what Discord read. Declaring `og:image:width` and `og:image:height`
  saves Discord a fetch. The 2 048-character URL limit means a long signed URL gives no preview at all.
- **Pinterest.** Rich pins are an optional extra for Article, Product and Recipe pages, and an `og:image` there is a hint for a saved pin. No
  share card is designed for Pinterest: a vertical 2:3 pin is a separate asset.
- **Yandex.** Yandex's help documents no `og:image` size for search or for Дзен, and a Yandex staff answer (2023) says the picture beside a snippet is
  chosen by algorithms and cannot be forced. Yandex's own help says Open Graph feeds its video search. Дзен link previews were not found documented.
- **Google Discover and Image SEO.** Source revisions: Discover 2026-03-09, Image SEO 2026-03-02. Use "schema.org markup or the `og:image` meta tag to
  specify a large image that's relevant and representative"; "avoid using generic images (for example, your site logo)" and "text-heavy images".
  If you crop to 16:9 yourself, keep the important details inside the crop.
- **Article structured data** (revision 2026-09-08): "multiple high-resolution images (minimum of 50K pixels when multiplying width and height) with the
  following aspect ratios: 16x9, 4x3, and 1x1"; the URLs must be crawlable and indexable and the images must represent the marked-up content.

### Sources

All read on 2026-11-25 through a caching reader, whose copies were at most a few weeks old; the date a page shows for itself is given where it shows one.

| Platform               | Source                                                                                                                                                      | The page's own date         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Facebook and Meta      | <https://developers.facebook.com/docs/sharing/webmasters/images/>                                                                                           | Updated Jun 30, 2026        |
| Facebook and Meta      | <https://developers.facebook.com/docs/sharing/webmasters/>                                                                                                  | Updated Jun 30, 2026        |
| Facebook and Meta      | <https://developers.facebook.com/docs/sharing/webmasters/optimizing/>                                                                                       | none shown                  |
| X (archived)           | <https://web.archive.org/web/20231217021401/https://developer.twitter.com/en/docs/twitter-for-websites/cards/overview/summary-card-with-large-image>        | snapshot 2023-12-17         |
| LinkedIn               | <https://www.linkedin.com/help/linkedin/answer/a521928>                                                                                                     | "Last updated: 3 years ago" |
| Telegram               | <https://core.telegram.org/constructor/webPage>, <https://core.telegram.org/bots/api/types/linkpreviewoptions.md>                                           | none shown                  |
| VK                     | <https://dev.vk.com/ru/api/posts> (section "Данные сниппета")                                                                                               | none shown                  |
| WhatsApp               | <https://developers.facebook.com/documentation/business-messaging/whatsapp/link-previews>                                                                   | Updated May 21, 2026        |
| Apple                  | <https://developer.apple.com/documentation/technotes/tn3156-create-rich-previews-for-messages>                                                              | revision history 2024-04-30 |
| Slack                  | <https://api.slack.com/robots>, <https://docs.slack.dev/messaging/unfurling-links-in-messages>                                                              | none shown                  |
| Discord                | <https://docs.discord.com/developers/link-previews/overview>                                                                                                | none shown                  |
| Pinterest              | <https://help.pinterest.com/en/article/review-pin-specs>, <https://developers.pinterest.com/docs/web-features/article-rich-pins/>                           | none shown                  |
| Yandex                 | <https://yandex.ru/support/webmaster/ru/search-appearance/images>, <https://webmaster.yandex.ru/blog/obnovlenie-v-snippete-sayta> (staff answer 2023-02-18) | page 2022-02-08             |
| Google Discover        | <https://developers.google.com/search/docs/appearance/google-discover>                                                                                      | Last updated 2026-03-09     |
| Google image SEO       | <https://developers.google.com/search/docs/appearance/google-images> ("Specify a preferred image with metadata")                                            | Last updated 2026-03-02     |
| Google Article         | <https://developers.google.com/search/docs/appearance/structured-data/article>                                                                              | Last updated 2026-09-08     |
| Google robots meta tag | <https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag>                                                                               | Last updated 2026-03-24     |

Secondary sources, used only for the cells marked "secondary" or "contested": third-party link-preview and Open Graph guides (2026) for the
X ratio-to-size derivation, Telegram's image sizes, the Slack 1 MB claim and the WhatsApp folklore.

## 2. Safe zones

Text, a logo and a pill stay inside the safe zone (`ZONE` in `src/presets/spec.ts`); only a photograph, its scrim, uploaded brand art
and the accent strip bleed to the edge. The table is each crop a card meets, or would meet if it were reused, applied to the card as a centred crop. No platform documents where it
crops, so the centre is an assumption; the zone is what survives it. The block is generated.

<!-- spec:safe-zone -->
```text
card          1200 x 630
safe zone     x 64 to 1136, y 96 to 534
margins       left 64, right 64, top 96, bottom 96 (px from the card edge)

a centred crop to this ratio takes  zone intact ratio
top and bottom 0.9 px each          yes         Facebook, LinkedIn link share (1.91:1)
top and bottom 15 px each           yes         X summary_large_image (2:1)
top and bottom 46.8 px each         yes         VK large snippet (510 x 228)
left and right 40 px each           yes         Google Discover, Article image (16:9)
left and right 180 px each          NO          Google Article image (4:3)
left and right 285 px each          NO          a square thumbnail: X summary, Telegram or Slack small preview, Article image (1:1)
```
<!-- /spec:safe-zone -->

How to read it:

- The vertical margin is deliberately larger than any documented crop of the card. VK's documented 510 x 228 snippet is the deepest one;
  the zone keeps about twice that off the top and bottom, because the VK anchor and today's behaviour are unconfirmed and a feed may crop
  more than a documentation page says. Do not lower the margin on the strength of the table: it is arithmetic on a documented size, not a measurement.
- The side margin is a gutter and the 16:9 crop (Discover, Article). The card is a 1.91:1 image, so a 16:9 crop takes its sides.
- A 4:3 or a square crop cuts into the zone. The square is the crop of the small previews (X `summary`, Telegram or Slack small layout), and 4:3 and 1:1
  are two of the three Article images; no layout of a 1.91:1 card survives either. So the card is never reused as a thumbnail or as an Article image: set
  `twitter:card` to `summary_large_image` (the plugin does) and give the structured data its own clean crops (section 4).
- A text or logo that must read in a messenger stays inside the zone and is large enough at the size of a phone chat. Apple advises no text in
  preview images at all; the card's title is the exception the design pays for, and the page's title and description are always set as metadata too.

## 3. The standard design

The built-in presets are `payload-og-image:text` and `payload-og-image:photo`, written `<id>@<revision>`. Their values are in the block
below (generated from `src/presets/spec.ts`); the rules that use them are in `src/presets/layout.ts` and `src/presets/templates.tsx`, and are
pure functions of the props, so the zone is tested without drawing a pixel. A change to any value is a revision bump, which moves only preset cards.

<!-- spec:design -->
```text
presets       payload-og-image:text@2, payload-og-image:photo@2
card          1200 x 630; images are cut at 2x the size they are drawn at
colours       ground #121416, ink #EEF0F2, muted #A3A9B0, accent #8FB4FF
safe zone     x 64 to 1136, y 96 to 534

text card (px)
  column      x 80; width 900 plain, 900 beside the faint logo, 640 beside uploaded art (art at x 736)
  head        y 96, height 44; site name 34/30/26/22, label 34; gap 20; hairline 2 x 36
  head logos  logo at most 220 x 44, partner at most 160 x 44, 16 between; wider than 1.5:1 stands alone
  title       y 168, at most 280 high; leading 1.04, tracking -0.03em, weight 700
              ladder beside art (size/lines): 96/2 84/2 72/2 64/3 56/3 48/4
              ladder otherwise:               112/2 96/2 84/3 72/3 64/4 56/4 50/5 44/6
  sub line    30 px, leading 1.35, at most 2 lines, only when the title has at most 2 lines; 24 below the title, ends by y 478
  foot        y 500, height 34, 26 px, gap 14; pills 22 px, 14 px padding
  faint logo  contained in 400 x 400 at (736, 115); opacity 0.35; drawn only when its trimmed aspect is within 0.67 to 1.5
  accent strip 8 high along the bottom edge, opacity 0.55

photo card (px)
  column      x 64, width 1072
  fact row    y 494, height 40, 24 px, gap 14; pills 16 px padding; ends at y 534
  title       28 above the fact row, bottom-anchored; leading 1.08, tracking -0.025em, weight 700
              ladder (size/lines): 84/1 76/2 70/2 64/3 58/3 52/4 48/4
  scrim       ground colour, fades in over 140 above the title's top; stops (px, alpha) 0:0 60:0.22 140:0.55; 0.82 at the bottom edge
  lockup      logo at most 150 x 36, partner at most 120 x 36, name 26 px at 0.92; wider than 1.5:1 stands alone

slots         pill (pill, at most 28 characters, priority 1); badge (badge, at most 6 characters, priority 2); pill2 (pill, at most 24 characters, priority 3); caption (text, at most 48 characters, priority 4); meta (text, at most 32 characters, priority 5); a higher priority drops first
hero          a raster of at least 800 x 420 (image/jpeg, image/png, image/webp, image/gif, image/avif) draws the photo card; anything smaller or an SVG draws the text card
image boxes   text card: logo 440 x 88, partner 320 x 88, faint logo 400 x 400, art 464 x 630; photo card: logo 300 x 72, partner 240 x 72
```
<!-- /spec:design -->

**Both presets**

- A dark ground with ink, muted and accent colours from the block. Dark is the default; there is no light skin.
- One family: Inter, weights 400 and 700, bundled in latin, latin-ext and cyrillic, registered only when the site gives neither `fonts` nor
  `stacks`. Every text prop is set in the `default` stack, so a site's own stack named like a field cannot capture a preset's field. A site that
  brings fonts draws the presets with its own `default` stack; the design rules are then the site's to keep.
- Text, logos and pills stay in the safe zone. A text that does not fit is not cut: a title ends with an ellipsis only at the last rung of its ladder, and
  a sub line, caption or slot is shown whole or not at all.
- Logos are trimmed, contained and never cropped; a logo whose opaque pixels mostly contrast under 3:1 with the ground is drawn in the ink (white on the photo card).
  A logo wider than the "wide" ratio of the block stands alone: no site name beside it.
- Slots (`pill`, `pill2`, `badge`, `caption`, `meta`) are accepted by both presets, dropped by priority when the row is full, and dropped whole when over
  their length. Zero config fills none of them: it fills `title`, `subtitle`, `label`, `byline`, `site` and `artOpacity`.

**The text card (PNG)**

- _Head lockup_, top left: the logo, a partner logo, the site name (one line, on its own size ladder; the bare domain when the name does not fit; none
  beside a wide logo), a hairline, then the label. When the row is full the label drops before the name.
- _Title ladder_: the title is balanced and fitted on a ladder of `[size, lines]` rungs. Beside art there is no ellipsis: a title that does not fit whole
  drops the art and is fitted on the plain ladder, whose last rung may end in an ellipsis.
- _Sub line_: only when the title is short enough to leave room, whole or not at all. The title and sub line are centred between the head and the foot.
- _Foot_: `byline · domain` (the bare domain when it does not fit), then the slots in order `pill`, `pill2`, `badge`, `caption`; `meta` is right-aligned at the end.
  The `pill` is the accent-filled price or tag pill, `pill2` and the label are translucent, a `badge` is outlined.
- _Logo on the right_: the site's own logo, whole and faint, at `artOpacity` (the block's default unless the site sets it), behind the title, so the title column
  stays as wide as without it. Uploaded brand art takes its place at full opacity, and the column narrows. A logo that is no mark (its trimmed aspect is outside the
  range in the block) is not drawn there. With neither, the right side is empty.
- The accent strip runs along the bottom edge.

**The photo card (JPEG)**

- Drawn when the document's hero is a raster of at least the hero minimum in the block; a smaller one, an SVG, or a hero that could not be prepared draws the text layout.
- The hero covers the card at its focal point, in truecolour (a palette PNG shows as a cross-hatch on a smooth sky).
- A ground-coloured _scrim_ rises from the bottom edge: it fades in above the title and never becomes opaque. The title is white, bottom-anchored above the fact row, with a soft shadow.
- The _fact row_ ends at the bottom of the safe zone: pills and captions from the left; at the right end one brand lockup (the logo, a partner logo, the site name). The logo is never
  dropped; the name drops first when the row is full. The label stands in for a missing `pill`.

**Per-document settings.** An editor can set the card's headline and sub line, or switch the card off, through the `og` group (`mode`: `inherit`, `generated`,
`custom`, `off`; see [reference](reference.md#per-document-share-card-fields)). A site chooses, per collection, `preset`, `title`, `hero`, `label`, `subtitle`
and `byline`; and for all cards `siteName`, `site()` (logo, partner logo, brand art), `logoCollection` and `artOpacity` (see [reference](reference.md#zero-config-presets)).
These change what is drawn through the props; none of them moves the layout rules above.

## 4. What goes where

| Surface                                            | Image                                                                         | Why                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `og:image` and `twitter:image` (messengers, feeds) | The single branded 1200 x 630 card, with `twitter:card` `summary_large_image` | Every crawler reads the first image; Discord makes a gallery of several          |
| JSON-LD `image` (Google Search, Discover, Article) | Clean photo crops in 16:9, 4:3 and 1:1: no text, no logo, no scrim            | Google asks for those ratios and says avoid logos and text in the image it picks |

- **`og:image` is one image, always.** A second `og:image` tag is never added in a layout or a page: Discord turns several into a gallery of up to four, and most
  crawlers ignore all but the first. A page's `openGraph` replaces the layout's whole `openGraph`. `ogMetadata` emits `openGraph.images` (one image with its size,
  type, alt and `secure_url` when it is https) and `twitter.card` set to `summary_large_image`.
- **Structured data gets clean crops.** Google's Article and Discover guidance asks for 16:9, 4:3 and 1:1 images of at least 50,000 pixels, 1200 px wide for Discover, and
  says to avoid a logo or a text-heavy image there. The branded card is therefore never what goes in JSON-LD. The plugin serves a photo set for it (`ogPhotoImages`, see
  [reference](reference.md#photo-set-for-structured-data-and-discover)); the rule for the set is:
  - the images are photo crops of the document's hero upload and nothing else: no text, no logo, no scrim;
  - 16:9 capped at 1200 x 675, 4:3 capped at 1200 x 900, 1:1 capped at 1200 x 1200; JPEG, sRGB, no metadata;
  - each crop is taken around the Payload focal point of the hero, and at the centre when none is set;
  - never upscaled: a smaller source gives a smaller crop, with a floor of 600 px wide, and a size that would come out narrower is left out;
  - no hero means no set at all: never the card, never the logo as a stand-in.
  - Discover's large preview needs the 16:9 image at least 1200 px wide together with `max-image-preview:large`. A source under 1200 px wide therefore gives
    valid Search images but no Discover large preview.

  The mechanism, the helpers and the JSON-LD example are in [reference](reference.md#photo-set-for-structured-data-and-discover). Card `variants` ([reference](reference.md#size-variants)) are not for this.
- **`max-image-preview:large` and `noindex`.** Discover shows large images only for a page that allows them: `max-image-preview:large` (or AMP). Google's default when the rule is
  absent is "an image preview of the default size". The plugin emits no `robots` tag: set it in the page's `robots` metadata (`withLargeImagePreview` adds it without dropping a `noindex`) or an `X-Robots-Tag` header. A `noindex` on the
  page removes it from search results, Discover included, whatever the image says: when robots rules conflict the more restrictive one applies, and a page blocked in
  `robots.txt` never shows its rules to Google. A `noindex` page can still be shared, so its `og:image` still matters to messengers. Do not let the card route
  be `Disallow`ed or `noindex`ed: it is an image, and the platforms fetch it directly.
- **Alt text** is `og:image:alt`, descriptive of the image, not a copy of the title.

## 5. Checklist before a card design ships

1. The design is one of the presets, or a template that keeps their rules: dark default ground, one family, text and logos inside the safe zone block of section 2.
2. Every value of a design is in its spec file and enters the card version (`id` and `revision`); a design change bumps `revision`. Nothing a template draws is read from outside its props.
3. `pnpm docs:spec` has been run if `src/presets/spec.ts` changed, and `git diff docs/share-image-spec.md` shows only the blocks you expect.
4. `og:image` is one absolute `https` image of 1200 x 630 (1.91:1), with `og:image:width`, `height`, `type` and `alt`, and `twitter:card` is `summary_large_image`.
5. The file is JPEG or PNG, well under 600 KB (the tightest documented cap, WhatsApp's), and the card's own HEAD and GET agree.
6. Every title is checked at its worst: the longest title the collection allows, a one-word title, no hero, no logo, a wide logo, a logo that is dark on the dark ground.
7. Look at the card at phone-chat size and under the crops of section 2: the title still reads and nothing important touches an edge. The square crop is expected to cut it.
8. The page sets `twitter:card`, a unique `og:title`, a description and a canonical URL; its tags are in `<head>`, near the top (Slack reads the page with Range requests, and one secondary test saw only the first 32 KB; WhatsApp needs the `<head>` inside the first 300 KB), and are in the served HTML, not added by client script.
9. `robots.txt` does not block the card path. The page's robots rules agree with the intent: `max-image-preview:large` for a page meant for Discover, no `noindex` on a page meant for search.
10. JSON-LD, where the page has it, carries the clean photo crops of the hero (16:9, 4:3, 1:1; no text, no logo, none at all when there is no hero), never the branded card or the logo.
11. After a change, a card has a new URL (the version changes by itself); re-scrape a page that was already shared (Facebook Sharing Debugger, LinkedIn Post Inspector, `@WebpageBot`, `pages.clearCache` for VK), and expect about 30 minutes in Slack and Discord.
12. The test kit is green (`everyRouteHasOwnCard`, `sizeBudget`, `headParity`): see [testing](../skills/payload-og-image/references/testing.md) in the agent skill.
