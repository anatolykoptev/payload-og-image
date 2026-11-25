import type { Target } from '../template.js'

/** A variant name is part of a URL segment and of a target name: lower-case letters, digits and hyphens. */
export const VARIANT_NAME = /^[a-z0-9-]+$/

/** The name of the hidden sibling target a variant expands into. `~` cannot start a user-chosen variant (see `VARIANT_NAME`), so it never collides. */
export const variantTargetName = (target: string, variant: string) => `${target}~${variant}`

const fail = (msg: string): never => {
  throw new Error(`payload-og-image: ${msg}`)
}

/**
 * Each declared variant becomes a hidden sibling target `<name>~<variant>` with kind `<kind>-<variant>`: the same collection, `props()`,
 * hero, share rules, format and slug field as its parent, its own path and template. Everything downstream (route, store, version,
 * etag) then treats it as one more target, so none of it changes. A sibling sits right after its parent, so lookups by collection
 * still find the parent first. Targets without variants are returned as they are (the same object when none has any).
 */
export function expandVariants(targets: Record<string, Target>): Record<string, Target> {
  if (!Object.values(targets).some((t) => t.variants !== undefined)) return targets
  const out = new Map<string, Target>()
  const kinds = new Set(Object.entries(targets).map(([name, t]) => t.kind ?? name))
  for (const [name, t] of Object.entries(targets)) {
    out.set(name, t)
    if (t.variants === undefined) continue
    if (t.variants === null || typeof t.variants !== 'object' || Array.isArray(t.variants))
      fail(`target "${name}" variants must be an object of { path, template } by name`)
    const { variants, ...parent } = t
    for (const [variant, v] of Object.entries(variants)) {
      if (!VARIANT_NAME.test(variant)) fail(`target "${name}" variant name "${variant}" must match [a-z0-9-]+`)
      const sibling = variantTargetName(name, variant)
      const kind = `${t.kind ?? name}-${variant}`
      if (Object.hasOwn(targets, sibling) || out.has(sibling))
        fail(`target "${name}" variant "${variant}" collides with the target "${sibling}"`)
      if (kinds.has(kind)) fail(`target "${name}" variant "${variant}" has the kind "${kind}", which another target already uses`)
      kinds.add(kind)
      out.set(sibling, {
        ...parent,
        collection: t.collection ?? name,
        path: v.path,
        kind,
        template: v.template,
        variantOf: { target: name, name: variant },
      })
    }
  }
  return Object.fromEntries(out)
}

/** The variant names declared on `target` (in declaration order), read from the expanded targets. */
export const variantsOf = (targets: Record<string, Target>, target: string): string[] =>
  Object.values(targets)
    .filter((t) => t.variantOf?.target === target)
    .map((t) => (t.variantOf as { name: string }).name)
