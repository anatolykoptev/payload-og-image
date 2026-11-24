import type { Config, Field } from 'payload'
import type { Target } from '../template.js'

/** What the `og` group stores on a document. Every member is optional: a document that never saw the group has none. */
export type OgDocFields = {
  mode?: 'inherit' | 'generated' | 'custom' | 'off' | null
  headline?: string | null
  subtitle?: string | null
}

export type OgFieldsOption = { enabled: boolean; position?: 'sidebar' | 'tab' }

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
    ],
  }) as Field

/**
 * The `og` field group, for a site that places it itself, for example inside plugin-seo:
 * `seoPlugin({ fields: ({ defaultFields }) => [...defaultFields, ...ogFields()] })`.
 */
export function ogFields(): Field[] {
  return [group('sidebar')]
}

const carriesOg = (fields: Field[] | undefined): boolean =>
  (fields ?? []).some((f) => {
    const x = f as { name?: string; fields?: Field[]; tabs?: Array<{ fields?: Field[] }> }
    return x.name === 'og' || carriesOg(x.fields) || (x.tabs ?? []).some((t) => carriesOg(t.fields))
  })

/** The config with the group added to each target's collection. The same object when the option is off: the schema is then exactly 0.1. */
export function withOgFields(config: Config, targets: Record<string, Target>, option: OgFieldsOption | undefined): Config {
  if (!option?.enabled || !config.collections) return config
  const wanted = new Set(Object.entries(targets).map(([name, t]) => t.collection ?? name))
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
