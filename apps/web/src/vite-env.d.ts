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
}
