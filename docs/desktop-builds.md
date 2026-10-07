# Desktop builds

How the Tauri 2 desktop app is released for dogfooding, how teammates install
it, and the webview's Content Security Policy. Workflow:
[`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml)
— its comments cover the job layout, token permissions and signing placeholders.

## Cutting a release

1. Bump `version` in `apps/desktop/src-tauri/tauri.conf.json` (the build fails if
   the tag and this version disagree).
2. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
3. Actions → **Desktop release** builds Linux and macOS in parallel, then a
   final job creates a **draft** release named `Oh hi markdown v0.1.0`.
4. Check the assets, then publish — or leave it a draft, visible to repo
   members only.

Without a tag: Actions → Desktop release → **Run workflow** creates a draft
pre-release tagged `v<version>-dogfood.<run number>` (the tag only exists once
someone publishes it). Re-running when that draft exists fails at the release
step: delete the draft first.

The bundled web app gets `VITE_DEFAULT_RELAY` from the repository variable
**`DEFAULT_RELAY`** (Settings → Secrets and variables → Actions → Variables);
set it to the team relay, `wss://relay.ohhi.md`.

### What lands where

| Asset | Platform |
| --- | --- |
| `ohhi_<version>_amd64.AppImage` | Linux x86_64, any distro with glibc ≥ 2.35 (Ubuntu 22.04+) |
| `ohhi_<version>_amd64.deb` | Debian / Ubuntu 22.04+ |
| `ohhi_<version>_universal.dmg` | macOS, Apple Silicon and Intel in one file |
| `SHA256SUMS.txt` | checksums of the above |

The same files stay as workflow artifacts for 14 days. There are no Windows or
Linux arm64 builds. macOS is one universal build so nobody downloads the wrong
one; it costs about the same runner minutes, since each arch compiles once
either way.

**Signing:** macOS builds are ad-hoc signed (`bundle.macOS.signingIdentity: "-"`)
and not notarized; Linux packages are unsigned; there is no auto-updater yet.

## Installing (teammates)

First check the download against `SHA256SUMS.txt` from the same release — with
unsigned builds it is the only integrity check you have:

```sh
sha256sum -c SHA256SUMS.txt --ignore-missing      # macOS: shasum -a 256 -c SHA256SUMS.txt
```

### Linux

- **AppImage:** `chmod +x ohhi_*.AppImage && ./ohhi_*.AppImage`. AppImages
  need FUSE 2: on Ubuntu 22.04 `sudo apt install libfuse2`; on 24.04 and later
  `sudo apt install libfuse2t64`.
- **.deb:** `sudo apt install ./ohhi_*_amd64.deb` installs the package `ohhi`
  (`sudo apt remove ohhi`) with an "ohhi" menu entry.

### macOS

1. Open the `.dmg` and drag **ohhi** into Applications.
2. The first launch is blocked ("ohhi" Not Opened / Apple could not verify…)
   because the app is not notarized. Clear it either way:
   - Terminal: `xattr -dr com.apple.quarantine "/Applications/ohhi.app"`, then
     open the app normally.
   - Or try to open it once, then **System Settings → Privacy & Security** →
     "ohhi was blocked…" → **Open Anyway**, and confirm with your password.

Since macOS 15 Sequoia, Control-click → Open no longer bypasses Gatekeeper for
an app that isn't notarized.

App data lives under the app identifier (`md.ohhi.desktop`):
`~/Library/Application Support/md.ohhi.desktop` on macOS and
`~/.local/share/md.ohhi.desktop` on Linux. Your vault stays wherever you picked
it. A desktop app from a build before the rename (identifier `dev.chris.editor`)
kept its state elsewhere, so it starts with fresh sync state; files are untouched.

**Known dogfood limitation:** the desktop app's filesystem permission is a blanket
`$HOME/**` grant (`apps/desktop/src-tauri/capabilities/default.json`); tightening
it to the picked vault folders is tracked separately. Until then the CSP below
is the main barrier.

## Linux: the WebKitGTK renderer workaround

On at least one Linux setup (Ubuntu 24.04, WebKitGTK 2.52, Wayland, AMD GPU)
WebKitGTK's DMA-BUF renderer draws the note's text visibly bolder than the
loaded face: the bundled Public Sans 400 loads, computes to weight 400, and
still renders heavy. Launching with `WEBKIT_DISABLE_DMABUF_RENDERER=1`
fixes it, so the desktop binary sets that variable itself before the first
webview exists (`apps/desktop/src-tauri/src/lib.rs`, Linux only). The cost
is the webview's GPU-composited path, which a text editor does not need.

- To test whether a newer WebKitGTK still needs it, launch with
  `OHHI_WEBKIT_DMABUF=1` (the app then leaves WebKit's default alone).
- A `WEBKIT_DISABLE_DMABUF_RENDERER` you set yourself is respected as is.
- Diagnosed 2026-10-07; the evidence is in `plans/foundations-plan.md`
  (Round 4 build outcome, the open item).

## Content Security Policy

### Threat model

The webview renders what other people wrote — markdown and theme CSS arrive
through shared folders, relay traffic from teammates' devices — and the same
webview holds the relay tokens and operator secret and, on desktop, Tauri IPC
with `fs:read-all` / `fs:write-all` over `$HOME/**`. Script running there can
read and write the home directory (SSH keys, shell rc files, other vaults),
which is close to code execution. So the policy has two jobs:

1. **No injected script runs** — no inline script or event handlers, no
   `javascript:` URLs, no `eval` / `new Function`, no remote or `data:`/`blob:`
   script, no plugins, no `<base>` hijack. This is the load-bearing part.
2. **Limit where data can go** — images, fonts, frames and forms only to the
   app itself (or `data:`); cleartext connections only to loopback.

It is defence in depth over a small injection surface: CodeMirror shows
markdown as source and never renders it as HTML; the only raw-HTML sinks are
four `{@html}` i18n sentences with escaped interpolations; user themes pass
through `sanitizeThemeCss` (`apps/web/src/lib/theme.svelte.ts`), and a remote
`url()` it misses is still refused by `img-src`/`font-src`.

It does **not** stop exfiltration over `fetch`/WebSocket to an arbitrary
`https:`/`wss:` host (see the trade-off below), protect against a compromised
dependency in our own bundle (`script-src 'self'` trusts what we ship), or
narrow the filesystem grant.

### The policies

- **Desktop:** `app.security.csp` in `apps/desktop/src-tauri/tauri.conf.json`.
  Tauri adds `'sha256-…'` sources to `script-src` for the inline pre-paint
  theme script and every bundled JS file, computed at compile time, and (as of
  2.11) sends the policy as a real `Content-Security-Policy` response header.
- **Hosted web app:** `apps/web/public/_headers` (Cloudflare Pages) — the same
  policy without Tauri's IPC sources, plus the theme script's hash, which we
  pin ourselves. It also sends `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, COOP `same-origin` and a `Permissions-Policy`
  denying device APIs; none of these affect OPFS, which only needs HTTPS.

### Why each non-default source is there

| Source | Why |
| --- | --- |
| `script-src` hash | The inline pre-paint theme script in `index.html` must run synchronously before CSS loads. Tauri hashes it itself; on the web the hash is pinned in `_headers`. A stale hash only causes a flash of the wrong theme. |
| `style-src 'unsafe-inline'` | Required. CodeMirror's `style-mod` injects `<style>` elements (it uses `adoptedStyleSheets` only inside shadow roots), user themes install as a `<style>`, and Svelte templates carry `style="…"` attributes. Injected CSS still can't phone home — `img-src`/`font-src` have no remote sources and `@import` is bound to `'self'` — leaving UI spoofing, and only after an HTML-injection bug. |
| `img-src data:`, `font-src data:` | Themes may inline images and fonts as `data:` URIs, which the sanitizer keeps; they make no network request. |
| `connect-src ipc: http://ipc.localhost` (desktop) | Tauri's IPC transport (`ipc:` on macOS/Linux, `http://ipc.localhost` on Windows). Tauri does not add these; without them IPC silently falls back to the slower `postMessage` path. |
| `connect-src wss: https:` | The relay URL is user-configurable (any host): sync over WebSocket, the admin API over HTTP(S) on the same host (`apps/web/src/lib/relay-admin.ts`). |
| `connect-src ws://localhost:* … http://127.0.0.1:*` | The local dev relay and its admin API. Plaintext only to loopback, so a share token never crosses the network in cleartext — the desktop now matches what a browser enforces for an HTTPS page. |
| `frame-ancestors 'none'` | Nothing may frame the app (clickjacking). Only effective as a header, which it is on both targets. |

`base-uri` is `'none'` because the app has no `<base>`. No `worker-src`: nothing
spawns workers, so `default-src 'self'` applies.

**`dangerousDisableAssetCspModification: ["style-src"]`** stops Tauri adding a
nonce to `style-src` should `index.html` ever gain a `<style>`: a nonce in a
directive disables its `'unsafe-inline'`, which would silently unstyle
CodeMirror (its `<style>` tags carry no nonce). With `'unsafe-inline'` present
a nonce protects nothing. `script-src` keeps Tauri's hashing.

**No `devCsp`.** `tauri dev` loads the Vite server directly and Tauri injects
CSP only into assets served by its own protocol, so neither `csp` nor `devCsp`
reaches desktop dev (HMR is unaffected). CSP regressions therefore show only in
built apps: check with `tauri build --debug --no-bundle` (embedded assets, the
real policy, Web Inspector).

**Desktop dev renders whatever is on `:5173`.** If a font can't be found, the
usual cause is a Vite dev server that was started before a `vite.config.ts`
change (it 403s `libs/ui/fonts/`). The CSP does not block it in dev. Restart `rushx dev` in `apps/web` and then in `apps/desktop`; see
[running-and-testing §5](running-and-testing.md#5-the-desktop-tauri-shell).

### The connect-src trade-off

Because the relay can be any host, `connect-src` allows every `https:`/`wss:`
origin: script injection is blocked, but script that did run could send data
anywhere over TLS. The policy narrows the side channels, not the main one. Any
of these would close it:

1. **Pin at build time** — release builds bake the team relay
   (`vars.DEFAULT_RELAY`) into `connect-src`. Cheap and right for a
   single-relay team, but gives up "any relay".
2. **Pin the hosted web app per deployment** — a Pages deployment serves one
   relay anyway, so `_headers` can name just that one.
3. **Move the network into Rust** (the real fix for desktop) — a Tauri command
   owns the relay WebSocket and admin calls against an allowlist the user
   approved in a native dialog, the tokens leave the webview, and
   `connect-src` shrinks to `'self' ipc: http://ipc.localhost`. With a scoped
   filesystem grant, an injected script could then neither read much nor send
   it anywhere.

### Verifying

- `node apps/desktop/scripts/check-csp.mjs` runs after the web build (in CI and
  the release workflow). It fails if `_headers` misses the current inline-script
  hash or holds a stale one, if either policy allows `'unsafe-eval'`, inline
  script, remote script or plugins, or if the two policies differ beyond
  Tauri's IPC sources. `--print` prints the hashes.
- Checked on 2026-09-10 against the built app in Chromium, Playwright WebKit and
  the real Tauri WebKitGTK webview (vault manager → browser or memory vault →
  new note → typing with a `[[wikilink]]` → Settings → theme switch → command
  palette → quick open → reload). The only violation was zod 4's eval probe
  (`new Function("")` on first parse), since skipped by `z.config({ jitless:
  true })` in `apps/web/src/main.ts`. Refused, as intended: an injected inline
  `<script>`, an `onerror=` handler, a `javascript:` URL, a remote image or CSS
  beacon, plain-`http:`/`ws:` to a remote host, a cross-origin iframe, a form
  post and an `<object>`. Removing the theme hash from the web policy blocks
  exactly that one script.
