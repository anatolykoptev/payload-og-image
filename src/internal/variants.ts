import type { Target } from '../template.js'

/** A variant name is part of a URL segment and of a target name: lower-case letters, digits and hyphens. */
export const VARIANT_NAME = /^[a-z0-9-]+$/

/** The name of the hidden sibling target a variant expands into. `~` cannot start a user-chosen variant (see `VARIANT_NAME`), so it never collides. */
export const variantTargetName = (target: string, variant: string) => `${target}~${variant}`

const fail = (msg: string): never => {
  throw new Error(`payload-og-image: ${msg}`)
}

/**
 * The siblings this module generated. Provenance, not shape: an existing `<name>~<variant>` entry is kept only if it is one of these, so a hand-written
 * target of that name is refused however closely it copies the generated one. Module-local, a WeakSet so no target is kept alive: expansion happens in one
 * module graph. A second copy of this module that meets a sibling it did not build treats it as hand-written and refuses it with the same named error.
 */
const generated = new WeakSet<object>()

/**
 * Each declared variant becomes a hidden sibling target `<name>~<variant>` with kind `<kind>-<variant>`: the same collection, `props()`,
 * hero, share rules, format and slug field as its parent, its own path and template. Everything downstream (route, store, version,
 * etag) then treats it as one more target, so none of it changes. A sibling sits right after its parent, so lookups by collection
 * still find the parent first. The parent keeps its `variants`, and a sibling that is already there, as expanded from it, is kept: expanding twice changes nothing.
 * Nothing is remembered outside the targets: which target is a variant is read back from the parent's `variants` (`isVariantName`), so any copy of this module agrees. Targets without variants are
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
    out.set(name, t)
    for (const [variant, v] of Object.entries(variants)) {
      if (!VARIANT_NAME.test(variant)) fail(`target "${name}" variant name "${variant}" must match [a-z0-9-]+`)
      const sibling = variantTargetName(name, variant)
      const kind = `${t.kind ?? name}-${variant}`
      const have = Object.hasOwn(targets, sibling) ? targets[sibling] : undefined
      const target: Target = { ...parent, collection: t.collection ?? name, path: v.path, kind, template: v.template }
      if (have !== undefined && generated.has(have)) {
        out.set(sibling, have) // already expanded from this very declaration
        continue
      }
      if (have !== undefined || out.has(sibling))
        fail(
          `target "${name}" variant "${variant}" collides with the target "${sibling}" (a target of that name already exists: one written by hand, or one expanded by another copy of this package; remove it, the variant creates it)`,
        )
      if (kinds.has(kind)) fail(`target "${name}" variant "${variant}" has the kind "${kind}", which another target already uses`)
      kinds.add(kind)
      generated.add(target)
      out.set(sibling, target)
    }
  }
  return Object.fromEntries(out)
}

/** The variant names declared on `target`, in declaration order. */
export const variantsOf = (targets: Record<string, Target>, target: string): string[] =>
  Object.keys(Object.hasOwn(targets, target) ? (targets[target]?.variants ?? {}) : {}).filter((v) =>
    Object.hasOwn(targets, variantTargetName(target, v)),
  )

/** True when `name` is the hidden sibling some target's `variants` expanded into. Read from the targets themselves, never from module state. */
export const isVariantName = (targets: Record<string, Target>, name: string): boolean =>
  Object.entries(targets).some(([parent, t]) => Object.keys(t.variants ?? {}).some((v) => variantTargetName(parent, v) === name))

/** The options with every target's variants expanded. Safe to apply twice: every state builder goes through it. */
export const withVariants = <O extends { targets?: Record<string, Target> }>(o: O): O => {
  const targets = expandVariants(o.targets ?? {})
  return targets === o.targets ? o : { ...o, targets }
}
