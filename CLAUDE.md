# Oh hi markdown monorepo — Claude instructions

Oh hi markdown is a collaborative, agent-native markdown editor: a drop-in replacement for Obsidian over a plain-markdown vault. Files on disk are the source of truth; CRDTs (Yjs) handle sync/collab; agents are first-class collaborators.

## Read first

- `docs/README.md` — the documentation index: the primers (CRDTs and Yjs,
  a plain-text CRDT over markdown, LCA reconciliation, the engine seam, sync
  and the relay), the architecture pages, the glossary and the reference docs
- `docs/architecture/overview.md` — the packages and the dataflow
- `docs/agent-access.md` — the agent surface (`ohhi` CLI, skill, MCP)
- `docs/writing-harness.md` — the in-app agent
- `docs/customising.md` and `docs/theming.md` — the app's resource formats
  (layouts, keymaps, templates) and the design system
- `docs/running-and-testing.md` — the runbook

**The design notes are private.** The project was shaped in a set of design
notes — `frame`, `shaping`, `slices`, `v2-shaping`, `agent-surface-shaping`,
`quiet-shell-shaping`, `foundations-plan`, `bases-shaping`,
`writing-harness-shaping`, the `research/` notes, the spike logs — that live
in the team's vault, managed with Oh hi markdown itself, not in this
repository. Code and docs cite them by name and decision id (`shaping`
D5(a), `v2-shaping` Fork 1, `agent-surface-shaping` A10) as the record of
*why*; the docs in `docs/` carry the reasoning needed to work on the code. If
you have the vault, the notes are ground truth: when an implementation
diverges from a note, update the note in the same change (multi-level
consistency: frame → shaping → slices → code). If you don't, say so and work
from `docs/` and the code; don't recreate the notes.

## Repo layout

Rush monorepo. Packages are created per-slice — `rush.json`'s projects list is the source of truth; V1 created `apps/web`, `apps/desktop` (Tauri 2), `apps/relay` (Hocuspocus v4), `libs/sync`, `libs/vault`, `libs/editor`, `libs/testkit`. Naming: `@ohhi/<name>`.

Packages beyond V1's set, created by their slices: `libs/workspace` (M1),
`libs/ui` (V2a — design tokens + themes), `libs/index` (V2b — the derived
index), `libs/editor-lang` (V2c — wikilink grammar), `libs/frontmatter` (V2e —
the flat-subset YAML reader and one-line-range patcher every frontmatter
writer goes through), `libs/collections` (DB1 — the `.base` reader, filter
grammar and view-scoped patcher behind collections: notes as rows, the index
answering; `bases-shaping`), `libs/agent` (G1 — the host-neutral command core behind
the agent surface) and `apps/cli` (G1 — the `ohhi` binary, bin name `ohhi`,
plus `ohhi mcp`), `libs/harness` (H1 — the writing harness: providers over
the Vercel AI SDK, the tool loop over the `libs/agent` contract, the prompt,
and the seams every harness host shares in `src/types.ts`; see
`docs/writing-harness.md`), `libs/i18n` (the dictionaries + typesafe-i18n
wiring; every user-facing string in `apps/web` is a `$LL.…()` / `getLL()`
key — see `.claude/skills/ui-development`). The shell's component
primitives (Melt UI + lucide: `Dialog`, menus, `Tooltip`, `IconButton`,
`Tabs`, `Toaster`, `Popover`, form fields) live in `apps/web/src/lib/ui/` (chrome U1).

`apps/site` is the **`ohhi.md` landing page** (Astro, static, no client
script): the apex names the web app at `app.ohhi.md` and the desktop
downloads at `dist.ohhi.md`, every outbound URL in `src/links.ts`. Its colours
are the app's own default pair, generated from `@ohhi/ui`'s `editor-light` /
`editor-dark` tokens by `cd apps/site && rushx gen-tokens` into
`src/styles/tokens.generated.css` — regenerate it, never hand-edit it
(`rushx check` fails on drift).

**The app's own folder in a vault is `.ohhi/`** (renamed from `.editor/`;
`.editor` and `.editor-cache` stay in `IGNORED_DIRS` as legacy ignores). It
holds **resources — data, never code**: `layouts/*.json`, `keymaps/*.json`,
`templates/*.md` and `themes/<name>/theme.css`. Layouts, keymaps and
templates are read from ordered roots — the vault's `.ohhi/` →
`~/.config/ohhi/` (desktop) → built-in, the vault winning; the device holds
only its choice of file and its own layout overrides and pins (config, never
a file — the app never writes a layout file; an agent does). `.ohhi/` is ignored by sync, the index and enrolment; the
app's writes there go through the journal. See `quiet-shell-shaping`
and `docs/customising.md`.

