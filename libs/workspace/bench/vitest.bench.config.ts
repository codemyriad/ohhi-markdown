/**
 * Bench-only vitest config (S10-Q4). Kept out of the package root on purpose:
 * `rushx test` uses vitest's defaults, whose include glob
 * (`**​/*.{test,spec}.*`) never matches `bench/*.bench.ts`.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: new URL('..', import.meta.url).pathname,
    include: ['bench/**/*.bench.ts'],
    testTimeout: 90 * 60_000,
    hookTimeout: 10 * 60_000,
    // One relay + up to ~2k sockets per file: never run these in parallel.
    fileParallelism: false,
    pool: 'forks',
  },
})
