import type { Target } from '../template.js'

/**
 * The upload fields (dotted paths) a target draws from a document, when the target can say so: a preset collection knows its hero
 * and share-image paths, and a forced-text preset has no hero to read. A target not in the map is a hand-written one whose resolvers are
 * opaque functions, so every upload field it holds is read. A WeakMap, so no target is changed or kept alive.
 */
export const uploadNeeds = new WeakMap<Target, (doc: unknown) => ReadonlySet<string>>()

/**
 * The upload collection `populateUploads` read an upload object from (its field's `relationTo`). Only the object it returned is in the map, so a
 * hand-built or copied object has none. It names where to read the hero again, never that the object may be trusted: the read is still made.
 */
export const uploadSource = new WeakMap<object, string>()
