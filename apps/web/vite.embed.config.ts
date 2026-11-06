/**
 * The embedded page's script (nextcloud-build decision 1): `src/embed.ts` as
 * ONE classic IIFE in `dist-embed/embed.js`. No code splitting, no dynamic
 * import, no ESM syntax — AppAPI's page CSP (`'strict-dynamic' 'nonce-…'`)
 * trusts the registered script alone. `scripts/assert-embed-single-bundle.mjs`
 * fails the build if that ever stops being true.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-embed',
    emptyOutDir: true,
    target: 'es2020',
    minify: true,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./src/embed.ts', import.meta.url)),
      formats: ['iife'],
      name: 'OhhiEmbed',
      fileName: () => 'embed.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})
