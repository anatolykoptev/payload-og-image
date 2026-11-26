import { photoPreset, textPreset } from './templates.js'

export type { PresetProps } from './layout.js'

/** The two built-in templates, for a site that draws them from a target of its own (props: `title`, `subtitle`, `label`, `site`, `byline`, and the slots `pill`, `pill2`, `badge`, `caption`, `meta`). */
export const presets = { text: textPreset, photo: photoPreset } as const
