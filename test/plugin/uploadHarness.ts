import type { Payload } from 'payload'
import { createGate } from '../../src/internal/gate.js'
import { createCardHandler } from '../../src/internal/handler.js'
import { createMemo } from '../../src/internal/memo.js'
import { createState } from '../../src/internal/state.js'
import { memoryStore } from '../../src/internal/store/memory.js'
import { uploadFieldsOf } from '../../src/internal/uploads.js'
import type { OgImagePluginInput } from '../../src/plugin/index.js'
import { payloadSource } from '../../src/plugin/payloadSource.js'
import { expandPresets } from '../../src/presets/expand.js'
import { fallbackTemplate } from '../../src/render/fallback.js'
import type { Target, Template } from '../../src/template.js'
import { loadTestFonts } from '../helpers.js'
import { configOf, upload } from '../presets/harness.js'

/** Uploads 1, 3, 4, 5 are published; upload 2 only exists as a draft. A read that carries the published predicate never sees 2. */
const MEDIA: Record<number, Record<string, unknown>> = {
  1: { ...upload(1, 'hero.jpg', 1200, 800), _status: 'published' },
  2: { ...upload(2, 'draft.jpg', 1200, 800), _status: 'draft' },
  3: { ...upload(3, 'a.jpg', 1200, 800), _status: 'published' },
  4: { ...upload(4, 'b.jpg', 1200, 800), _status: 'published' },
  5: { ...upload(5, 'c.jpg', 1200, 800), _status: 'published' },
}

/** The real source over a fake Payload that records every find, wired into a real handler (no drawing). */
export function setup(
  input: OgImagePluginInput,
  posts: Record<string, unknown>[] = [{ id: 10, slug: 'a', title: 'A', heroImage: 1 }],
  extra: { targets?: Record<string, Target>; templates?: Template<any>[]; fields?: unknown[] } = {},
) {
  const finds: Array<Record<string, any>> = []
  const config = configOf()
  ;((config.collections?.find((c) => c.slug === 'posts')?.fields ?? []) as unknown[]).push({
    name: 'photos',
    type: 'upload',
    relationTo: 'media',
    hasMany: true,
  })
  ;((config.collections?.find((c) => c.slug === 'posts')?.fields ?? []) as unknown[]).push(...(extra.fields ?? []))
  const targetName = Object.keys(extra.targets ?? {})[0] ?? 'posts'
  const collections = Object.fromEntries(
    (config.collections ?? []).map((c) => [c.slug, { config: { ...c, versions: c.slug === 'users' ? undefined : { drafts: true } } }]),
  )
  const payload = {
    config: { admin: { user: 'users' } },
    collections,
    find: async (a: Record<string, any>) => {
      finds.push(a)
      if (a.collection === 'media') {
        const match = a.where?.and?.[0]?.id ?? a.where?.id
        const wanted: number[] = match?.in ?? [match?.equals as number]
        const publishedOnly = JSON.stringify(a.where ?? {}).includes('"published"')
        const docs = wanted.flatMap((id) => {
          const hit = MEDIA[id]
          return hit && (a.draft === true || !publishedOnly || hit._status === 'published') ? [{ ...hit }] : []
        })
        return { docs, totalDocs: docs.length }
      }
      const id = a.where?.and?.[1]?.id?.equals ?? a.where?.id?.equals
      const slug = a.where?.and?.[0]?.slug?.equals
      const docs = posts.filter((p) => (slug === undefined ? p.id === id : p.slug === slug)).map((p) => structuredClone(p))
      return { docs, totalDocs: docs.length }
    },
  } as unknown as Payload
  const expanded = expandPresets(input, config)
  const options = { ...expanded, targets: { ...expanded.targets, ...extra.targets } }
  const source = payloadSource(payload, createState(options, 'https://www.example.test'), async () => ({ name: 'S' }))
  const handler = createCardHandler({
    targets: options.targets,
    statics: {},
    templates: new Map([...options.templates, ...(extra.templates ?? [])].map((t) => [t.id, t])),
    fonts: () => loadTestFonts(),
    stacks: options.stacks,
    serverUrl: 'https://www.example.test',
    source,
    store: memoryStore(),
    renderer: { render: async () => new Uint8Array() },
    heroLoader: (async () => null) as never,
    uploadCollection: 'media',
    uploadFields: (c: string) => uploadFieldsOf((collections[c]?.config as unknown as { fields?: never })?.fields),
    gate: createGate(),
    memo: createMemo(),
    events: { emit: () => {} },
    isDraftRequest: async () => false,
    fallback: fallbackTemplate,
  } as never)
  const resolveDoc = (doc: Record<string, any> | null) => handler.resolve({ target: targetName, doc: doc as never }, { previewing: false })
  const resolve = async (slug: string) => resolveDoc(await source.published(targetName, slug))
  const mediaFinds = () => finds.filter((f) => f.collection === 'media')
  const docFinds = () => finds.filter((f) => f.collection === 'posts')
  return { source, finds, mediaFinds, docFinds, payload, resolve, resolveDoc }
}
