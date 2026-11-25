// Internal shared types. Nothing here is part of the public surface.
import type { CardEncoding, CardFormat, CardMime } from './format.js'

export type { CardEncoding, CardFormat, CardMime }

export type OgEventName =
  | 'hit_memo'
  | 'hit_store'
  | 'render'
  | 'shed'
  | 'store_disabled'
  | 'store_write_skipped'
  | 'store_corrupt'
  | 'downgraded'
  | 'render_error'
  | 'glyph_missing'
  | 'over_budget'
  | 'draft'
  | 'not_found'
  | 'crawler'

/** Every event the plugin emits, for `/stats` (a counter for each). The check below fails to compile when a name is missing. */
export const OG_EVENT_NAMES = [
  'hit_memo',
  'hit_store',
  'render',
  'shed',
  'store_disabled',
  'store_write_skipped',
  'store_corrupt',
  'downgraded',
  'render_error',
  'glyph_missing',
  'over_budget',
  'draft',
  'not_found',
  'crawler',
] as const satisfies readonly OgEventName[]
const _allEventNamesListed: Exclude<OgEventName, (typeof OG_EVENT_NAMES)[number]> extends never ? true : never = true
void _allEventNamesListed

export type OgEvent = {
  name: OgEventName
  kind?: string
  slug?: string
  v?: string
  ms?: number
  bytes?: number
  detail?: Record<string, unknown>
}

export type OnEvent = (e: OgEvent) => void

export type Size = { width: number; height: number }

export type Upload = {
  id: string | number
  url?: string | null
  width?: number | null
  height?: number | null
  mimeType?: string | null
  alt?: string | null
  updatedAt?: string | null
  filename?: string | null
  focalX?: number | null
  focalY?: number | null
  sizes?: Record<string, Partial<Upload> | undefined> | null
}

export type SiteInfo = { name: string } & Record<string, unknown>

export type CardKey = { kind: string; slug: string }

export type VersionInput = {
  /** Normalised hero background when it is not the default white; hashed with each hero only. */
  heroBackground?: string
  /** The hero has a see-through pixel and no `heroBackground` flattens it (the alpha is kept, from 0.5.0); hashed with each hero only. */
  heroTransparent?: boolean
  /** Effective card palette when not the default (`'false'` or the colour count); hashed for every card. */
  cardPalette?: string
  /** Effective hero palette when not the default; hashed with each hero only. */
  heroPalette?: string
  /** The card's encoding variant when it is not PNG (see `variantOf`); fills the version's variant slot. Absent hashes exactly as before. */
  variant?: string
  templateId: string
  templateRevision: string
  props: unknown
  heroes: Upload[]
  fontsDigest: string
  host: string
  /** A per-document counter an editor bumps to give a card a new URL. 0 or absent hashes exactly as 0.1. */
  nonce?: number
}

export interface CardStore {
  /** `format` is the card's encoding (default PNG): it names the file and picks the validation. */
  get(pageId: string, v: string, format?: CardFormat): Promise<Uint8Array | null>
  /**
   * Whether a card is kept under this exact key, and its size: a stat, never a read of the bytes, and never a write or a delete
   * (an audit asks it for many cards). It does not validate the bytes: `get` does that.
   */
  stat(pageId: string, v: string, format?: CardFormat): Promise<{ bytes: number } | null>
  put(pageId: string, v: string, bytes: Uint8Array, format?: CardFormat): Promise<void>
}
