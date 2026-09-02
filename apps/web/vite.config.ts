import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: { port: 5173 },
  test: {
    // Unit tests only. The Playwright L2 specs in e2e/ are driven by `rushx e2e`
    // (playwright test) — vitest must not try to collect them.
    include: ['src/**/*.test.ts'],
  },
})
