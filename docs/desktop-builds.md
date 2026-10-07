# Desktop builds

How the Tauri 2 desktop app (and the web app the team host serves) is built
and released, how teammates install and update it, and the webview's Content
Security Policy. Workflow:
[`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml)
— its comments cover the job layout, token permissions and signing placeholders.
The team host it publishes to (the team host, over the company tailnet) is described in
[`deploy-tailnet.md`](deploy-tailnet.md).

## How releases happen

**Every push to `main` is a release.** Actions → **Desktop release** builds
Linux and macOS in parallel, then publishes a **prerelease** `v<major>.<minor>.<run>`,
for example `v0.1.42`: major and minor come from `version` in
`apps/desktop/src-tauri/tauri.conf.json`, and the patch is the workflow's run
number, so every build counts up, which the updater needs. The version is
injected at build time (`tauri build --config`), and `tauri.conf.json` keeps
its base. About five minutes later the team host's pull picks the release up: the web
app switches over and installed desktop apps offer the update.

- **Bursts collapse.** A newer push to `main` cancels the build in progress
  (`cancel-in-progress`), so ten merges in a row produce one release, not ten.
- **Docs-only pushes don't build** (`docs/**`, root `*.md`, `.claude/**`).
  Other markdown does build: the web app bundles `templates/*.md`.
- **The release is atomic.** It is created as a draft, every asset is
  attached, and only then is it published. A run cancelled in that window
  leaves an orphan draft: delete it in the Releases page.
- **Run workflow** on `main` behaves like a push. On any other branch it makes
  a **draft** prerelease that the team host never sees, for trying a build by hand.

**Tagged releases** are still possible: bump `version` in `tauri.conf.json`,
then `git tag v0.2.0 && git push origin v0.2.0`. The build fails if the tag and
the version disagree, and the result is a **draft** release to check and publish
by hand. Mind the ordering: `v0.2.0` sorts *below* the `v0.2.<run>` builds
that follow it on `main`, so a tag marks a milestone; it is not the update
channel.

### Build settings

| Setting | Kind | Effect |
| --- | --- | --- |
| `TEAM_HOST` | repository variable | Bare hostname of the team host, e.g. `ohhi.<tailnet>.ts.net`. Sets the default relay to `wss://<host>/relay`, pins the CSP to that host (below) and points the updater at `https://<host>/updates/latest.json`. Unset → none of that, and no `latest.json`. |
| `DEFAULT_RELAY` | repository variable | Fallback default relay when `TEAM_HOST` is unset. |
| `TAURI_SIGNING_PRIVATE_KEY` | secret | The updater's minisign key (no password). Unset → the build still succeeds, but without updater bundles. The public key is in `tauri.conf.json`. Losing the private key means every installed app has to be reinstalled by hand, so it also lives in the password manager. |

A relay saved in Settings › Sync always wins over the build's default.

### What lands where

Each release carries, flat:

| Asset | What |
| --- | --- |
| `ohhi_<version>_amd64.AppImage` | Linux x86_64, any distro with glibc ≥ 2.35 (Ubuntu 22.04+). **Updates itself.** |
| `ohhi_<version>_amd64.AppImage.sig` | its updater signature |
| `ohhi_<version>_amd64.deb` | Debian / Ubuntu 22.04+. Install-only: does not auto-update. |
| `ohhi_<version>_universal.dmg` | macOS installer, Apple Silicon and Intel in one file |
| `ohhi_<version>_universal.app.tar.gz` | macOS updater bundle (the bundler's `ohhi.app.tar.gz`, renamed) |
| `ohhi_<version>_universal.app.tar.gz.sig` | its updater signature |
| `web.tar.gz` | the web app's `dist/`, with `index.html` and `_headers` at the archive root (as `./…`) |
| `latest.json` | the updater manifest (Tauri v2 static format), only when `TEAM_HOST` is set; its URLs point at `https://<host>/updates/<tag>/<file>` |
| `SHA256SUMS.txt` | checksums of all the above |

The build artifacts also stay in the workflow run for 14 days. There are no
Windows or Linux arm64 builds. macOS is one universal build so nobody downloads
the wrong one; it costs about the same runner minutes, since each arch compiles
once either way. macOS minutes on a private repo are billed at a multiple of
Linux's. If the budget bites, move desktop builds to a path filter or a nightly
schedule and keep the web app per push.

**Signing:** macOS builds are ad-hoc signed (`bundle.macOS.signingIdentity: "-"`)
and not notarized; Linux packages are unsigned. Updates are signed separately
with the updater key, and the app refuses an update whose signature doesn't
match the public key it was built with.

### Updates

On launch and every 6 hours, installed apps check
`https://<team host>/updates/latest.json` (Settings › General shows the version
you're running). A newer build downloads and installs in the background, then a
toast offers **Restart**. If you ignore it, the new build runs next time you
open the app. The check only reaches the feed from the tailnet; off it, or in
a local build with no feed configured, the check fails quietly (one console line)
and is retried later.

- **Signed:** updates are minisign-signed. The public key is in
  `tauri.conf.json`, the private key is the repo secret
  `TAURI_SIGNING_PRIVATE_KEY` (and in the team password manager), and a
  bad signature is refused. Losing the private key means every installed app
  must be reinstalled by hand.
- **macOS:** updates through the `.app.tar.gz`. Only the first install needs
  the Gatekeeper step below, because an update the app downloads itself is
  not quarantined.
- **Linux AppImage:** replaces itself in place.
- **Linux .deb:** updates through `pkexec dpkg -i`, which asks for your
  password, but only when the release carries a `.deb.sig`. Otherwise the
  manifest has no `linux-x86_64-deb` entry and a .deb install never updates:
  prefer the AppImage.

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
- **Hosted web app:** `apps/web/public/_headers`, which the team host's Caddy turns into response headers ([deploy-tailnet.md](deploy-tailnet.md)) — the same
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

1. **Pin at build time** — release builds bake the team host into
   `connect-src`. Cheap and right for a single-relay team, but gives up "any
   relay". **Applied to team builds** (below).
2. **Pin the hosted web app per deployment** — a deployment serves one relay
   anyway, so `_headers` can name just that one. The same pin covers it: the
   team host serves the `_headers` of the build it runs.
3. **Move the network into Rust** (the real fix for desktop) — a Tauri command
   owns the relay WebSocket and admin calls against an allowlist the user
   approved in a native dialog, the tokens leave the webview, and
   `connect-src` shrinks to `'self' ipc: http://ipc.localhost`. With a scoped
   filesystem grant, an injected script could then neither read much nor send
   it anywhere.

**Team builds are pinned (option 1).** When the repository variable
`TEAM_HOST` is set, the release workflow runs
`node apps/desktop/scripts/pin-csp.mjs <host>` before the web build. It
replaces `wss: https:` in both policies' `connect-src` with
`wss://<host> https://<host>`, so the desktop app and the web app the team host
serves can reach the team host (relay, admin API) and loopback, and nothing
else. The script edits only those bytes, a second run is a no-op, and it fails
if a policy has neither the unpinned sources nor this host's, so a team build
can't ship unpinned without anyone noticing. `check-csp.mjs` still compares the
pinned policies. The committed policies and local builds stay unpinned, and so
does a relay saved in Settings that points elsewhere. On a pinned build that
relay is refused: switching relays means a build without `TEAM_HOST`. The
updater's own requests come from Rust, outside the webview's CSP.

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
