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

Plus a Rust toolchain (`rustup`; 1.90 or newer, the `rust-version` in `src-tauri/Cargo.toml`) and the repo toolchain (Node 22.12, Rush, pnpm —
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

The webview can reach only the app's own data and the folders the user
picked (DEL-89; `docs/desktop-builds.md` § Installing and § Threat model):

- **Static scope** (`src-tauri/capabilities/default.json`): `$APPDATA/stores`
  read-write; `$CONFIG/ohhi` (the user resource root) read-only, through
  command scopes on `exists`, `read-dir` and `read-text-file`. Nothing under
  `$HOME`.
- **Picked folders**: `pickVaultFolder()` opens the dialog with
  `recursive: true`, so the dialog plugin adds the folder to the fs plugin's
  runtime scope. `tauri-plugin-persisted-scope` saves that scope to
  `$APPDATA/.persisted-scope` and restores it on launch; the capability denies
  that file to the webview, so it cannot grant itself more.
- **Dot-entries**: the fs plugin matches its runtime scope with Tauri's
  default, which on Unix never lets `**` match `.ohhi/` or `.obsidian/` and
  ignores `plugins.fs.requireLiteralLeadingDot`. `granted_folders` in
  `src-tauri/src/lib.rs` copies each runtime grant into a runtime capability,
  which is matched with that flag (set to `false` in `tauri.conf.json`).
- **Lost access**: a vault whose folder is refused ("forbidden path") shows
  "Allow access to this folder again" in the vault manager, which reopens the
  picker on that folder and accepts only that folder.
- **Not revoked on remove**: Tauri's scope has no way to drop an allowed path,
  only to forbid one, and a forbid would block picking the folder again later.

## Icons

`app-icon.png` is the landing page's "hi" favicon (`apps/site/public/favicon.svg`)
rendered at 1024×1024 by `scripts/app-icon.mjs`; `src-tauri/icons/`,
`src-tauri/gen/android`'s mipmaps and `src-tauri/gen/apple`'s icon set are
all generated from it by `tauri icon`. One command does both:

```sh
cd apps/desktop && rushx icon
```

It is a stand-in until there is a brand. To use a real icon, replace the
script's output with a 1024×1024 transparent PNG and run only the second
half, `tauri icon app-icon.png --ios-color '<its background>'`
(docs/mobile-builds.md, "The iOS project").
