'use client'
import { useAllFormFields, useConfig, useDocumentInfo, useForm } from '@payloadcms/ui'
import type { UIFieldClientProps } from 'payload'
import { type FC, useEffect, useRef, useState } from 'react'

type Warnings = {
  missing: string[]
  missingCount?: number
  overBudget: boolean
  customIneligible: boolean
  customTooSmall: boolean
  modeOff: boolean
  sharesImage?: boolean
}
type State =
  | { status: 'idle' }
  | { status: 'loading'; src?: string; warnings: string[] }
  | { status: 'ready'; src: string; warnings: string[] }
  | { status: 'busy'; src?: string; warnings: string[] }
  | { status: 'error'; message: string }

/** The mode in the form data, as the preview endpoint is asked about it. */
const modeOf = (data: unknown): unknown => (data as { og?: { mode?: unknown } } | undefined)?.og?.mode

const NO_CARD = 'Disabled: this document shares no card of its own, so there is no card address to change.'
const SHARES_IMAGE = 'Disabled: the page shares an image, not a generated card, so a new card address would change nothing.'
const DEBOUNCE_MS = 800
const RETRY_MS = 5000

/** Warnings in plain words, for an editor. */
function sayWarnings(w: Warnings): string[] {
  const out: string[] = []
  if (w.modeOff) out.push('No card of its own: the site default image applies')
  if (w.customIneligible) out.push('The custom image cannot be shared (SVG or no size on record)')
  if (w.customTooSmall) out.push('The custom image is smaller than 600x315')
  const count = Math.max(w.missingCount ?? 0, w.missing.length)
  if (count > 0)
    out.push(`${count} character${count === 1 ? '' : 's'} cannot be drawn: ${w.missing.join(' ')}${count > w.missing.length ? ' …' : ''}`)
  if (w.overBudget) out.push('Card is over 300 KB')
  return out
}

/**
 * A live picture of the card for the document being edited. Each change to the form, after 800 ms of quiet, asks the plugin's
 * preview endpoint (which checks the editor's access) for the card; the picture and its warnings are shown. A busy server
 * (503) is retried once after 5 s. The previous request is aborted and the previous blob URL revoked.
 */
export const OgPreviewField: FC<UIFieldClientProps> = () => {
  const { getData, dispatchFields, setModified } = useForm()
  const [fields] = useAllFormFields()
  const { id, collectionSlug } = useDocumentInfo()
  const {
    config: { routes, serverURL },
  } = useConfig()
  const [state, setState] = useState<State>({ status: 'idle' })
  // The last answer's raw warnings and the mode they were drawn for: they say whether a new nonce could change the page's card URL
  // at all, and only for that mode. After a switch of mode they say nothing until the next answer.
  const [last, setLast] = useState<{ warnings: Warnings; mode: unknown } | undefined>(undefined)
  const blob = useRef<string | undefined>(undefined)
  const dataRef = useRef(getData)
  dataRef.current = getData

  // biome-ignore lint/correctness/useExhaustiveDependencies: `fields` changes on every edit: that is the trigger.
  useEffect(() => {
    if (!collectionSlug) return
    const controller = new AbortController()
    let retry: ReturnType<typeof setTimeout> | undefined
    const url = `${serverURL ?? ''}${routes.api}/payload-og-image/preview`
    const ask = async (retried: boolean): Promise<void> => {
      const asked = dataRef.current()
      setState((s) => ({ status: 'loading', src: 'src' in s ? s.src : undefined, warnings: 'warnings' in s ? s.warnings : [] }))
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ collection: collectionSlug, ...(id !== undefined && id !== null ? { id } : {}), doc: asked }),
          signal: controller.signal,
        })
        if (res.status === 503 && !retried) {
          setState((s) => ({ status: 'busy', src: 'src' in s ? s.src : undefined, warnings: 'warnings' in s ? s.warnings : [] }))
          retry = setTimeout(() => void ask(true), RETRY_MS)
          return
        }
        if (!res.ok) setLast(undefined)
        if (res.status === 403 || res.status === 401)
          return setState({ status: 'error', message: 'No preview: you may not preview this document' })
        if (res.status === 404) return setState({ status: 'error', message: 'No preview: this page has no card (is the title empty?)' })
        if (!res.ok) return setState({ status: 'error', message: 'No preview: the server could not draw the card' })
        const raw = JSON.parse(res.headers.get('x-og-warnings') ?? 'null') as Warnings
        const warnings = sayWarnings(raw)
        const src = URL.createObjectURL(await res.blob())
        if (controller.signal.aborted) return URL.revokeObjectURL(src)
        if (blob.current) URL.revokeObjectURL(blob.current)
        blob.current = src
        setLast({ warnings: raw, mode: modeOf(asked) })
        setState({ status: 'ready', src, warnings })
      } catch (error) {
        if ((error as Error)?.name === 'AbortError' || controller.signal.aborted) return
        setLast(undefined)
        setState({ status: 'error', message: 'No preview: the request failed' })
      }
    }
    const timer = setTimeout(() => void ask(false), DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      if (retry) clearTimeout(retry)
      controller.abort()
    }
  }, [id, collectionSlug, routes.api, serverURL])

  useEffect(
    () => () => {
      if (blob.current) URL.revokeObjectURL(blob.current)
    },
    [],
  )

  /** A new nonce is a new card URL, so LinkedIn, Facebook and Telegram fetch the card again. Saved with the document. */
  const forceNewImage = () => {
    const current = (getData() as { og?: { nonce?: unknown } }).og?.nonce
    const value = (typeof current === 'number' && Number.isSafeInteger(current) && current > 0 ? current : 0) + 1
    dispatchFields({ type: 'UPDATE', path: 'og.nonce', value })
    setModified(true)
  }

  // A nonce is part of a generated card's version only: with `off` (no card) or a shared image it changes no URL.
  const mode = modeOf(getData())
  const cannotChange = mode === 'off' ? NO_CARD : last?.warnings.sharesImage && last.mode === mode ? SHARES_IMAGE : undefined
  const src = 'src' in state ? state.src : undefined
  const warnings = 'warnings' in state ? state.warnings : []
  return (
    <div style={{ marginBottom: 'var(--base, 24px)' }} aria-live="polite">
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Card preview</div>
      {src ? (
        <img
          src={src}
          alt="Preview of the share card"
          width={600}
          height={315}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      ) : null}
      {state.status === 'loading' && !src ? <div>Drawing the card…</div> : null}
      {state.status === 'busy' ? <div>Busy, retrying</div> : null}
      {state.status === 'error' ? <div>{state.message}</div> : null}
      <button
        type="button"
        className="btn btn--style-secondary btn--size-small"
        onClick={forceNewImage}
        disabled={cannotChange !== undefined}
        aria-describedby="og-force-hint"
        style={{ marginTop: 8 }}
      >
        Force new image
      </button>
      <div id="og-force-hint" style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>
        {cannotChange ?? 'Gives the card a new address so LinkedIn, Facebook and Telegram fetch it again.'}
      </div>
      <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>
        A platform shows the new card only once it reads the page again: re-scrape it in the LinkedIn Post Inspector or the Facebook Sharing
        Debugger.
      </div>
      {warnings.map((w) => (
        <div key={w} style={{ color: 'var(--theme-warning-600, #b45309)', marginTop: 4 }}>
          {w}
        </div>
      ))}
    </div>
  )
}
