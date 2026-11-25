import type { ReactElement } from 'react'
import { normaliseHeroBackground } from './internal/colour.js'
import type { Box } from './internal/fonts.js'
import { assertFormatOption, type CardFormat, type JpegOptions, pathProblem, type WebpOptions } from './internal/format.js'
import { MAX_SIDE } from './internal/limits.js'
import type { SiteInfo, Size, Upload } from './internal/types.js'

export type { Box }

/** A value a template prop may hold: what survives normalization unchanged. A `Date` is not one (see `Normalized`). */
export type PropValue = string | number | boolean | null | undefined | readonly PropValue[] | { [key: string]: PropValue }
/** The shape of a template's props: plain JSON. A Date-typed (or Map, Set, class-typed) prop fails to type-check. */
export type PropsModel = { [key: string]: PropValue }

/**
 * What the template actually receives for props a target returned as `T`: every `Date` becomes its ISO string;
 * a Map, Set, function, bigint or symbol is `never`, because the resolver rejects them at runtime.
 * Write the template as `defineTemplate<Normalized<TargetProps>>(...)`.
 */
export type Normalized<T> = T extends Date
  ? string
  : T extends string | number | boolean | null | undefined
    ? T
    : T extends readonly (infer U)[]
      ? Normalized<U>[]
      : T extends ((...args: never[]) => unknown) | bigint | symbol | ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>
        ? never
        : T extends object
          ? { [K in keyof T]: Normalized<T[K]> }
          : never

/** What a template's `render` gets besides its props. Site data reaches a template only through props, so it is part of the version. */
export type TemplateContext = {
  host: string
  /** The hero as a data URL, or null when the card has none (or it could not be prepared). */
  hero: string | null
  /**
   * The largest size at which `text` fits `box` in `stack`. By default every second size from `box.maxSize` down; a box can opt in to a
   * ladder of its own (`sizes`), letter spacing (`tracking`), room for descenders (`descent`), a calmer line count (`fewerLines`) and
   * the narrowest width that keeps the line count (`balance`, answered as `width`).
   */
  fit(text: string, box: Box, stack: string): { size: number; lines: number; text: string; width?: number }
  /** The font family of `stack` that draws every character of `text`. */
  font(stack: string, text: string): string
}

export type Template<P extends PropsModel> = {
  /** Part of every card version: change it only with the design. */
  id: string
  /** Bump when the design changes, so every cached card is redrawn. */
  revision: string
  size: Size
  /** False means the card advertises nothing (a blank title); it is checked after unsupported glyphs are stripped. */
  required?: (p: P) => boolean
  /** String props set as text: unsupported glyphs are stripped from them before layout. */
  textFields?: (keyof P & string)[]
  /** Which font stack each text field uses (field name -> stack name); a field without an entry uses the stack of its own name. */
  stacks?: Record<string, string>
  heroBox?: Size
  /** The colour this template's transparent hero is flattened onto (`#rgb` or `#rrggbb`), instead of the plugin's `heroBackground`. A target's own wins. */
  heroBackground?: string
  render(p: P, ctx: TemplateContext): ReactElement
}

const DEFAULT_SIZE: Size = { width: 1200, height: 630 }

export function defineTemplate<P extends PropsModel>(t: Omit<Template<P>, 'size'> & { size?: Size }): Template<P> {
  if (typeof t.id !== 'string' || t.id.trim() === '') throw new Error('payload-og-image: a template needs a non-empty id')
  if (typeof t.revision !== 'string') throw new Error(`payload-og-image: template "${t.id}" needs a string revision`)
  if (t.heroBackground !== undefined) normaliseHeroBackground(t.heroBackground) // a named error now, not at the first card
  const size = t.size ?? DEFAULT_SIZE
  if (
    !(
      Number.isInteger(size.width) &&
      size.width > 0 &&
      size.width <= MAX_SIDE &&
      Number.isInteger(size.height) &&
      size.height > 0 &&
      size.height <= MAX_SIDE
    )
  ) {
    throw new Error(`payload-og-image: template "${t.id}" has an invalid size`)
  }
  return { ...t, size }
}

/**
 * A related document for a resolver: published only and access-respecting (the draft, for an authenticated editor previewing).
 * Null when it does not exist or may not be read. Relations on `doc` are never populated for you (depth 0): ask for what you draw.
 */
