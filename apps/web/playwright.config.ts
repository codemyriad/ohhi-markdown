import { defineConfig } from '@playwright/test'

/**
 * The live Nextcloud end-to-end (`e2e/nextcloud-live.spec.ts`) runs against a
 * running Nextcloud stack with the ExApp installed — never in the default run.
 * `OHHI_NC_E2E=1` selects it and ONLY it: it needs neither the e2e relay nor
 * the preview build (the stack serves both), so the webServers are skipped.
 */
const NC_LIVE = !!process.env.OHHI_NC_E2E

/**
 * L2: ONE Chromium two-context smoke per PR (shape D9). Spawns the real
 * relay (fresh temp db, deterministic share via SEED_SHARE) and the built
 * web app, then drives seeder + joiner browser contexts.
 */
export default defineConfig({
  testDir: './e2e',
  // shots.spec.ts is a manual screenshot pass over the themes, not a gate —
  // run it explicitly with `playwright test e2e/shots.spec.ts`.
  // Set SHOT_DIR to include it (see docs/running-and-testing.md).
  testIgnore: [...(process.env.SHOT_DIR ? [] : ['**/shots.spec.ts']), ...(NC_LIVE ? [] : ['**/nextcloud-live.spec.ts'])],
  ...(NC_LIVE ? { testMatch: '**/nextcloud-live.spec.ts' } : {}),
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: NC_LIVE ? [] : [
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
