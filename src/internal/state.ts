import type { OgImagePluginOptions } from '../plugin/index.js'
import { createEventSink } from './events.js'
import { type FontSpec, type LoadedFont, loadFonts } from './fonts.js'
import { createGate, type Gate } from './gate.js'
import { createMemo, type Memo } from './memo.js'
import type { cachedSite } from './site.js'
import { diskStore } from './store/disk.js'
import { memoryStore } from './store/memory.js'
import type { CardStore } from './types.js'
import { withVariants } from './variants.js'

export const CUSTOM_KEY = 'payload-og-image'

/**
 * Everything the plugin owns, created when the Payload config is built. It holds data and lazy memos only:
 * nothing here imports `next/*`, `sharp` or the renderer, because the Payload CLI loads the config outside Next.
 * The request-time runtime (`runtime.ts`, behind `/next`) reads it from `config.custom`.
 */
export type OgState = {
  readonly options: OgImagePluginOptions
  readonly serverUrl: string
  readonly events: ReturnType<typeof createEventSink>
  readonly gate: Gate
  readonly admission: Gate
  readonly memo: Memo
  /** Loads the registered faces once (a rejection is not remembered, so a fixed file is picked up). */
  fonts(): Promise<{ fonts: LoadedFont[]; digest: string }>
  store(): CardStore & { readonly enabled?: boolean }
  /** Set by the runtime once it has built the cached `site()`. */
  siteCache: ReturnType<typeof cachedSite> | undefined
  /** Called by the `afterChange` hook of every site global. */
  invalidateSite(): void
}

export function createState(given: OgImagePluginOptions, serverUrl: string): OgState {
  const options = withVariants(given) // the one place a state's targets are expanded, whoever builds the state (plugin, test kit)
  const events = createEventSink(options.onEvent)
  let fontsPromise: ReturnType<typeof loadFonts> | undefined
  let store: (CardStore & { readonly enabled?: boolean }) | undefined
  const state: OgState = {
    options,
    serverUrl,
    events,
    gate: createGate(options.gate),
    admission: createGate(options.admission ?? { concurrency: 16, queue: 128 }),
    memo: createMemo(options.memo),
    fonts() {
      fontsPromise ??= loadFonts(options.fonts as FontSpec[])
      fontsPromise.catch(() => {
        fontsPromise = undefined
      })
      return fontsPromise
    },
    store() {
      store ??=
        'memory' in options.store
          ? memoryStore({ maxBytes: options.store.maxBytes })
          : diskStore({ ...options.store, onEvent: events.emit })
      return store
    },
    siteCache: undefined,
    invalidateSite() {
      state.siteCache?.invalidate()
    },
  }
  return state
}