**Skills live in the vault's `.agents/skills/<name>/SKILL.md`** (the Agent
Skills format every harness reads), never under `.ohhi/`. Trust is
device-local in `.ohhi/skills.json`; Claude Code's `.claude/skills/` is only a
farm of links the app or `ohhi skills export` makes, and `.claude` is in
`IGNORED_DIRS` (never synced, never indexed). **Every harness command is a
registry id** (`ai.*` in `command-ids.ts`, gated `when: aiEnabled` — nothing
AI-shaped renders without a provider), like every other command (golden rule
7). See `docs/writing-harness.md`.

Toolchain: Rush 5.153.0, pnpm 10.17.0, Node 22.12 (`.nvmrc`). Use `rush install` / `rushx <script>`; see `.claude/skills/monorepo-rush`.

## Golden rules (from the shaping note — do not violate without updating `shaping`)

1. **Files are canonical.** Editor never holds the only copy of content. Any Editor-initiated disk write goes through the pre-image journal + atomic temp-fsync-rename.
2. **Never reserialize what you didn't change.** Frontmatter edits are surgical byte-preserving patches (parse-only YAML); untouched bytes stay untouched — no spurious git diffs.
3. **Always-on CRDT for enrolled docs; no CRDT at all for tracked (never-shared) files.** There is no "dormant" mode — that was adversarially proven to lose data (see Decision log, Offline/collab seam).
4. **Sync state never lies.** The pill is a pure `f(syncRecord)`; green requires durable (fsynced) relay ack — that is the target (`shaping` D4a); **today green means the relay has received every edit** (`apps/web/src/lib/pill-status.ts`), and every surface words it that way ("in sync with the relay", never "durable"). Tested under partition in the harness.
5. **Injected clock/scheduler in all Editor-owned sync, reconciler and index code** (lint-enforced across `libs/sync`, `libs/vault`, `libs/index`, `libs/agent`, `libs/harness` and `libs/workspace` — the event log included; a documented `clock-exempt` marker covers diagnostics that schedule nothing) — deterministic simulation is the foundation of the test harness.
6. **Collab correctness is tested, not hoped:** L0 fast-check model tests, L1 reconciler fuzz (memfs, `fuzz-crashers/` corpus), L2 two-context Playwright smoke. See `.claude/skills/testing`.
7. **The UI renders through design tokens, never raw palette utilities.** One token layer drives the Svelte chrome and the CodeMirror surface alike; the sync-honesty tokens are unlayered so no user theme can repaint the pill (golden rule 4, expressed in the cascade). `scripts/check-design-tokens.sh` is a build gate, and `apps/web/e2e/a11y.spec.ts` (axe over every shell surface) gates accessibility the same way — no overlay, menu or icon control outside `apps/web/src/lib/ui/`. **The shell's bars are data, too: every toolbar and format-bar item is a registry command id; every bar readout is a catalogue id** (`READOUT_IDS` / `READOUTS`, drawn through one `BarItems.svelte`) — never a button written into a host, and the layout schema refuses a spec that would hide the `sync` readout (the open note's sync state; `note.pill` is its old alias). See `docs/theming.md` and `.claude/skills/ui-development`.
8. **The index is derived, never a system of record.** Droppable by construction: losing it costs a rebuild, never data. One writer path, and every query is Promise-returning + paged so the SQLite backend behind `v2-shaping` Fork 1's trigger stays a swap.
9. **The agent surface is one contract, generated.** `libs/agent/src/contract.ts` declares every op's name, input schema, output schema and description; the CLI's flags and text renderer, `--json`, the `ohhi mcp` tool list, `spec/*.schema.json` and the conformance test are all derived from it. **`spec/` is generated (`cd apps/cli && rushx gen-schemas`) — regenerate it, never hand-edit it**; the conformance test fails on drift. Changing an op's shape is a contract change: bump the version, regenerate, and update the renderer, `docs/agent-access.md` and the `ohhi-vault` skill in the same change. See `agent-surface-shaping` A9. **A second generator** owns the app's resource formats: `apps/web/src/lib/resource-schemas.ts` (over `layout-spec.ts`, `keymap-spec.ts` and `command-ids.ts`) writes `spec/ohhi.layout.v1.schema.json`, `spec/ohhi.keymap.v1.schema.json`, `examples/` and the id lists in `docs/customising.md` — `cd apps/web && rushx gen-schemas`, never hand-edited; `resource-schemas.test.ts` fails on drift, and `command-ids.test.ts` fails on a registered command whose id is missing from `command-ids.ts` (add a command → add its id → regenerate).

## Skills

- `.claude/skills/monorepo-rush` — workspace layout, Rush/rushx workflow
- `.claude/skills/testing` — three-tier collab harness, Vitest, Playwright
- `.claude/skills/ui-development` — Svelte 5, Tailwind 4, CM6-in-Svelte wrapper, sync-pill conventions
- `.claude/skills/ohhi-vault` — **not a repo skill**: the operating manual an *external* agent uses to work over a vault with the `ohhi` CLI. Installed into `~/.claude/skills/` as a symlink by `scripts/install-skill.sh` (never copied — a copy goes stale). Reference: `docs/agent-access.md`
