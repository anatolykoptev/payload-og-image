// The agreed public runtime surface (S§D1), one list for both gates: test/surface.spec.ts checks the source entries,
// scripts/verify-pack.mjs checks the packed tarball. v0.7.0's publish failed because the two lists had drifted.
export const PUBLIC_SURFACE = {
  'payload-og-image': ['defineTarget', 'defineTemplate', 'ogFields', 'ogImagePlugin', 'presets'],
  'payload-og-image/next': ['OG_SITE_TAG', 'createOgRoute', 'ogImages', 'ogMetadata', 'ogTag', 'withHead'],
  'payload-og-image/testing': ['installTestRuntime', 'ogKit'],
  'payload-og-image/mcp': ['ogImageMcpToolMap'],
  'payload-og-image/mcp/v3': ['ogImageMcpTools'],
}

// Entries that need an optional peer to load. verify-pack imports every other entry in a clean project with no optional
// peers installed, then installs these peers (at the range package.json declares) and imports the entries listed here.
// v0.7.1's publish failed because the mcp/v3 entry, which imports zod, was checked in the peerless project.
export const ENTRY_PEERS = {
  'payload-og-image/mcp/v3': ['zod'],
}
