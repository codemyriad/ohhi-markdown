import { defineConfig } from '@playwright/test'

/**
 * L2: ONE Chromium two-context smoke per PR (shape D9). Spawns the real
 * relay (fresh temp db, deterministic share via SEED_SHARE) and the built
 * web app, then drives seeder + joiner browser contexts.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/start-relay.mjs',
      port: 8799,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        'node ../../common/scripts/install-run-rushx.js build && ./node_modules/.bin/vite preview --port 4173 --strictPort',
      port: 4173,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
