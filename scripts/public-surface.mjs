// The agreed public runtime surface (S§D1), one list for both gates: test/surface.spec.ts checks the source entries,
// scripts/verify-pack.mjs checks the packed tarball. v0.7.0's publish failed because the two lists had drifted.
export const PUBLIC_SURFACE = {
  'payload-og-image': ['defineTarget', 'defineTemplate', 'ogFields', 'ogImagePlugin'],
  'payload-og-image/next': ['OG_SITE_TAG', 'createOgRoute', 'ogImages', 'ogMetadata', 'ogTag', 'withHead'],
  'payload-og-image/testing': ['installTestRuntime', 'ogKit'],
  'payload-og-image/mcp': ['ogImageMcpToolMap'],
  'payload-og-image/mcp/v3': ['ogImageMcpTools'],
}