export type RelatedFn = (collection: string, id: string | number) => Promise<Record<string, any> | null>

/**
 * What the editor typed into the document's `og` group: a headline and a subtitle, trimmed, undefined when empty.
 * They change a card only when a target's `props` reads them (`overrides?.headline ?? doc.title`).
 */
export type OgOverrides = { headline?: string; subtitle?: string }

export type ResolverArgs<D> = {
  doc: D
  site: SiteInfo
  related: RelatedFn /** Always given by the resolver; optional so that a test calling `target.props({ doc, site, related })` by hand still compiles. */
  overrides?: OgOverrides
}

export type Target<D = any, P = any> = {
  /** Route path of the card; must contain `:slug` or `:id`, and may contain `:kind`. */
  path: string
  /** Defaults to the target's name in the plugin's `targets` map. */
  kind?: string
  collection?: string
  /** Field holding the card's key in the URL; defaults to `slug`. A doc without it is keyed by its id. */
  slugField?: string
  template: string | ((a: ResolverArgs<D>) => string)
  props: (a: ResolverArgs<D>) => P | Promise<P>
  hero?: (a: ResolverArgs<D>) => Upload | null | undefined
  /** The upload collection the hero belongs to. A hero file is read only from that collection's folder; with one upload collection it may be omitted. */
  heroCollection?: string
  /** The colour this target's transparent hero is flattened onto (`#rgb` or `#rrggbb`); wins over the template's and the plugin's `heroBackground`. */
  heroBackground?: string
  /**
   * The card's alt text, as the page advertises it (`og:image:alt`). Default `<label>: <title>` from the props, or the title alone.
   * An empty answer takes the default. It is not drawn, so it is not part of the card's URL.
   */
  alt?: (a: ResolverArgs<D> & { props: Normalized<P> }) => string | null | undefined
  /** Candidate uploads shared as they are, in order, before a card is generated. */
  share?: (a: ResolverArgs<D>) => unknown[]
  /** Fields to read (the slug field and the share-image field are always added). Omit it to read every field. */
  select?: Record<string, true>
  /** This target's card encoding; wins over the plugin's `format`. A JPEG target's `path` should end in `.jpg`, a WebP one's in `.webp` (a path that names another image format is refused). */
  format?: CardFormat
  /** This target's JPEG settings (`quality`, 1 to 100); wins over the plugin's `jpeg`. */
  jpeg?: JpegOptions
  /** This target's WebP settings (`quality`, 1 to 100); wins over the plugin's `webp`. */
  webp?: WebpOptions
}

export function defineTarget<D, P>(t: Target<D, P>): Target<D, P> {
  if (typeof t.path !== 'string' || !t.path.startsWith('/'))
    throw new Error(`payload-og-image: target path "${String(t.path)}" must start with "/"`)
  if (/[?#]/.test(t.path)) {
    throw new Error(`payload-og-image: target path "${t.path}" must be a pathname only (no query or fragment): the card URL appends ?v=`)
  }
  if (!/:(slug|id)\b/.test(t.path)) {
    throw new Error(`payload-og-image: target path "${t.path}" has no :slug or :id, so every document would share one card URL`)
  }
  if (t.heroBackground !== undefined) normaliseHeroBackground(t.heroBackground)
  assertFormatOption('target', t)
  const mismatch = t.format === undefined ? undefined : pathProblem(t.path, t.format)
  if (mismatch) throw new Error(`payload-og-image: target ${mismatch}`)
  if (t.alt !== undefined && typeof t.alt !== 'function') throw new Error('payload-og-image: target alt must be a function')
  if (t.kind !== undefined && !/^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/.test(t.kind)) {
    throw new Error(`payload-og-image: target kind "${t.kind}" must be one URL-safe path segment`)
  }
  return t
}

/** A card for a page that is not a document (a home page, a section index). */
export type StaticCard<P = any> = {
  path: string
  kind: string
  slug: string
  template: string
  props: (a: { payload: unknown; site: SiteInfo }) => P | Promise<P>
  /** The card's alt text: a string, or a function of the props it draws. Default `<label>: <title>`, or the title alone. Not part of the URL. */
  alt?: string | ((a: { props: Normalized<P>; site: SiteInfo }) => string | null | undefined)
  /** This card's encoding; wins over the plugin's `format`. */
  format?: CardFormat
  jpeg?: JpegOptions
  webp?: WebpOptions
}
