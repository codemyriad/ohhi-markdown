import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: { port: 5173 },
  // Component tests need Svelte's BROWSER build: the SSR build has no mount()
  // and every render throws `lifecycle_function_unavailable`.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    // Unit tests only. The Playwright L2 specs in e2e/ are driven by `rushx e2e`
    // (playwright test) — vitest must not try to collect them.
    include: ['src/**/*.test.ts'],
    // Pure modules run on node (their localStorage tests carry their own
    // stubs); a component test opts into jsdom with a
    // `// @vitest-environment jsdom` docblock on its first line.
    setupFiles: ['./src/test-setup.ts'],
  },
})
