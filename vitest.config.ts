import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    // The package imports itself by name in the dev app; point those at the sources.
    alias: [
      { find: /^payload-og-image\/testing$/, replacement: at('./src/exports/testing.ts') },
      { find: /^payload-og-image\/client$/, replacement: at('./src/exports/client.ts') },
      { find: /^payload-og-image\/next$/, replacement: at('./src/exports/next.ts') },
      { find: /^payload-og-image$/, replacement: at('./src/exports/index.ts') },
      { find: /^@payload-config$/, replacement: at('./dev/payload.config.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.{ts,tsx}', 'dev/tests/**/*.spec.ts'],
    testTimeout: 30_000,
  },
})
