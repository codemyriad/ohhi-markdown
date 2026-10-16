# @ohhi/site — the ohhi.md landing page

A static [Astro](https://astro.build) site, two pages, no client script:

- `/` — what Oh Hi markdown is and what it does differently, with the two
  doors: open the web app, get the desktop app.
- `/download` — the desktop builds, first-launch notes, the browser and the
  `ohhi` command.

## Where things point

Every outbound URL is in `src/links.ts`:

| What | URL | Status |
|---|---|---|
| Web app | `https://app.ohhi.md` | the apex is this site, so the app takes `app.` (`naming`) |
| Desktop downloads | `https://dist.ohhi.md/stable/latest/<file>` | the R2 bucket the `dist` job of `.github/workflows/desktop-release.yml` uploads every public release to; `stable/latest/` holds the newest installers under these stable aliases (`docs/public-deploy.md`) |
| Checksums | `https://dist.ohhi.md/stable/latest/SHA256SUMS.txt` | beside the builds, listing the alias names |

The file names drop the version from the release assets
(`ohhi_<version>_universal.dmg` → `ohhi_universal.dmg`), which is what a
stable alias is for.

## The app's themes, not a copy of them

The site renders in **Oh Hi Light** and **Oh Hi Dark** (the wordmark reads **Oh Hi markdown**, the capital H chosen for the site on 2026-10-16), the app's default
pair, following the visitor's `prefers-color-scheme`. The values are not
copied by hand: `scripts/gen-tokens.mjs` reads `@ohhi/ui`'s
`tokens/editor-light.css`, `tokens/editor-dark.css` and `tokens/_contract.css`
and writes the subset this site uses to `src/styles/tokens.generated.css`,
as plain custom properties — light on `:root`, dark under
`prefers-color-scheme: dark` and under `[data-theme="editor-dark"]`, the
attribute the app itself uses. No Tailwind, no DaisyUI.

```sh
rushx gen-tokens   # rewrite tokens.generated.css from @ohhi/ui
rushx check        # fails if the committed file is stale, then `astro check`
```

`dev` and `build` regenerate first. Edit the theme in `libs/ui`, never the
generated file. The faces are the app's bundled Public Sans and JetBrains
Mono, imported from `@ohhi/ui/styles/fonts.css`.

## Run it

```sh
rush install
cd apps/site
rushx dev       # http://localhost:4321
rushx build     # dist/
rushx preview
```

## Deploy

Static files in `dist/`. On Cloudflare Pages: build command
`node common/scripts/install-run-rush.js install && cd apps/site && node ../../common/scripts/install-run-rushx.js build`,
output directory `apps/site/dist`. `public/_headers` carries the security
headers (a CSP with no script source, since the site has none).
