// Internal shared types. Nothing here is part of the public surface.
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
  templateId: string
  templateRevision: string
  props: unknown
  heroes: Upload[]
  fontsDigest: string
  host: string
}

export interface CardStore {
  get(pageId: string, v: string): Promise<Uint8Array | null>
  put(pageId: string, v: string, bytes: Uint8Array): Promise<void>
}
