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

## Design notes and context

- The design notes are private (see `CLAUDE.md`, *The design notes are private*): code and docs cite them by name and decision id.
- With the team vault, read them in order for context: **`frame`** (the problem) → **`shaping`** (the shape; part **D10** defines the monorepo) → **`slices`** (V1–V4 delivery slices). Without it, start from `docs/architecture/overview.md` and `docs/README.md`.

---

## Monorepo layout

- **Top‑level structure**:
  - **`apps/`** – Application packages.
  - **`libs/`** – Shared libraries.
  - **Rush config** – Lives at the repo root (`rush.json`, `common/config/**`).
- **Package naming**: `@ohhi/<name>` (for example `@ohhi/sync`, `@ohhi/vault`).

### V1 packages (per `shaping` D10)

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
| `libs/ui` | Design tokens + themes (CSS and token names only — no components), and the bundled fonts (`fonts/`, woff2; `rushx fonts` re-vendors them and writes `src/styles/fonts.css` — the only network step, output committed) | V2a |
| `libs/index` | The derived index: full text, links, tags, headings, frontmatter keys | V2b |
| `libs/editor-lang` | `[[wikilink]]` grammar and decorations on `@codemirror/lang-markdown` | V2c |
| `libs/i18n` | Dictionaries + typesafe-i18n wiring; `rushx generate` regenerates the typed accessors | V2 |
| `libs/agent` | `@ohhi/agent` — the host-neutral command core behind the agent surface: `VaultBackend`, vault selection, and the 17 ops declared in `src/contract.ts` | G1 |
| `libs/harness` | `@ohhi/harness` — the writing harness's runtime core over the AI SDK: the seams every host shares (`src/types.ts`: providers, references, sessions, suggestions, comments, skills, `AgentHost`) and the runtime API (`createModel`, `toolsFromContract`, `systemPrompt`, `createHarnessAgent`); clock- and `fetch`-injected | H1 |
| `apps/cli` | `@ohhi/cli` — the **`ohhi`** binary (`bin.ohhi` → `bin/ohhi.mjs`) plus `ohhi mcp`. `rushx build` bundles `src/main.ts` to `dist/ohhi.mjs` with esbuild; `rushx gen-schemas` regenerates the op schemas in `spec/` | G1 |
| `apps/nextcloud` | `@ohhi/nextcloud` — the Nextcloud ExApp (app id `ohhi`): one Node process with the relay in-process, the router and a headless custodian per enrolled Files folder. `rushx build` bundles `dist/server.mjs` with esbuild (`better-sqlite3` external); the image is `apps/nextcloud/Dockerfile` over `rush deploy --scenario nextcloud`; the web build it serves is `cd apps/web && rushx build:nextcloud` (+ `build:embed`). Install into a local Nextcloud: `apps/nextcloud/scripts/nc-dev-install.sh` — see `docs/nextcloud.md` | NC1 |

`apps/agentd` is still split-on-demand — it is created by its V3 slice, not before (see `slices`).

### The generated contract (`apps/cli` + `libs/agent`)

`spec/*.schema.json` is **generated** from `libs/agent/src/contract.ts` and committed:

```bash
cd apps/cli && rushx gen-schemas    # writes spec/ohhi.<op>.v1.schema.json
```

Regenerate it, never hand-edit it — `apps/cli/test/conformance.test.ts` fails on drift. `apps/cli`'s conformance and cold-start tests run the esbuild bundle, so CI runs `cd apps/cli && rushx build` before the test loop reaches it.

**`gen-schemas` exists in two places.** The app's own resource formats — `spec/ohhi.layout.v1.schema.json` and `spec/ohhi.keymap.v1.schema.json` — plus `examples/` and the generated id lists in `docs/customising.md` come from **`apps/web`**, which owns the command table and the catalogues they enumerate:

```bash
cd apps/web && rushx gen-schemas    # node scripts/gen-schemas.mjs, over src/lib/resource-schemas.ts
```

Run it after adding a command (and its id in `apps/web/src/lib/command-ids.ts`), a readout, a region or a view; `resource-schemas.test.ts` fails on drift. Never hand-edit either generator's output.

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
- **After moving or renaming the checkout on disk**, the installed `node_modules` links still point at the old path and tools fail in confusing ways (missing modules, stale `.rush/temp`). Reinstall from scratch with `rush update --purge` (then expect no lockfile change; if `common/config/rush/pnpm-lock.yaml` moves, review it before committing).

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
