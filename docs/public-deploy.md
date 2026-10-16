# The public deployment: app.ohhi.md and dist.ohhi.md

Oh Hi markdown ships in two **flavours** of one build. The **public** flavour is
the one that is deployed:

```
https://app.ohhi.md     the web app (Cloudflare Pages, project ohhi-web)
https://dist.ohhi.md      the desktop downloads and update feed (R2 bucket ohhi-dist)
https://ohhi.md           the landing page (apps/site)
```

The **team** flavour is a self-hosted build: a team host serves the web app
and the relay from one origin, the CSP is pinned to that host and the desktop
app updates from it. It was built for a company deployment on a private
network, which was abandoned on 2026-10-16: the team uses the public flavour
with the company relay (below), and the team flavour is no longer deployed.
Its code and workflow path remain in the tree until they are removed.

The flavour is build config, not a fork. One variable, `VITE_FLAVOUR`, selects it
([`apps/web/scripts/flavour.mjs`](../apps/web/scripts/flavour.mjs)), and
everything else follows from that variable. A build whose settings contradict its flavour
fails, for example a public build given a team host, or a team build whose
`_headers` is not pinned.

## The two flavours

| | **team** | **public** |
| --- | --- | --- |
| Switch | `VITE_FLAVOUR=team`, set by `desktop-release.yml` when `TEAM_HOST` is set | `VITE_FLAVOUR=public` (`web-deploy.yml`, and `desktop-release.yml` by default) |
| Web app | `https://<team host>/`, served by the team host's reverse proxy from the release's `web.tar.gz` | `https://app.ohhi.md` on Cloudflare Pages, deployed on a push to `production` (a push to `main` makes a preview) |
| Content Security Policy | `connect-src` pinned to `wss://<host> https://<host>` (`pin-csp.mjs`) | unpinned: `wss: https:`, so any relay and the AI providers the harness calls (Anthropic, OpenAI, OpenRouter, any OpenAI-compatible URL) stay reachable |
| Default relay | `wss://<team host>/relay`, baked in. No other relay is offered. | none. The person enters one in Settings › Sync & devices (the team's is `wss://ohhi-relay.codemyriad.io`), or opens a share link, which carries its relay. |
| Team sentences | `TEAM_SECRET_HINT`, `TEAM_NETWORK_NOTE` | none (the build refuses them) |
| Desktop update feed | `https://<team host>/updates/latest.json` | `https://dist.ohhi.md/stable/latest.json` |
| *Get the desktop app* list | `https://<team host>/updates/downloads.json` | `https://dist.ohhi.md/stable/downloads.json` |
| Desktop share links | `https://<team host>/join#…` for the team relay, else the bare `editor1:` link | `https://app.ohhi.md/join#…` for any `wss:` relay, else the bare link |
| Release tag | `v<version>`, which the team host's pull script deploys | `public-v<version>`, which that script ignores |

Both flavours bake in the same `public/_headers`. It is Cloudflare Pages' own
`_headers` format, so Pages applies it as is; a team host's deploy script turns
its `/*` rule into its reverse proxy's header lines. Only the public flavour
leaves the CSP unpinned.

The build-time values behind it (`apps/web/.env.example`):

| Name | Where it comes from | Effect |
| --- | --- | --- |
| `VITE_FLAVOUR` | the workflow | the switch |
| `PUBLIC_WEB_HOST` | repo variable, default `app.ohhi.md` | the public web app's host; becomes `VITE_WEB_ORIGIN` |
| `PUBLIC_DIST_HOST` | repo variable, default `dist.ohhi.md` | the download host; becomes `VITE_DOWNLOADS_URL` and the updater endpoint |
| `VITE_DOWNLOADS_URL` | derived from the flavour, unless set | Settings › About's *Get the desktop app*. Unset → not offered |
| `VITE_WEB_ORIGIN` | derived (public only), unless set | where a desktop build points the share links it makes |

## Once, in Cloudflare and GitHub (Chris)

`ohhi.md` is on Cloudflare DNS (Free plan). Nothing below costs money on the
Free plan apart from R2 storage above its free tier.

1. **API token.** My Profile → API Tokens → Create Token → *Custom*:
   - Account › **Cloudflare Pages** › Edit
   - Account › **Workers R2 Storage** › Edit
   - Zone › **DNS** › Edit, zone `ohhi.md` (only needed if wrangler attaches
     the custom domains; the dashboard steps below do it without the token)
   - Account resources: the one account; Zone resources: `ohhi.md` only.
2. **The Pages project** (once; the workflow only deploys into it):
   ```sh
   npx wrangler@4.145.0 pages project create ohhi-web --production-branch main
   ```
   Then Workers & Pages → `ohhi-web` → Custom domains → add `app.ohhi.md`.
   Cloudflare writes the CNAME, since the zone is on the same account.
3. **One host, no alias.** A browser vault lives in its origin's storage, so
   serving the app on two origins would split people's notes: `app.ohhi.md`
   is the only host (`hi.` and `write.` were considered and dropped on
   2026-10-16). If an alias is ever wanted, make it a 301 (Rules → Redirect
   Rules → *Redirect from one hostname to another*, keeping the query string;
   the `#editor1:…` fragment of a share link survives a redirect), never a
   second custom domain.
4. **The R2 bucket:**
   ```sh
   npx wrangler@4.145.0 r2 bucket create ohhi-dist
   npx wrangler@4.145.0 r2 bucket cors set ohhi-dist --file deploy/cloudflare/r2-cors.json
   ```
   Then R2 → `ohhi-dist` → Settings → Custom Domains → add `dist.ohhi.md`.
   Leave the `r2.dev` public URL off. The CORS rule
   ([`deploy/cloudflare/r2-cors.json`](../deploy/cloudflare/r2-cors.json))
   lets `app.ohhi.md` read `stable/downloads.json`.
   The desktop updater needs no CORS, because its requests come from Rust.
5. **GitHub** (Settings → Secrets and variables → Actions):
   - secret `CLOUDFLARE_API_TOKEN`: the token from step 1
   - secret `CLOUDFLARE_ACCOUNT_ID`: the account ID (Workers & Pages → right-hand column)
   - variable `PUBLIC_WEB_HOST`: optional, only to move off `app.ohhi.md`
   - variable `PUBLIC_DIST_HOST`: optional, only to move off `dist.ohhi.md`
   - `TAURI_SIGNING_PRIVATE_KEY` is already there; the public builds sign
     their updates with the same key.

If either secret is missing, both workflows still build. They skip the
Cloudflare step with a warning instead of failing.

## What each push then does

Every merge to `main` gets a preview to look at; nothing goes live until
someone pushes it to the branch that ships.

- **Push to `main`** that touches the web app or what it bundles (`apps/web`,
  `libs`, `docs/guide`, `examples/themes`, the dependency set): the **Web
  deploy** workflow builds with `VITE_FLAVOUR=public`, runs the CSP guard and
  deploys `dist/` to Pages as a **preview**, at
  `preview-main.ohhi-web.pages.dev`. One that touches the landing page
  (`apps/site`, the `@ohhi/ui` styles it reads) does the same for the site,
  at `preview-main.ohhi-site.pages.dev`.
- **Push to `production`** (`git push origin main:production`) with the same
  paths: the production deploy of `app.ohhi.md`.
- **Push to `site`** (`git push origin main:site`): the production deploy of
  `ohhi.md`.
- *Run workflow* on Web deploy or Site deploy: on `production` (or `site`),
  the production deploy; on any other branch, a preview at
  `<branch>.ohhi-web.pages.dev` (or `.ohhi-site.`), never the custom domains. If the first push that creates `production` or `site` does not deploy (a
  branch's first push gives the paths filter little to compare against), *Run
  workflow* on the new branch does.
- **Push to `release`** (`git push origin main:release`): the **Desktop
  release** workflow builds Linux and macOS in the public flavour, the
  default, and publishes the prerelease `public-v<version>` on GitHub. The
  `dist` job then reads that release back, checks `SHA256SUMS.txt`, and
  uploads to R2:

  | Key | What | `Cache-Control` |
  | --- | --- | --- |
  | `<version>/<file>` | every asset but `web.tar.gz` (the installers, updater bundles, `.sig`s, both manifests, `SHA256SUMS.txt`) | `public, max-age=31536000, immutable` |
  | `stable/latest/<file>` | the newest installers under version-less names (`ohhi_universal.dmg`, `ohhi_amd64.AppImage`, `ohhi_amd64.deb`) and a `SHA256SUMS.txt` listing those names, so `sha256sum -c` works on them: what [ohhi.md/download](https://ohhi.md/download) links (`apps/site/src/links.ts`) | `no-store` |
  | `stable/downloads.json` | the installers for *Get the desktop app* | `no-store` |
  | `stable/latest.json` | the updater feed, uploaded **last** | `no-store` |

  The same push runs the mobile builds ([mobile-builds.md](mobile-builds.md)).
  *Run workflow* on any other branch builds a public draft that uploads
  nothing. *Run workflow* › channel `team` builds the retired team flavour
  ([desktop-builds.md](desktop-builds.md)); nothing deploys it any more.

The **web app** and the **landing page** go live when someone pushes to
`production` or `site`; `main` only ever makes previews. The **public desktop
builds** ship only on a push to `release`, because of Actions minutes (macOS
is billed at a multiple). Installed public apps update from
`stable/latest.json`.

The Pages projects' production branch is `main` in Cloudflare (step 2
above), so the workflows map git branches onto Pages branches
(`PAGES_PRODUCTION_BRANCH`): git `production` (or `site`) deploys as Pages'
`main`, git `main` as `preview-main`, and any other branch under its own
name.

## *Get the desktop app*

Each release writes a `downloads.json` beside its bundles
([`apps/web/scripts/downloads-manifest.mjs`](../apps/web/scripts/downloads-manifest.mjs)):
the version, the date and one entry per installer (`.dmg`, `.AppImage`,
`.deb`, and an Android `.apk` once the mobile builds attach one), each with
its URL, size and sha256. The team host serves it as
`/updates/downloads.json`; R2 serves it as `stable/downloads.json`.

In a **browser**, Settings › About shows *Desktop app*. It offers the file for the
detected OS (macOS → `.dmg`; Linux → the AppImage, then the `.deb`), with one
sentence on installing it and the guide's install notes, then lists the other
files. The browser-storage note (the vault manager's card and Settings › Sync
& devices) adds one line, *Get the desktop app for macOS*. The palette command
**Get the desktop app** (`app.desktop-download`) opens Settings › About. The
**desktop app** shows none of this, nor does a build without
`VITE_DOWNLOADS_URL`. The list is fetched once, on first need, with no
cookies and no referrer.

## The repository

`codemyriad/ohhi-markdown` is public. Its history was filtered before the
flip, so the team host's runbook and the private design notes never shipped;
host material lives in the private `codemyriad/systems` repository. A public
repository whose pushes deploy needs these settings, and this is why:

- **Branch protection on `main`, `release`, `production` and `site`.** A
  push to `production` deploys app.ohhi.md, a push to `site` deploys
  ohhi.md, a push to `release` cuts a desktop release, and `main` is what
  all three are pushed from, so each takes changes only from a maintainer
  (`main` through a reviewed pull request): no force pushes, no deletion,
  status checks (`CI`) required.
- **Workflow approval for outside contributors.** Settings › Actions ›
  General › *Require approval for all outside collaborators* (at least for
  first-time contributors): a pull request from a fork must not run CI until
  a maintainer has read it. Fork runs get no secrets anyway, and no workflow
  uses `pull_request_target`; keep it that way.
- **The Cloudflare secrets in an environment**, optionally.
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` can move from
  repository secrets into a GitHub environment restricted to `main`,
  `production`, `site` and `release` (`main` deploys previews), so no run on
  another branch can ever read them; the deploy jobs
  then gain an `environment:` line. Today they are repository secrets, and
  only the small deploy jobs (which check nothing out and run no third-party
  code) receive them.
- **Private vulnerability reporting on**, so the channel `SECURITY.md` names
  exists. Secret scanning with push protection on; both are free for a public
  repository.
- **Dependabot alerts on.** Whether to take its pull requests is a separate
  choice: Rush wants `rush update` after a bump, which Dependabot does not run.

## Open questions

- **A public relay, or none?** For the team, answered on 2026-10-16: the
  company relay, `wss://ohhi-relay.codemyriad.io`, a relay the company runs
  and publishes through a Cloudflare Tunnel (documented in the private
  `codemyriad/systems` repository; the generic recipe is
  [guide/relay.md](guide/relay.md)). The public build still bakes in no
  relay: a teammate enters that URL in Settings › Sync & devices, or opens a
  share link, which carries it. It had to be a public hostname: Chrome's
  Local Network Access check blocks a page on `app.ohhi.md` from connecting
  to a relay on a private address at all. A relay for strangers
  (`relay.ohhi.md`) stays open: it would need abuse limits, an
  operator-secret story for strangers and a cost owner. If one is decided,
  the flavour would set `VITE_DEFAULT_RELAY` (today the build refuses it) and
  the no-relay copy would change with it.
- **A public repo and a public dist.** The repository is public, so a GitHub
  release is public too. `dist.ohhi.md` stays the download host the app and
  the landing page point at (stable aliases, `downloads.json`); the release
  page is the build's record and a second place to find the files. Release
  notes ("What changed") open the bundled guide page, which works. A public
  changelog would still need its own home (the landing page).
- **Apple signing.** macOS builds are ad-hoc signed and not notarized, so a
  stranger's first launch is blocked by Gatekeeper and needs the
  `xattr`/*Open Anyway* step. For a public download this needs a Developer
  ID certificate and notarization (the commented `APPLE_*` secrets in
  `desktop-release.yml`). Windows has no build at all, so *Get the desktop
  app* says so to Windows visitors and lists what there is.
- **Two download hosts.** Team apps update from their team host and public apps from
  dist.ohhi.md, and their tags differ. A teammate who installs the public
  build gets public updates (no pin, no team relay). That is a different app
  in all but name, so the two should not be mixed on one machine.
- **The Pages production branch.** Both Pages projects (`ohhi-web`,
  `ohhi-site`) still have `main` as their production branch in Cloudflare;
  the workflows map git `production` and `site` onto it. Switching the
  Cloudflare setting to `production` (and `site`) and setting
  `PAGES_PRODUCTION_BRANCH` to match in each workflow is an optional
  tidy-up that turns the mapping into the identity.
- **The join page's Download link** still goes to the guide's install
  section. It could link the right file from the same `downloads.json`.
