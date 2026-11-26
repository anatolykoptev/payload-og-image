// The one walk over a collection's field tree, shared by what the plugin reads from a schema: the preset detector (src/presets/detect.ts) and the
// upload reader (uploads.ts `uploadFieldsOf`). Pure functions of the (unsanitized) collection config.

export type Field = {
  type?: string
  name?: string
  fields?: Field[]
  tabs?: Array<{
    fields?: Field[]
    name?: string
    hidden?: boolean
    admin?: { hidden?: boolean; disabled?: boolean }
    access?: { read?: unknown }
  }>
  relationTo?: unknown
  hasMany?: boolean
  hidden?: boolean
  admin?: { hidden?: boolean; disabled?: boolean }
  access?: { read?: unknown }
}

/** A named leaf field: `keys` is where it sits in a document, `path` the same dotted; `blocked` is why it cannot be drawn (its own or an ancestor's). */
export type Entry = { keys: string[]; path: string; field: Field; blocked?: string }

/** Why a container (group, tab, row) restricts what is inside it, or undefined. Only the preset detector asks; a caller without one never evaluates an access function. */
export type Restrict = (container: Field | NonNullable<Field['tabs']>[number]) => string | undefined

/** Every named leaf field with its path, through groups, tabs, rows and collapsibles. */
export function flatFields(fields: Field[] | undefined, restrict?: Restrict, prefix: string[] = [], blocked?: string): Entry[] {
  const out: Entry[] = []
  for (const f of fields ?? []) {
    // Every container passes its restriction (its own, or the one it inherited) to everything inside it.
    const own = blocked ?? restrict?.(f)
    if (f.type === 'group' && f.name) out.push(...flatFields(f.fields, restrict, [...prefix, f.name], own))
    else if (f.type === 'tabs')
      for (const t of f.tabs ?? []) out.push(...flatFields(t.fields, restrict, t.name ? [...prefix, t.name] : prefix, own ?? restrict?.(t)))
    else if (!f.name && f.fields) out.push(...flatFields(f.fields, restrict, prefix, own))
    else if (f.name) {
      const keys = [...prefix, f.name]
      out.push({ keys, path: keys.join('.'), field: f, ...(own ? { blocked: own } : {}) })
    }
  }
  return out
}

/** A single-valued upload field with a known upload collection. A `hasMany` upload stays a list of bare ids. */
export const singleUpload = (e: Entry) => e.field.type === 'upload' && typeof e.field.relationTo === 'string' && !e.field.hasMany
