import type { Target } from '../template.js'

/** Which hidden sibling targets are variants, and of what. Kept here, not on `Target`: a user cannot declare a target a variant. */
const siblings = new WeakMap<Target, { target: string; name: string }>()

/** True for the hidden sibling target a variant expanded into. */
export const isVariant = (t: Target): boolean => siblings.has(t)

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
 * still find the parent first. The parent comes back without its `variants`, so expanding twice changes nothing. Targets without variants are
 * returned as they are (the same object when none has any).
 */
export function expandVariants(targets: Record<string, Target>): Record<string, Target> {
  if (!Object.values(targets).some((t) => t.variants !== undefined)) return targets
  const out = new Map<string, Target>()
  const kinds = new Set(Object.entries(targets).map(([name, t]) => t.kind ?? name))
  for (const [name, t] of Object.entries(targets)) {
    if (t.variants === undefined) {
      out.set(name, t)
      continue
    }
    if (t.variants === null || typeof t.variants !== 'object' || Array.isArray(t.variants))
      fail(`target "${name}" variants must be an object of { path, template } by name`)
    const { variants, ...parent } = t
    out.set(name, parent)
    for (const [variant, v] of Object.entries(variants)) {
      if (!VARIANT_NAME.test(variant)) fail(`target "${name}" variant name "${variant}" must match [a-z0-9-]+`)
      const sibling = variantTargetName(name, variant)
      const kind = `${t.kind ?? name}-${variant}`
      if (Object.hasOwn(targets, sibling) || out.has(sibling))
        fail(`target "${name}" variant "${variant}" collides with the target "${sibling}"`)
      if (kinds.has(kind)) fail(`target "${name}" variant "${variant}" has the kind "${kind}", which another target already uses`)
      kinds.add(kind)
      const target: Target = { ...parent, collection: t.collection ?? name, path: v.path, kind, template: v.template }
      siblings.set(target, { target: name, name: variant })
      out.set(sibling, target)
    }
  }
  return Object.fromEntries(out)
}

/** The variant names declared on `target` (in declaration order), read from the expanded targets. */
export const variantsOf = (targets: Record<string, Target>, target: string): string[] =>
  Object.values(targets).flatMap((t) => {
    const of = siblings.get(t)
    return of?.target === target ? [of.name] : []
  })

/** The options with every target's variants expanded. Safe to apply twice: every state builder goes through it. */
export const withVariants = <O extends { targets?: Record<string, Target> }>(o: O): O => {
  const targets = expandVariants(o.targets ?? {})
  return targets === o.targets ? o : { ...o, targets }
}
