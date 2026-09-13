# Editor monorepo — Claude instructions

Editor is a collaborative, agent-native markdown editor: a drop-in replacement for Obsidian over a plain-markdown vault. Files on disk are the source of truth; CRDTs (Yjs) handle sync/collab; agents are first-class collaborators.

## Read first

- `plans/frame.md` — why this exists (verbatim source + problem/outcome)
- `plans/shaping.md` — requirements, shapes A–D, fit check, decision log, spikes
- `plans/slices.md` — V1 (tracer bullet) → V4 + Later list
- `plans/v2-shaping.md` — V2 daily-driver core: which Obsidian-comparable capabilities are load-bearing (decided from measured vault evidence), plus the design system. Amends `shaping.md` D5(a) and D3; adds Spike S9
- `plans/agent-surface-shaping.md` — the agent surface (`ohhi` CLI, skill, MCP),
  context-frugal queries and search precision; build brief in
  `plans/agent-surface-build.md`. Sub-shaping of `shaping.md` D7/D5(a1)
- `plans/research/` — 13 web-grounded research notes + 3 architecture proposals

Plans are ground truth. If implementation diverges from a plan, update the plan in the same change (multi-level consistency: frame → shaping → slices → code).

## Repo layout

Rush monorepo (same conventions as the Edible repo). Packages are created per-slice — `rush.json`'s projects list is the source of truth; V1 creates `apps/web`, `apps/desktop` (Tauri 2), `apps/relay` (Hocuspocus v4), `libs/sync`, `libs/vault`, `libs/editor`, `libs/testkit`. Naming: `@editor/<name>`.

Packages beyond V1's set, created by their slices: `libs/workspace` (M1),
`libs/ui` (V2a — design tokens + themes), `libs/index` (V2b — the derived
index), `libs/editor-lang` (V2c — wikilink grammar), `libs/frontmatter` (V2e —
the flat-subset YAML reader and one-line-range patcher every frontmatter
writer goes through), `libs/agent` (G1 — the host-neutral command core behind
the agent surface) and `apps/cli` (G1 — the `ohhi` binary, bin name `ohhi`,
plus `ohhi mcp`), `libs/i18n` (the dictionaries + typesafe-i18n wiring,
laid out as Edible's `@edible/shared/i18n`;
every user-facing string in `apps/web` is a `$LL.…()` / `getLL()` key — see
`.claude/skills/ui-development`). The shell's component
primitives (Melt UI + lucide: `Dialog`, menus, `Tooltip`, `IconButton`,
`Tabs`, `Toaster`, form fields) live in `apps/web/src/lib/ui/` (chrome U1).

Toolchain: Rush 5.153.0, pnpm 10.17.0, Node 22.12 (`.nvmrc`). Use `rush install` / `rushx <script>`; see `.claude/skills/monorepo-rush`.

## Golden rules (from shaping — do not violate without updating plans/shaping.md)

1. **Files are canonical.** Editor never holds the only copy of content. Any Editor-initiated disk write goes through the pre-image journal + atomic temp-fsync-rename.
2. **Never reserialize what you didn't change.** Frontmatter edits are surgical byte-preserving patches (parse-only YAML); untouched bytes stay untouched — no spurious git diffs.
3. **Always-on CRDT for enrolled docs; no CRDT at all for tracked (never-shared) files.** There is no "dormant" mode — that was adversarially proven to lose data (see Decision log, Offline/collab seam).
4. **Sync state never lies.** The pill is a pure `f(syncRecord)`; green requires durable (fsynced) relay ack. Tested under partition in the harness.
5. **Injected clock/scheduler in all Editor-owned sync, reconciler and index code** (lint-enforced across `libs/sync`, `libs/vault`, `libs/index`; a documented `clock-exempt` marker covers diagnostics that schedule nothing) — deterministic simulation is the foundation of the test harness.
6. **Collab correctness is tested, not hoped:** L0 fast-check model tests, L1 reconciler fuzz (memfs, `fuzz-crashers/` corpus), L2 two-context Playwright smoke. See `.claude/skills/testing`.
7. **The UI renders through design tokens, never raw palette utilities.** One token layer drives the Svelte chrome and the CodeMirror surface alike; the sync-honesty tokens are unlayered so no user theme can repaint the pill (golden rule 4, expressed in the cascade). `scripts/check-design-tokens.sh` is a build gate, and `apps/web/e2e/a11y.spec.ts` (axe over every shell surface) gates accessibility the same way — no overlay, menu or icon control outside `apps/web/src/lib/ui/`. See `docs/theming.md` and `.claude/skills/ui-development`.
8. **The index is derived, never a system of record.** Droppable by construction: losing it costs a rebuild, never data. One writer path, and every query is Promise-returning + paged so the SQLite backend behind `v2-shaping.md` Fork 1's trigger stays a swap.
9. **The agent surface is one contract, generated.** `libs/agent/src/contract.ts` declares every op's name, input schema, output schema and description; the CLI's flags and text renderer, `--json`, the `ohhi mcp` tool list, `spec/*.schema.json` and the conformance test are all derived from it. **`spec/` is generated (`cd apps/cli && rushx gen-schemas`) — regenerate it, never hand-edit it**; the conformance test fails on drift. Changing an op's shape is a contract change: bump the version, regenerate, and update the renderer, `docs/agent-access.md` and the `ohhi-vault` skill in the same change. See `plans/agent-surface-shaping.md` A9.

## Skills

- `.claude/skills/monorepo-rush` — workspace layout, Rush/rushx workflow
- `.claude/skills/testing` — three-tier collab harness, Vitest, Playwright
- `.claude/skills/ui-development` — Svelte 5, Tailwind 4, CM6-in-Svelte wrapper, sync-pill conventions
- `.claude/skills/ohhi-vault` — **not a repo skill**: the operating manual an *external* agent uses to work over a vault with the `ohhi` CLI. Installed into `~/.claude/skills/` as a symlink by `scripts/install-skill.sh` (never copied — a copy goes stale). Reference: `docs/agent-access.md`
