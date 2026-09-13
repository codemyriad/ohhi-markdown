---
name: monorepo-rush
description: Monorepo and Rush workflow for the Editor repo, including layout, installing dependencies with rush install (preferred) or rush update when bumping deps, and running package scripts with rushx. Use this skill when managing dependencies, scripts, CI, or when an agent needs to understand the workspace structure.
metadata:
  repo: editor
---

## When to use this skill

Use this skill whenever you need to:

- Understand how the **Editor monorepo** is laid out.
- Install or update dependencies with **Rush**.
- Run **package scripts** (formatting, linting, typechecking, testing) with **rushx**.
- Reason about CI pipelines that rely on Rush commands.

If a task is about *project structure*, *dependency management*, or *scripts* rather than UI or tests, start here.

---

## Plans and context

- Plans live at **`/plans`** in the repo root.
- Read them in order for context: **`plans/frame.md`** (the problem) → **`plans/shaping.md`** (the shape; part **D10** defines the monorepo) → **`plans/slices.md`** (V1–V4 delivery slices).

---

## Monorepo layout

- **Top‑level structure**:
  - **`apps/`** – Application packages.
  - **`libs/`** – Shared libraries.
  - **Rush config** – Lives at the repo root (`rush.json`, `common/config/**`).
- **Package naming**: `@ohhi/<name>` (for example `@ohhi/sync`, `@ohhi/vault`).

### V1 packages (per `plans/shaping.md` D10)

| Package | Purpose |
|---------|---------|
| `apps/web` | Svelte 5 UI |
| `apps/desktop` | Tauri 2 shell hosting `apps/web` |
| `apps/relay` | Hocuspocus v4 sync service (deployed to Fly.io) |
| `libs/sync` | Engine‑seam CRDT sync; Yjs implementation behind the seam |
| `libs/vault` | `VaultAdapter` + watcher + reconciler + durable LCA store |
| `libs/editor` | CodeMirror 6 + thin Svelte wrapper |
| `libs/testkit` | Injected clock, TestNetwork, fuzz driver |

### Packages added by later slices

| Package | Purpose | Slice |
|---------|---------|-------|
| `libs/workspace` | Host-neutral mounts, folder map, mass-change breaker, boot delta scan | M1 |
| `libs/ui` | Design tokens + themes (CSS and token names only — no components) | V2a |
| `libs/index` | The derived index: full text, links, tags, headings, frontmatter keys | V2b |
| `libs/editor-lang` | `[[wikilink]]` grammar and decorations on `@codemirror/lang-markdown` | V2c |
| `libs/i18n` | Dictionaries + typesafe-i18n wiring; `rushx generate` regenerates the typed accessors | V2 |
| `libs/agent` | `@ohhi/agent` — the host-neutral command core behind the agent surface: `VaultBackend`, vault selection, and the 17 ops declared in `src/contract.ts` | G1 |
| `apps/cli` | `@ohhi/cli` — the **`ohhi`** binary (`bin.ohhi` → `bin/ohhi.mjs`) plus `ohhi mcp`. `rushx build` bundles `src/main.ts` to `dist/ohhi.mjs` with esbuild; `rushx gen-schemas` regenerates `spec/` | G1 |

`apps/agentd` is still split-on-demand — it is created by its V3 slice, not before (see `plans/slices.md`).

### The generated contract (`apps/cli` + `libs/agent`)

`spec/*.schema.json` is **generated** from `libs/agent/src/contract.ts` and committed:

```bash
cd apps/cli && rushx gen-schemas    # writes spec/ohhi.<op>.v1.schema.json
```

Regenerate it, never hand-edit it — `apps/cli/test/conformance.test.ts` fails on drift. `apps/cli`'s conformance and cold-start tests run the esbuild bundle, so CI runs `cd apps/cli && rushx build` before the test loop reaches it.

Two install scripts put the surface on a developer's machine (both POSIX `sh`, both symlink rather than copy, both take `--force` and `--dry-run`):

```bash
./scripts/install-ohhi.sh     # build, then ~/.local/bin/ohhi -> apps/cli/bin/ohhi.mjs
./scripts/install-skill.sh    # ~/.claude/skills/ohhi-vault -> .claude/skills/ohhi-vault
```

Reference: [`docs/agent-access.md`](../../../docs/agent-access.md).

**Important — packages are created per‑slice (split‑on‑demand):**

- Do **not** invent or reference packages that don't exist yet.
- **`rush.json`'s `projects` list is the source of truth** for which packages currently exist. Check it before assuming a package is available.

**Rule**: never treat a package as a standalone project. Always respect Rush's dependency graph and the workspace relationships between packages.

---

## Toolchain

Same toolchain as the Edible repo:

- **Rush** `5.153.0` (`rushVersion` in `rush.json`).
- **pnpm** `10.17.0` (`pnpmVersion` in `rush.json`).
- **Node** `22.12` (pinned in `.nvmrc`).

---

## Rush basics

- **Primary documentation**: see the Rush docs at [`https://rushjs.io`](https://rushjs.io), especially the *Everyday commands* page.
- **Key commands**:
  - **`rush`** – workspace‑level operations (installing dependencies, bulk builds, etc.).
  - **`rush install`** – **preferred for local development and CI**:
    - Read‑only install from the existing lockfile.
    - Fails if the lockfile is out of date instead of mutating it.
    - Use after pulling changes, or when you only need to install (no dependency changes).
  - **`rush update`** – use **only when you explicitly want to bump dependencies**:
    - Updates the lockfile and may pull in new minor/patch versions.
    - Run after adding/removing packages or changing version ranges in `package.json`, or after changing common Rush config.
    - Prefer `rush install` for day‑to‑day work so dependency changes are intentional and reviewable.

---

## Running package scripts with `rushx`

### Pattern

- Change into the package directory (for example `apps/web`) and run:

```bash
rushx <script-name>
```

- `rushx` reads the `scripts` section of that package's `package.json` and runs the script in a Rush‑aware environment.

### Common script categories

Across packages, scripts follow a consistent pattern:

- **Formatting**: `rushx format`
- **Linting**:
  - `rushx lint` – standard lint.
  - `rushx lint:strict` – lint with `--max-warnings=0`.
- **Typechecking**:
  - `rushx typecheck` – one‑off type/Svelte check.
  - `rushx typecheck:watch` – watch mode.
- **Unit tests**:
  - `rushx test` – run unit test suite.
  - `rushx test:ci` – CI‑oriented variant (for example with JUnit output).

Because packages land per‑slice, so do their scripts. Each package's `package.json` is the authoritative list — don't assume a script exists before checking.

---

## How to extend this skill

When monorepo or Rush conventions change:

- **Update this SKILL first**, then update any higher‑level summaries (for example `AGENTS.md`).
- Prefer:
  - Adding or updating shared scripts in packages.
  - Documenting the new script or pattern here.
- Avoid:
  - Introducing one‑off commands in docs or CI without reflecting them in this skill.
