/** Build-time variables, inlined by Vite — documented in `apps/web/.env.example`. */
interface ImportMetaEnv {
  /** The relay a fresh install proposes; see `resolveDefaultRelay` in src/lib/config.ts. */
  readonly VITE_DEFAULT_RELAY?: string
  /** Where the operator secret lives, one sentence; see `TEAM_SECRET_HINT` in src/lib/config.ts. */
  readonly VITE_TEAM_SECRET_HINT?: string
  /** Reachability, one sentence; see `TEAM_NETWORK_NOTE` in src/lib/config.ts. */
  readonly VITE_TEAM_NETWORK_NOTE?: string
  /** The host the build's CSP is pinned to (bare host); see `TEAM_HOST` in src/lib/config.ts. */
  readonly VITE_TEAM_HOST?: string
  /** The build flavour, `team` | `public` (scripts/flavour.mjs); read by vite.config.ts, not the app. */
  readonly VITE_FLAVOUR?: string
  /** The desktop downloads list (`downloads.json`); see `DOWNLOADS_URL` in src/lib/config.ts. */
  readonly VITE_DOWNLOADS_URL?: string
  /** The public web app's origin, for a desktop build's share links; see `WEB_ORIGIN` in src/lib/config.ts. */
  readonly VITE_WEB_ORIGIN?: string
}
