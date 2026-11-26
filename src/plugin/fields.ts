import type { Config, Field } from 'payload'
import { hexColour } from '../internal/colour.js'
import type { Target } from '../template.js'

/** What the `og` group stores on a document. Every member is optional: a document that never saw the group has none. */
export type OgDocFields = {
  mode?: 'inherit' | 'generated' | 'custom' | 'off' | null
  headline?: string | null
  subtitle?: string | null
  label?: string | null
  accent?: string | null
}

export type OgFieldsOption = { enabled: boolean; position?: 'sidebar' | 'tab' }

const normaliseAccent = ({ value }: { value?: unknown }) => (typeof value === 'string' ? (hexColour(value.trim()) ?? value) : value)
const validateAccent = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'string' && (value.trim() === '' || hexColour(value.trim()) !== undefined))
    ? true
    : 'Use a hex colour: #rgb or #rrggbb'

const group = (position: 'sidebar' | undefined): Field =>
  ({
    type: 'group',
    name: 'og',
    label: 'Share card',
    ...(position ? { admin: { position } } : {}),
    fields: [
      {
        name: 'mode',
        type: 'select',
        defaultValue: 'inherit',
        label: 'Share image',
        options: [
          { label: 'Automatic: the page image if there is one, else a generated card', value: 'inherit' },
          { label: 'Always a generated card', value: 'generated' },
          { label: 'The page image only (a generated card if it cannot be shared)', value: 'custom' },
          { label: 'No share image', value: 'off' },
        ],
      },
      {
        name: 'headline',
        type: 'text',
        label: 'Card headline',
        admin: { description: 'Replaces the page title on the generated card. Leave empty to use the title.' },
      },
      {
        name: 'subtitle',
        type: 'text',
        label: 'Card subtitle',
        admin: { description: 'A second line on the generated card, where the template draws one.' },
      },
      {
        name: 'label',
        type: 'text',
        label: 'Card label',
        maxLength: 30,
        admin: {
          description:
            'The short category line of the generated card, drawn beside the site name only when it fits (about 30 characters). Leave empty to use the collection’s label.',
        },
      },
      {
        name: 'accent',
        type: 'text',
        label: 'Card accent colour',
        admin: {
          description:
            'A hex colour such as #3366ff for the strip and pills of this card. Shown on the text card only; a photo card draws no accent. Leave empty for the preset’s accent.',
        },
        // Saved as lowercase `#rrggbb`; the same reader (`hexColour`) is what the card draws from, so a stored value cannot disagree.
        hooks: { beforeValidate: [normaliseAccent] },
        validate: validateAccent,
      },
      {
        // Bumped by the preview's "Force new image" button: part of the card's version, so a bump is a new URL.
        name: 'nonce',
        type: 'number',
        defaultValue: 0,
        admin: { hidden: true },
      },
      {
        name: 'preview',
        type: 'ui',
        admin: { components: { Field: 'payload-og-image/client#OgPreviewField' } },
      },
    ],
  }) as Field

/**
 * The `og` field group, for a site that places it itself. It must stay a top-level field of the collection named `og`
 * (directly, or inside a row, a collapsible or an unnamed tab): the plugin reads `doc.og` and nothing nested.
 */
export function ogFields(): Field[] {
  return [group('sidebar')]
}

type Node = {
  name?: string
  type?: string
  fields?: Field[]
  tabs?: Array<{ name?: string; fields?: Field[] }>
  blocks?: Array<{ fields?: Field[] }>
}

/** Children that live at the same level of the document as the container itself: rows, collapsibles, unnamed tabs. */
const flatChildren = (f: Node): Field[][] =>
  f.type === 'row' || f.type === 'collapsible'
    ? [f.fields ?? []]
    : f.type === 'tabs'
      ? (f.tabs ?? []).filter((t) => !t.name).map((t) => t.fields ?? [])
      : []

/** Children that live one level down in the data (named groups, arrays, named tabs, blocks). */
const nestedChildren = (f: Node): Array<[string, Field[]]> => {
  const out: Array<[string, Field[]]> = []
  if (f.type === 'tabs') for (const t of f.tabs ?? []) if (t.name) out.push([t.name, t.fields ?? []])
  if (f.type === 'blocks') for (const b of f.blocks ?? []) out.push([f.name ?? 'blocks', b.fields ?? []])
  if ((f.type === 'group' || f.type === 'array') && f.name) out.push([f.name, f.fields ?? []])
  return out
}

/** `og` is a top-level field of the document: it is found at the top, or inside containers that add no level (row, collapsible, unnamed tab). */
const carriesOg = (fields: Field[] | undefined): boolean =>
  (fields ?? []).some((f) => (f as Node).name === 'og' || flatChildren(f as Node).some(carriesOg))

/** The path of an `og` field hidden under a named group, array, named tab or block, which nothing reads. */
const nestedOg = (fields: Field[] | undefined, prefix: string[] = []): string | undefined => {
  for (const f of fields ?? []) {
    const n = f as Node
    for (const flat of flatChildren(n)) {
      const hit = nestedOg(flat, prefix)
      if (hit) return hit
    }
    for (const [name, inner] of nestedChildren(n)) {
      const here = [...prefix, name]
      if (inner.some((x) => (x as Node).name === 'og')) return [...here, 'og'].join('.')
      const hit = nestedOg(inner, here)
      if (hit) return hit
    }
  }
  return undefined
}

/** True when some target's collection has the `og` group at the top level (placed by the plugin or by hand). */
export function targetsCarryOg(config: Config, targets: Record<string, Target>): boolean {
  const wanted = new Set(Object.entries(targets).map(([name, t]) => t.collection ?? name))
  return (config.collections ?? []).some((c) => wanted.has(c.slug) && carriesOg(c.fields))
}

/** The config with the group added to each target's collection. The same object when the option is off: the schema is then exactly 0.1. */
export function withOgFields(config: Config, targets: Record<string, Target>, option: OgFieldsOption | undefined): Config {
  if (!config.collections) return config
  const wanted = new Set(Object.entries(targets).map(([name, t]) => t.collection ?? name))
  for (const c of config.collections) {
    if (!wanted.has(c.slug) || carriesOg(c.fields)) continue
    const hidden = nestedOg(c.fields)
    if (hidden)
      console.warn(
        `payload-og-image: collection "${c.slug}" has a field "${hidden}", but the \`og\` group is read only at the top level of the document, so it does nothing. Move it to the top level (or enable the \`fields\` option).`,
      )
  }
  if (!option?.enabled) return config
  const tab = option.position === 'tab'
  const collections = config.collections.map((c) => {
    if (!wanted.has(c.slug) || carriesOg(c.fields)) return c
    if (!tab) return { ...c, fields: [...c.fields, ...ogFields()] }
    const own = { label: 'Share card', fields: [group(undefined)] }
    // Join the collection's first top-level tabs field, else append one of our own.
    const at = c.fields.findIndex((f) => f.type === 'tabs')
    if (at === -1) return { ...c, fields: [...c.fields, { type: 'tabs', tabs: [own] } as Field] }
    const existing = c.fields[at] as Extract<Field, { type: 'tabs' }>
    const joined = { ...existing, tabs: [...existing.tabs, own] } as Field
    return { ...c, fields: c.fields.map((f, i) => (i === at ? joined : f)) }
  })
  return { ...config, collections }
}
