# Editor monorepo — Claude instructions

Editor is a collaborative, agent-native markdown editor: a drop-in replacement for Obsidian over a plain-markdown vault. Files on disk are the source of truth; CRDTs (Yjs) handle sync/collab; agents are first-class collaborators.

## Read first

- `plans/frame.md` — why this exists (verbatim source + problem/outcome)
- `plans/shaping.md` — requirements, shapes A–D, fit check, decision log, spikes
- `plans/slices.md` — V1 (tracer bullet) → V4 + Later list
- `plans/v2-shaping.md` — V2 daily-driver core: which Obsidian-comparable capabilities are load-bearing (decided from measured vault evidence), plus the design system. Amends `shaping.md` D5(a) and D3; adds Spike S9
- `plans/research/` — 13 web-grounded research notes + 3 architecture proposals

Plans are ground truth. If implementation diverges from a plan, update the plan in the same change (multi-level consistency: frame → shaping → slices → code).

## Repo layout

Rush monorepo (same conventions as the Edible repo). Packages are created per-slice — `rush.json`'s projects list is the source of truth; V1 creates `apps/web`, `apps/desktop` (Tauri 2), `apps/relay` (Hocuspocus v4), `libs/sync`, `libs/vault`, `libs/editor`, `libs/testkit`. Naming: `@editor/<name>`.

Packages beyond V1's set, created by their slices: `libs/workspace` (M1),
`libs/ui` (V2a — design tokens + themes), `libs/index` (V2b — the derived
index), `libs/editor-lang` (V2c — wikilink grammar). The shell's component
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

## Skills

- `.claude/skills/monorepo-rush` — workspace layout, Rush/rushx workflow
- `.claude/skills/testing` — three-tier collab harness, Vitest, Playwright
- `.claude/skills/ui-development` — Svelte 5, Tailwind 4, CM6-in-Svelte wrapper, sync-pill conventions
