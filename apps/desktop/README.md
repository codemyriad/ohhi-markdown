# @ohhi/desktop

Tauri 2 desktop shell for Editor. It hosts the `@ohhi/web` frontend in a native
webview and exposes native filesystem + dialog capabilities (the vault lives on
disk; see `plans/shaping.md` D6 — Tauri 2 is the V1 tracer client).

## Prerequisites (Linux)

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

If `cargo build` still fails at a pkg-config step, install the package it names
(observed on this machine: `sudo apt install libdbus-1-dev` for `libdbus-sys`).

Plus a Rust toolchain (`rustup`) and the repo toolchain (Node 22.12, Rush, pnpm —
see the repo root README). Without `libwebkit2gtk-4.1-dev`, `cargo build` /
`tauri dev` fails at the system-dependency (pkg-config) stage.

## Running in dev

`beforeDevCommand` / `beforeBuildCommand` in `src-tauri/tauri.conf.json` are
intentionally **empty**: Rush drives the web app as a separate process, Tauri
only attaches to it. So you need two terminals:

```sh
# terminal 1 — web frontend (Vite on http://localhost:5173)
cd apps/web && rushx dev

# terminal 2 — desktop shell (attaches to the Vite dev server via devUrl)
cd apps/desktop && rushx dev
```

For a production bundle, build the web app first (`cd apps/web && rushx build`,
output in `apps/web/dist` = `frontendDist`), then `cd apps/desktop && rushx build`.

Release builds (tag `v*` → draft GitHub Release), teammate install notes and
the webview's Content Security Policy: [`docs/desktop-builds.md`](../../docs/desktop-builds.md).
The CSP covers built apps only (`tauri dev` loads the Vite server directly), so
check a CSP change with `tauri build --debug --no-bundle`.

## How the web app detects Tauri

When running inside this shell, Tauri injects `window.__TAURI_INTERNALS__` into
the webview. The web app uses its presence to select the vault backend:

```ts
const isTauri = '__TAURI_INTERNALS__' in window;
// isTauri  → TauriVaultAdapter (native fs via @tauri-apps/plugin-fs)
// !isTauri → browser fallback
```

`TauriVaultAdapter` is a separate upcoming task in `apps/web` (the
`@tauri-apps/api`, `@tauri-apps/plugin-fs`, and `@tauri-apps/plugin-dialog` JS
packages are already installed there).

## Vault access & permissions

The user picks a vault folder at runtime via the dialog plugin. For V1 dev,
`src-tauri/capabilities/default.json` grants the fs plugin a blanket
`$HOME/**` scope so any picked folder works.

**TODO (tighten before real dogfooding):** replace the blanket scope with
`tauri-plugin-persisted-scope` or runtime-scoped grants keyed to the picked
folder. See `plans/shaping.md` D6.

## Icons

`src-tauri/icons/` was generated from the placeholder `app-icon.png` (indigo
"E" tile) via `tauri icon`. To replace it with a real icon, drop in a 512x512+
transparent PNG and re-run:

```sh
cd apps/desktop && ./node_modules/.bin/tauri icon path/to/icon.png
```
