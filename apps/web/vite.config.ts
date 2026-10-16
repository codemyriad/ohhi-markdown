import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { searchForWorkspaceRoot } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  // The build's version for the Help menu in a browser (help.svelte.ts
  // BUILD_VERSION): the release workflow's VERSION; '' in a local build. The
  // desktop asks Tauri for its own instead.
  define: { __OHHI_VERSION__: JSON.stringify(process.env.VERSION ?? '') },
  server: {
    port: 5173,
    // The bundled faces live in libs/ui/fonts/ and fonts.css names them with
    // relative url()s, which `vite dev` serves as /@fs/<realpath>. Rush has no
    // root pnpm-workspace.yaml, so Vite's workspace root is apps/web and every
    // woff2 outside it was a 403 — the console's "font can't be found" errors
    // (round 3 Q7). Allow exactly that folder, beside the default root. A
    // build is unaffected: Vite emits the files as assets.
    fs: {
      // The example custom themes are bundled the same way (`theme-examples.ts`,
      // `?raw`), so Settings › Appearance can add one to a vault.
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        fileURLToPath(new URL('../../libs/ui/fonts', import.meta.url)),
        fileURLToPath(new URL('../../examples/themes', import.meta.url)),
      ],
    },
  },
  // Component tests need Svelte's BROWSER build: the SSR build has no mount()
  // and every render throws `lifecycle_function_unavailable`.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    // Unit tests only. The Playwright L2 specs in e2e/ are driven by `rushx e2e`
    // (playwright test) — vitest must not try to collect them.
    // …plus the build scripts' own tests (scripts/build-guide.test.mjs).
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    // Pure modules run on node (their localStorage tests carry their own
    // stubs); a component test opts into jsdom with a
    // `// @vitest-environment jsdom` docblock on its first line.
    setupFiles: ['./src/test-setup.ts'],
    // Vitest blanks every .css import by default, `?raw` included; the
    // example themes are text the app writes into a vault, so tests read them.
    css: { include: [/examples\/themes\/.*\.css/] },
  },
})
