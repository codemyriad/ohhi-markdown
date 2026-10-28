# Desktop builds

How the Tauri 2 desktop app (and the web app the team host serves) is built
and released, how teammates install and update it, and the webview's Content
Security Policy. Workflow:
[`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml)
— its comments cover the job layout, token permissions and signing placeholders.
The public flavour, published to `dist.ohhi.md` (and the web app on
`app.ohhi.md`), is described in [`public-deploy.md`](public-deploy.md), which
also says why the team flavour (a self-hosted team host, below) is no longer
deployed.

## How releases happen

**Every push to the `release` branch is a public release.** Pushing to `main`
runs CI only; to ship, move `release` to the commit you want:

```sh
git push origin main:release          # ship what's on main
git push -f origin <sha>:release      # ship (or go back to) a specific commit
```

Actions → **Desktop release** then builds Linux and macOS in parallel in the
**public** flavour, publishes a **prerelease** `public-v<major>.<minor>.<run>`,
for example `public-v0.1.42`, and its `dist` job uploads it to
`dist.ohhi.md` ([public-deploy.md](public-deploy.md)). Major and minor come
from `version` in `apps/desktop/src-tauri/tauri.conf.json`, and the patch is
the workflow's run number, so every build counts up, which the updater needs.
The version is injected at build time (`tauri build --config`), and
`tauri.conf.json` keeps its base. Installed public apps offer the update as
soon as the upload has finished.

- **Shipping is a deliberate step.** Each build costs about 20 Linux minutes
  plus about 3 macOS minutes (billed at a multiple) of the org's Actions
  budget, so builds are not tied to merges.
- **Bursts collapse.** A newer push to `release` cancels the build in
  progress (`cancel-in-progress`). The run number still counts up, so even a
  push of an older commit gets a higher version and installed apps take it.
- **Docs-only pushes don't build** (`docs/**`, root `*.md`, `.claude/**`) —
  except `docs/guide/**`: the web app embeds the guide pages, so a guide-only
  push builds.
  Other markdown does build: the web app bundles `templates/*.md`.
- **The release is atomic.** It is created as a draft, every asset is
  attached, and only then is it published. A run cancelled in that window
  leaves an orphan draft: delete it in the Releases page.
- **Run workflow** on `release` with the default channel (`public`) behaves
  like a push. On any other branch it makes a **draft** prerelease that is
  uploaded nowhere, for trying a build by hand.

**Two flavours.** *Run workflow* has a **channel** input: `public` (the
default, and what a push to `release` builds) or `team`. A public build has
no pin, no relay and no team sentences, updates from
`https://dist.ohhi.md/stable/latest.json`, and is tagged `public-v<version>`,
which a team host never deploys. Run on `release` it is published and the
`dist` job uploads it to the R2 bucket behind `dist.ohhi.md`; on another
branch it stays a draft. The **team** flavour (pinned to `TEAM_HOST`, tagged
`v<version>`, deployed by a team host, as the rest of this page describes)
is built only by *Run workflow* › channel `team` and by a tag push. The
company's team host was retired on 2026-10-16, so nothing deploys a team
build any more; the flavour stays in the code until a later cleanup. The two
run in separate concurrency groups, so neither cancels the other. What
differs and the Cloudflare setup are in [public-deploy.md](public-deploy.md).

**Tagged releases** are still possible: bump `version` in `tauri.conf.json`,
then `git tag v0.2.0 && git push origin v0.2.0`. The build fails if the tag and
the version disagree, and the result is a **draft** release to check and publish
by hand. A tag push is always a team build. Mind the ordering: `v0.2.0`
sorts *below* the `0.2.<run>` builds that follow it on `release`, so a tag
marks a milestone; it is not the update channel.

### Build settings

| Setting | Kind | Effect |
| --- | --- | --- |
| `TEAM_HOST` | repository variable | Bare hostname of the team host, e.g. `ohhi.example.com`. Sets the default relay to `wss://<host>/relay`, pins the CSP to that host (below) and points the updater at `https://<host>/updates/latest.json`. Unset → none of that, and no `latest.json`. |
| `DEFAULT_RELAY` | repository variable | Fallback default relay when `TEAM_HOST` is unset. |
| `TEAM_SECRET_HINT` | repository variable | One sentence saying where this deployment keeps the operator secret, e.g. `the team password manager, under ohhi relay` — never the secret. Baked in as `VITE_TEAM_SECRET_HINT`, for the secret field's *Where do I get this?*. Unset → the app says nothing about where. |
| `TEAM_NETWORK_NOTE` | repository variable | One sentence about reaching the relay, e.g. `Shares work only while you are on the office network.` Baked in as `VITE_TEAM_NETWORK_NOTE`. Unset → nothing is said. |
| `VITE_TEAM_HOST` | web build env (from `TEAM_HOST`) | Not a repo variable of its own: the release workflow passes `TEAM_HOST` to the web build as `VITE_TEAM_HOST`, the bare host the CSP is pinned to. Set → the app offers no other relay (no *Use another…* / *Change…*, the relay field in Settings › Sync & devices read-only) and says "This build syncs through <host> only." Unset → a generic build where any relay may be chosen. |
| `PUBLIC_WEB_HOST`, `PUBLIC_DIST_HOST` | repository variables | Public channel only, both optional: the public web app's host (default `app.ohhi.md`, where a public desktop build points its share links) and the download host (default `dist.ohhi.md`: the update feed, `downloads.json` and the R2 keys' URLs). Defaults live in `apps/web/scripts/flavour.mjs`. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | secrets | Public channel's `dist` job (R2: Edit) and the Web deploy workflow (Pages: Edit). Unset → both skip the upload with a warning. |
| `TAURI_SIGNING_PRIVATE_KEY` | secret | The updater's minisign key (no password). Unset → the build still succeeds, but without updater bundles. The public key is in `tauri.conf.json`. Losing the private key means every installed app has to be reinstalled by hand, so it also lives in the password manager. |

A relay saved in Settings › Sync & devices always wins over the build's default. The
`meta` job flattens the two sentences to one line each and passes them, with
the relay, to every build job's web build; `apps/web/.env.example` lists the
same `VITE_*` names for a local build. The app renders them in the relay card
and the secret field's *Where do I get this?* (first-run-shaping D1/D2, F4).

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
| `latest.json` | the updater manifest (Tauri v2 static format), only when `TEAM_HOST` is set (team) or for a public build; its URLs point at `https://<host>/updates/<tag>/<file>` (team) or `https://dist.ohhi.md/<version>/<file>` (public) |
| `downloads.json` | the installers (`.dmg`, `.AppImage`, `.deb`) with URL, size and sha256, at the same base as `latest.json`: what Settings › About's *Get the desktop app* reads (`apps/web/scripts/downloads-manifest.mjs`). A team host serves it as `/updates/downloads.json`, R2 as `stable/downloads.json` |
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
`https://<team host>/updates/latest.json` (a public build:
`https://dist.ohhi.md/stable/latest.json`) (Settings › About shows the version
you're running and the last check's outcome). A newer build downloads and installs in the background, then a
toast offers **Restart** and **What changed**. *What changed* opens the
`changes` guide page in a guide window: on a team build it is read from
`https://<team host>/guide/changes.html`, which serves the release the update
came from (the host's pull script swaps the web app before it writes `latest.json`);
off the team's network that window shows the webview's own error page. The Help menu's
last line shows the running version and the last check's outcome — "up to
date · checked 2 h ago" only when that check completed and found nothing,
"could not check · last checked …" when it failed. If you ignore the toast,
the new build runs next time you open the app. A team build's check only reaches the feed from the team's network; off it, or in
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

App data lives under the app identifier (`md.ohhi`, the same on every target):
`~/Library/Application Support/md.ohhi` on macOS and `~/.local/share/md.ohhi`
on Linux; on macOS the webview's own storage (the vault list, relay tokens) is
in `~/Library/WebKit/md.ohhi`. Your vault stays wherever you picked it.

- **From `md.ohhi.desktop` (builds before 2026-10-16):** on its first launch a
  build with the new identifier copies each old folder (`…/md.ohhi.desktop`,
  and `~/Library/WebKit/md.ohhi.desktop` on macOS) to the new name, when the
  new one is missing or empty, before anything reads it
  (`apps/desktop/src-tauri/src/app_id_migration.rs`; one log line per folder
  copied). Vault list, sync state, journal and folder grants carry over; the
  old folder is kept untouched, so delete it yourself once the app has opened
  your vaults. A failed copy leaves the new folder absent and is retried on
  the next launch. Updates are unaffected: the AppImage and the macOS app
  replace themselves where they are, and the `.deb` package is still `ohhi`.
- **From `dev.chris.editor` (older still):** not migrated; that app starts with
  fresh sync state, and files are untouched.

**Filesystem access** is the app's own data plus the folders you picked
(`apps/desktop/src-tauri/capabilities/default.json`). Picking a vault folder in
the native dialog is what grants it, recursively; the grant is saved in app
data (`.persisted-scope`, written only by the Rust side) and restored on the
next launch. Dropping a file or folder on the window grants it the same way.
Nothing else under your home folder is reachable from the webview, and
`~/.config/ohhi` is read-only. A vault opened by a build from before this rule
shows "Allow access to this folder again" once in the vault manager: pick the
same folder and it opens as before. Removing a vault from the list does not
revoke its grant (Tauri can add to the scope but not remove from it); the
folder stays reachable until the app data is cleared.

### Guide windows

The Help menu's guide pages (`docs/guide/*.md`, rendered into `dist/guide/`
by `apps/web/scripts/build-guide.mjs`) are bundled with the app and open in a
**second webview window** (`WebviewWindow`, labels `guide-<page>`, one per
page; asking again focuses it). There is no opener plugin, and `frame-src` is
`'none'` in both policies, so neither the system browser nor an iframe. The
main window's capability gains two permissions for it,
`core:webview:allow-create-webview-window` (open one) and
`core:window:allow-set-focus` (bring an open one forward)
(`apps/desktop/src-tauri/capabilities/default.json`); the guide windows are
not listed in any capability, so they get no IPC at all — the pages carry no
script anyway, and the renderer escapes raw HTML in the markdown.

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
- Diagnosed 2026-10-07; the evidence is in `foundations-plan`
  (Round 4 build outcome, the open item).

## Content Security Policy

### Threat model

The webview renders what other people wrote — markdown and theme CSS arrive
through shared folders, relay traffic from teammates' devices — and the same
webview holds the relay tokens and operator secret and, on desktop, Tauri IPC
with read and write access to the vault folders you picked and the app's
stores. Script running there can read and change every note in those vaults
(and anything else inside a folder you picked — so pick the vault, not your
home folder); it cannot reach SSH keys, shell rc files or source trees outside
them. So the policy has two jobs:

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
narrow the filesystem grant below the picked vaults.

### The policies

- **Desktop:** `app.security.csp` in `apps/desktop/src-tauri/tauri.conf.json`.
  Tauri adds `'sha256-…'` sources to `script-src` for the inline pre-paint
  theme script and every bundled JS file, computed at compile time, and (as of
  2.11) sends the policy as a real `Content-Security-Policy` response header.
- **Hosted web app:** `apps/web/public/_headers`, which Cloudflare Pages applies as is and a team host's deploy script turns into its reverse proxy's response headers — the same
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
| `img-src blob:` | A note's pictures (`![[shot.png]]`, `![alt](img/x.png)`) are read from the vault as bytes and drawn from a `blob:` URL the app itself minted (`URL.createObjectURL`); a `blob:` makes no network request. A remote `![alt](https://…)` is never an `img-src`: it waits behind *Load image*, and a click fetches it over `connect-src` (no cookies, no referrer, CORS required) into a `blob:` — so no remote image source is needed, and none loads on open. |
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

**Public builds are not pinned** ([public-deploy.md](public-deploy.md)): any
relay may be chosen, and the AI providers the harness calls need `https:`
anyway. `VITE_FLAVOUR=public` checks after the build that `dist/_headers`
still allows `wss: https:`, so a stray pin can't reach `app.ohhi.md`.

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
  (`new Function("")`, run as each object schema is built), skipped by
  `z.config({ jitless: true })` — which must run before any schema module
  loads, so it is `apps/web/src/lib/zod-jitless.ts`, imported first by
  `main.ts` (a call in `main.ts`'s own body ran after its imports, and
  Firefox kept reporting the probe until 2026-10-28). The legacy Pug grammar,
  which compiled attribute values with `Function(…)` while highlighting a
  ```` ```pug ```` fence, is left out of the fence grammars
  (`libs/editor/src/markdown-editor.ts`). `apps/web/e2e/csp.spec.ts` boots the
  built app under the `_headers` policy and fails on any
  `securitypolicyviolation`. Refused, as intended: an injected inline
  `<script>`, an `onerror=` handler, a `javascript:` URL, a remote image or CSS
  beacon, plain-`http:`/`ws:` to a remote host, a cross-origin iframe, a form
  post and an `<object>`. Removing the theme hash from the web policy blocks
  exactly that one script.
