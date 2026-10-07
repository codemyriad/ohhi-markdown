import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { searchForWorkspaceRoot } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: {
    port: 5173,
    // The bundled faces live in libs/ui/fonts/ and fonts.css names them with
    // relative url()s, which `vite dev` serves as /@fs/<realpath>. Rush has no
    // root pnpm-workspace.yaml, so Vite's workspace root is apps/web and every
    // woff2 outside it was a 403 — the console's "font can't be found" errors
    // (round 3 Q7). Allow exactly that folder, beside the default root. A
    // build is unaffected: Vite emits the files as assets.
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), fileURLToPath(new URL('../../libs/ui/fonts', import.meta.url))],
    },
  },
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
