---
status: current
date: 2026-10-06
---

# Running & testing Editor (V1)

The practical runbook: how to install the toolchain, run the automated test
suite, drive the **two-tab collaboration demo** in a browser, and (once the
system libs are installed) launch the Tauri desktop shell. This is the operational
companion to [architecture/testing.md](architecture/testing.md), which explains
*why* the test harness is shaped the way it is — this doc is just *how to run it*.

> **Where things are.** Rush monorepo. Apps in `apps/` (`relay`, `web`,
> `desktop`, `cli` — the `ohhi` binary), libraries in `libs/` (`sync`, `vault`,
> `testkit`, `editor`, `index`, `agent`, `i18n` — the app's dictionaries).
> `rushx <script>` runs a project's `package.json` script from inside that
> project folder.

---

## 1. Prerequisites

**Toolchain (all platforms):**

- **Node** in range `>=20.14.0 <23.0.0` (the repo targets **22.12**).
- **Rush** `5.153.0` and **pnpm** `10.17.0` — Rush manages pnpm for you; you
  invoke Rush via `node common/scripts/install-run-rush.js …`, or install it
  globally with `npm install -g @microsoft/rush` and use `rush`/`rushx`.

**System libraries — desktop (Tauri) only.** Not needed for the browser demo or
the test suite. On this Linux machine:

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev
```

`libdbus-1-dev` is **not** in Tauri's official prerequisite list, but `cargo
check` on this machine fails without it (`libdbus-sys` can't find `dbus-1.pc`).
Plus a Rust toolchain via `rustup`. See [`apps/desktop/README.md`](../apps/desktop/README.md)
for the full desktop story.

---

## 2. One-time install

From the repo root:

```sh
rush install      # or: node common/scripts/install-run-rush.js install
```

Use `rush update` instead if you've just changed a `package.json`.

For the end-to-end browser test you also need the Playwright Chromium binary
once:

```sh
cd apps/web && ./node_modules/.bin/playwright install chromium
```

---

## 3. Running the tests

The harness has three tiers (L0 model tests → L1 reconciler fuzz → L2 browser
smoke; see [architecture/testing.md](architecture/testing.md)). There is **no
aggregate `rush test` command** — you run each project's `test` script. The L0/L1
suites are pure and fast; L2 spins up a real relay + a built web app.

### Unit / model / reconciler tests (L0 + L1)

Run per project with `rushx test`:

| Project | What its tests cover |
|---|---|
| `libs/sync` | engine seam — heads = state-vector + delete-set, origin tagging |
| `libs/testkit` | the SimClock / TestNetwork the model tests run on |
| `libs/vault` | LCA reconciler — convergence, no-data-loss, idempotence (fuzz) |
| `libs/workspace` | mount lifecycle — carve, join, unshare, boot recovery |
| `libs/ui` | the **theme contract** — every theme defines the sync tokens, they stay visually distinct (including under deuteranopia), foregrounds clear 4.5:1, no presence colour sits near the diverged red, and the sync tokens are unlayered |
| `libs/index` | the **backend conformance suite** — paging, cursors, ranking, link resolution, rename/delete propagation. Written against the interface, so any future backend passes it or is not a valid backend |
| `libs/editor-lang` | the wikilink grammar, through the real lezer pipeline |
| `libs/i18n` | the **dictionary contract** — every key is a non-empty string with typed arguments, the generated types describe the base dictionary (fails with "regenerate" when a group was added without `rushx generate`), and `i18nObject('en')` / `getLL()` translate |
| `libs/agent` | the **agent surface's command core** — every op over a fixture vault written to a temp dir: paging, truncation, section addressing, EOL preservation, every `refused`/`conflict`/`not_found` path, `changes` from both sources, `restore`'s journal union, and vault selection (explicit / env / walk-up / ambiguous / none) |
| `apps/cli` | the `ohhi` binary — **conformance** (`spec/` matches the freshly generated schemas; every op's `--json` output parses against its contract schema; exit codes 0/1/2/3), flag parsing, the text renderers, and a cold-start check that spawns the bundle |
| `apps/relay` | share-token auth + folder-GUID scoping, sqlite persistence |
| `apps/web` | `pill-status` truth table, tree model, share links, config, the command registry — plus **component tests** for the `src/lib/ui/` primitives (jsdom + Svelte Testing Library: Escape/click-outside/focus-return on dialogs, arrow keys on menus and tabs, tooltip on focus, the form field's ARIA wiring) |

```sh
cd libs/vault && rushx test      # one project
```

Or run every unit suite from the repo root in one go:

```sh
for p in libs/i18n libs/sync libs/testkit libs/vault libs/workspace libs/ui libs/index \
         libs/agent libs/editor-lang apps/relay apps/cli apps/web; do
  (cd "$p" && rushx test) || break
done
```

`apps/cli`'s conformance and cold-start tests run the esbuild bundle, so build it
first: `cd apps/cli && rushx build`. (CI does the same, between the typecheck
loop and the test loop.)

### Repo-wide guards

Two greps, both build gates:

```sh
./scripts/check-clock-injection.sh   # golden rule 5 — no ambient timers in sync code
./scripts/check-design-tokens.sh     # golden rule 7 — no raw palette utilities in components
```

### The index benchmark (not a CI test)

`libs/index` carries the evidence behind `plans/v2-shaping.md` Fork 1 — the
decision to ship an in-memory index instead of sqlite-wasm/FTS5 — as a
re-runnable measurement, skipped unless you point it at a real vault:

```sh
cd libs/index && EDITOR_BENCH_VAULT="/path/to/your/vault" rushx test
```

It prints corpus size, cold build time, search latency and heap, and **fails if
the trigger has fired** (>5,000 md files, >20 MB markdown, cold build >750 ms,
or search p95 >50 ms) — at which point the SQLite backend is due. Last measured
on the real vault: 1,029 notes / 3.00 MB, 253 ms cold build, ~1 ms search.

### The `ohhi` CLI (agent surface)

The agent surface is `libs/agent` (the command core) plus `apps/cli` (the `ohhi`
binary and `ohhi mcp`). Full reference: [agent-access.md](agent-access.md).

**Build and install.** Two POSIX-`sh` scripts, both symlinking rather than
copying, both refusing to clobber a non-symlink unless you pass `--force`, both
taking `--dry-run`:

```sh
./scripts/install-ohhi.sh     # rushx build in apps/cli, then ~/.local/bin/ohhi -> apps/cli/bin/ohhi.mjs
./scripts/install-skill.sh    # ~/.claude/skills/ohhi-vault -> .claude/skills/ohhi-vault
```

`install-ohhi.sh --bin-dir <dir>` puts the link elsewhere; `--no-build` links
what is already built. The skill is a **symlink on purpose** — a hand copy in
`~/.claude/skills` is how the Cassini skill went stale against its repo.

**Drive it:**

```sh
ohhi stats --vault "/path/to/your/vault"
ohhi search "connection pooling" --limit 10
ohhi read "Areas/CS/JSON.md" --outline
ohhi search "json" --json | jq -r '.hits[] | "\(.tier)\t\(.path):\(.line)"'
```

Or without installing: `cd apps/cli && rushx build && node dist/ohhi.mjs stats --vault …`.

**Regenerate the JSON Schemas.** `spec/*.schema.json` is generated from
`libs/agent/src/contract.ts` and committed — regenerate it, never hand-edit it
(golden rule 9). The conformance test fails on drift:

```sh
cd apps/cli && rushx gen-schemas
```

Two more schemas in `spec/` are the app's own resource formats, not op
outputs — `ohhi.layout.v1.schema.json` and `ohhi.keymap.v1.schema.json` — and
they come from the **app's** generator, which also writes `examples/` and the
id lists between the `generated:` markers in `docs/customising.md`. Rerun it
after adding a command (and its id in `apps/web/src/lib/command-ids.ts`), a
readout, a region or a view; `resource-schemas.test.ts`,
`command-ids.test.ts` and `customising-docs.test.ts` fail on drift:

```sh
cd apps/web && rushx gen-schemas
```

**Fonts.** The bundled typefaces (`libs/ui/fonts/`, woff2 — Public Sans and
JetBrains Mono) and
`libs/ui/src/styles/fonts.css` are vendored by a script — the only network
step, run by a person, output committed; the app never fetches a font:

```sh
cd libs/ui && rushx fonts
```

**The cold-start budget.** A cold invocation on the real vault has to stay under
~500 ms (shaping R6) — which is why the CLI is an esbuild bundle rather than a
Rush TypeScript entry point. The check is skipped unless `dist/` exists, and it
only asserts and prints the wall clock when you point it at a real vault:

```sh
cd apps/cli && rushx build
cd apps/cli && EDITOR_BENCH_VAULT="/path/to/your/vault" rushx test
```

The matching evidence on the ranking side lives in `libs/index`: under the same
`EDITOR_BENCH_VAULT` its bench asserts the seven real-vault probes (`Docs`,
`JSON`, `HTML`, `Svelte`, `Testing`, `Writing`, `networking`) each put the note
meant first, and `test/ranking-corpus.test.ts` pins the same behaviour on a
committed synthetic vault so a regression fails in CI without a vault present.

**Register the MCP server** (the alternative to the skill, for harnesses that
cannot run one):

```sh
claude mcp add ohhi -- ohhi mcp --vault "/path/to/your/vault"
```

### End-to-end browser smoke (L2)

One Chromium two-context Playwright test (seeder + joiner sharing one relay). It
**spawns its own relay and builds + serves the web app** — you don't start
anything yourself. From `apps/web`:

```sh
cd apps/web && rushx e2e
```

What it asserts: edits propagate both ways, presence shows both users, concurrent
typing converges, offline drops the sync pill honestly and reconnect reconverges,
binary files are badged not synced, and a **bad token fails fast with a visible
error** (not an eternal "connecting…"). The relay it spawns uses a throwaway
temp db and two fixed shares — `e2eroom:e2e-token` for the collab smoke and
`chrome-tree:chrome-token` for the chrome tree test (`SEED_SHARE` takes a
comma-separated list; see `e2e/start-relay.mjs`);
the web app is built and served on `localhost:4173`, the relay on
`ws://localhost:8799`.

`e2e/v2.spec.ts` covers the V2 slices in the same run: quick-open finds a note
by fuzzy path; search answers from the index with highlighted snippets, reflects
an edit **without a reload**, and lands the caret on the matching line; wikilinks
resolve, decorate, Mod-click through, and an unresolved one creates the note;
`Mod+[`/`Mod+]` walk the visited notes; the word count tracks the open note; the
theme retints chrome and the CodeMirror surface together and survives a reload;
the command palette lists its bindings; the tree's **right-click menu renames a
note, drag-and-drop moves it between folders, and a folder's disabled Share…
still states its rule** — and **a user theme can neither repaint nor hide the
sync pill**, which is asserted by actually attacking it rather than assumed from
the cascade.

**Most specs boot the `dense` example layout.** `appUrl()` in
`e2e/fixtures.ts` adds `?layout=dense` (a session-only layout choice) unless a
spec passes `layout: null`, because every spec written before the layout spec
waits for the navigator column (`file-tree`) at boot; the manager entry point
is `MANAGER_URL` (`/?layout=dense`). Since round 3 there is one built-in
layout, `default`, and `dense` is an example file: `parseLayoutParam` maps the
URL's `dense` to `custom:dense`, which the built-in root serves by name (a
stored `dense` choice, by contrast, reads as `default`). A spec about the
quiet default boots with `layout: null` and gets a fresh profile's `default`.

`e2e/layout.spec.ts` covers the layout spec (foundations Stage 1, round 3
Q6): a new install boots `default` (no navigator column, no rail column, the
format bar at the bottom); Settings › Layout (a view tab) applies live,
has nothing to save, persists, and *Reset to default* restores; the Files
field turns the drawer into a column at once, and a pinned side reads
"(pinned)" with *Unpin*; no field combination can hide the `sync` icon (word
count off, toolbar at the bottom); and the palette's *Use layout file…* lists
a vault file beside Default and applies it; the navigator's pin lives in a
header row the tab strip's height, in the drawer and as a column.

`e2e/quiet.spec.ts` covers the default layout (Stage 2, rounds 2–4) and the
format bar (Stage 3): one toolbar and, since round 4, the tab strip with one
note, its `+` right after the tab (`tabs: auto` hides it until a second tab); `format.bold`
from the format bar, with the word count following the selection; the format
bar floating bottom centre with the word-count corner on its row, never
covering the last line, and `top` floating under the header; the *Format*
menu in a narrow split pane on a wide window; `view.focus` (`Mod+.`) and `Escape`, and the `leave-focus`
way out when the toolbar is hidden too; a saved layout with the toolbar at the
bottom, the format bar and the mode bar above it; the header at 480 px
(arrows, the right end, nothing overflowing); opening from the drawer
replaces the note in place; the drawer navigator; the dock replacing the Note
menu; the focus edge on a split following `Alt`+arrows; the off-focus sync
dot when the relay is gone; and, with no title in the toolbar any more, the
lone tab as drag handle (a split by dragging it) and tab menu (right-click).

`e2e/dock.spec.ts` covers the dock (round 2 P4, round 3 Q3): the strip floats
top-right; an icon opens the panel on its tab; `Escape` and `Mod+ArrowRight`
close it; pin opens it as the rail column, which offers unpin only, and
unpinned it is the floating strip again; pinned, the format bar and the
corner span the panes left of the column; bottom-right, the strip stands
above the corner count at every width; at a narrow width the strip shrinks to
its expand button, and Focus mode hides it. A view tab draws neither the strip
nor the format bar and corner (devtools-shaping D7); `e2e/chrome.spec.ts`
checks it over the Log and the Inspector, and that a note's tab brings them
back.

`e2e/small-screen.spec.ts` (QA round 1) boots the default layout at a phone's
width (390 px) with touch on: the format bar scrolls across most of the row
instead of folding, with the word count as a number chip at its right end
that a tap expands; a tap in the note closes the file drawer and the dock panel
(a click on a wide window still leaves the drawer open); a pin made on a wide
window is kept but not honoured at phone width — the drawer, its pin control
`aria-disabled` and saying why — and is a column again when the window widens.
A tap on a rendered wikilink places the caret and shows the link card
(`libs/editor-lang` `preview/link-tap.ts`); the card's *Open* or a second tap opens
the note, typing takes the card down, a tap beside the link only places the
caret, and a mouse click still follows a rendered link (the card's state and
the hit test are unit-tested in `libs/editor-lang/test/link-tap.test.ts`).

`e2e/fonts.spec.ts` (round 3 Q7) loads the built app **and** `vite dev` and
asserts zero console errors and zero failed font requests — the dev server
used to 403 every face in `libs/ui/fonts` until `apps/web/vite.config.ts`
allowed it in `server.fs.allow`. Since round 4 it also opens the app in
**WebKit** (the desktop's engine on Linux is WebKitGTK) and asserts body text
is the static 400 face — no variable instance, no synthesised bold; that case
is skipped unless `npx playwright install webkit` has been run.

`e2e/shared.spec.ts` covers the shared world (Stage 4, sharing E1–E4): Alice
adds Bob's room from the Shared view, sees him in People and his changes by
name in the Changes card, and the Shared view stays honest through a relay
outage; a vault that shares nothing opens Shared on its onboarding.

`e2e/chrome.spec.ts` covers the shell (chrome U2+): the pinned rail is the
dock panel (its tabs, unpin only — no collapse — one open state and one tab,
`Mod+ArrowRight` focusing its tab); the
navigator resizes from the keyboard (its handle is a valued `separator`),
hides on `Mod+ArrowLeft`, and the layout survives a reload; the breadcrumb
names the open note and reveals its folder in the tree; the status bar carries
the word count and the note's own pill. The tree test (U3) needs the
`chrome-tree` room: a synced note is green in the status bar and carries no
dot in the tree; the toolbar is icons with names; collapse-all, the filter
menu (radio items), F2 rename, `Mod+Shift+R` delete-with-confirm, a refused
drop's reason on the hovered row, and *Add a shared folder* (disabled with its
rule in a root-shared vault; reachable from the palette). The where-am-I test
(sharing E6, *This note* dissolved) checks the breadcrumb's folder popover and
the Shared view say where the open note lives — a linked vault is "on your
devices", never "shared". The log test (Stage 4a, which replaced the rail's
*Activity*) opens an unseeded room so the relay rejects the token: the error
toasts once, badges the drawer's bell until it is opened, and stays in the
Log view with its scope and level filters (*Clear* asks first); developer
tools, switched on in Settings › Developer, open the inspector from the
palette as a tab. The settings test (U6) drives the tabs
from the keyboard, refuses an invalid relay URL inline (`aria-invalid` +
`aria-describedby`), prompts on Escape with unsaved changes, and saves a
valid change from its own tab. The type test (round 2 P9) checks every chrome
surface renders in the interface token: the file tree in Public Sans, code
in JetBrains Mono.

`e2e/a11y.spec.ts` is the **accessibility gate**: axe (WCAG 2.1 AA + best
practice) over the default layout (no columns), the vault manager, the
workspace with a note open, quick-open, the tree's context menu, a rename
dialog, the vault menu, settings, the collapsed rail, the tab-group chrome,
the History section, the Live / Reading surfaces, the join-a-share dialog, the
share sheet's first run and the device-link dialogs; `quiet.spec.ts` runs axe
over the toolbar, the format bar, Focus mode, the drawer navigator and the
dock as well. Any violation fails the run and prints the offending node
with the rule.

`e2e/shots.spec.ts` is a screenshot pass over all four themes, for eyeballing
rather than gating:

```sh
cd apps/web && SHOT_DIR=/tmp/shots ./node_modules/.bin/playwright test e2e/shots.spec.ts
```

(It is excluded from the default project via `testIgnore`, so `rushx e2e` and
CI never run it.)

### Type checks

```sh
cd apps/web && rushx check       # svelte-check
cd apps/relay && rushx check     # tsc --noEmit
cd apps/cli && rushx check       # tsc --noEmit
cd libs/agent && rushx check     # tsc --noEmit
cd libs/i18n && rushx check      # regenerates the typesafe-i18n output, then tsc --noEmit
```

### The dictionaries (typesafe-i18n)

Every user-facing string in `apps/web` is a key in `libs/i18n/src/i18n/en/`
(`index.ts` = the root `common` group, `web/index.ts` = the shell). The typed
accessors are **generated** and committed:

```sh
cd libs/i18n && rushx generate        # one-shot: i18n-types.ts, i18n-util*.ts, i18n-svelte.ts
cd libs/i18n && rushx typesafe-i18n   # the same, in watch mode while you edit the dictionary
```

Add a key, regenerate, then use it as `$LL.web.<group>.<key>()` in a
component or `getLL().web.…` in a module. A key referenced but not generated
fails `rushx check` in `apps/web`; a group added but not generated fails
`rushx test` in `libs/i18n`. Conventions and the no-hardcoded-strings rule:
`.claude/skills/ui-development`.

---

## 4. The two-tab collaboration demo (browser)

This is the manual version of the L2 test, and the quickest way to watch sync
work — two browser tabs editing the same vault through a live relay. It uses
**`mode=memory`**: each tab holds an in-memory vault (the seeder ships a couple
of demo files), and the relay carries the CRDT updates between them. The memory
URL contract is a dev/e2e affordance and stays supported; for the real
manager-driven flows (open/create a vault, share, join a link — no URL params)
see [§4b](#4b-the-vault-manager-flows-open--create--share--join).

### Step 1 — start the relay *with a seeded share*

```sh
cd apps/relay && SEED_SHARE="demo:demo-token" rushx dev
```

This listens on `ws://0.0.0.0:8787` and pre-creates a share whose **folder GUID
is `demo`** and **token is `demo-token`**.

> ⚠️ **This is the #1 gotcha.** If you start the relay *without* `SEED_SHARE`,
> the `demo-token` share doesn't exist and the relay rejects every connection.
> The seeder tab still looks fine (it renders its own in-memory vault), but the
> joiner can't authenticate. The room (`demo`) and token (`demo-token`) in the
> URLs below **must** match the seeded share exactly.
>
> Prefer a generated token instead of a fixed one? Run the share CLI and copy
> the token it prints into both URLs:
> ```sh
> cd apps/relay && node --experimental-strip-types src/cli.ts share-add demo --label "manual demo"
> ```

### Step 2 — start the web dev server (separate terminal)

```sh
cd apps/web && rushx dev
```

Vite serves on `http://localhost:5173`.

`libs/editor` and `libs/editor-lang` are consumed **from source** (their
`main` is `src/index.ts`; there is no `dist` to rebuild), so a change there
is picked up by the dev server — but **hard-reload the tab** after changing
either library: CodeMirror extensions are built when an editor view mounts,
so a hot update does not reach the views already on screen.

### Step 3 — open two tabs

Open these two URLs (tab order doesn't matter; the **seeder** provides the
initial files, the **joiner** materializes them from the relay):

**Tab 1 — seeder (Alice):**
```
http://localhost:5173/?mode=memory&role=seed&relay=ws://localhost:8787&room=demo&token=demo-token&user=Alice
```

**Tab 2 — joiner (Bob):**
```
http://localhost:5173/?mode=memory&role=join&relay=ws://localhost:8787&room=demo&token=demo-token&user=Bob
```

Click a file (e.g. `notes/welcome.md`) in both tabs and type. You should see:
edits flow both ways within a second, each user's name and cursor in the other
tab, and a sync pill that goes **green** when synced with the relay.

### URL parameter reference

| Param | Values | Meaning |
|---|---|---|
| `mode` | `memory` | V1 dev shell only supports memory mode (no params → vault manager) |
| `role` | `seed` \| `join` | seeder ships the initial files; joiner pulls them from the relay |
| `relay` | `ws://host:port` | the running relay's websocket URL |
| `room` | folder GUID | **must equal** the seeded share's folder GUID |
| `token` | string | **must equal** the seeded share's token |
| `user` | display name | shown in presence; picks a stable cursor colour |

(Contract lives in `apps/web/src/lib/params.ts`.)

---

## 4b. The vault manager flows (open / create / share / join)

These are the real, URL-param-free flows (onboarding-shaping.md, extended by
dogfood-shaping M2 and first-run-shaping A1/B1/F1). With no URL params the app
shows the **vault manager**, in one of two states:

- **The welcome** (no vault registered yet): "Oh hi.", one sentence, and three
  doors worded as the thing you have — *Open a folder of notes* (desktop; an
  Obsidian vault opens as it is) or *Start a vault in this browser* (browser:
  a named, OPFS-backed private vault, offered only when the browser supports
  OPFS; the name is asked in the row), *Add a folder someone shared with you*,
  and *Bring your vault from another device*. The top bar carries the version
  (desktop), help and Settings; the foot opens the **Import** dialog ("Coming
  from another app?") and links the two-minute guide. No name is asked here:
  the name peers see is the first row of Settings › Sync & devices.
- **The list** (one or more vaults; also where *Manage vaults…* and a failed
  auto-reopen land): one row per vault — a kind glyph, the name ("open now"
  on the vault open behind the manager), the path and when it was last opened
  (or "in this browser", the site's storage use and whether the browser has
  promised to keep it), and chips for what the vault's mount table says:
  *N folders shared by you*, *N shared with you* or *nothing shared* ("—"
  when the table cannot be read). One **+ Add** menu holds the welcome's
  doors plus *Import from another app…*; a row's **…** menu offers Open,
  Rename… (this list's name only, never the folder) and Remove from this
  list… (an inline confirm — files are never touched). The foot says who
  people you share with see you as (*Change* opens Settings) and how many
  links you were sent (a popover that re-joins one).

On relaunch the app reopens your last vault automatically — and if that boot
fails (moved folder, dead relay), you land back on the manager with the error
shown in the failing row, with *Try again* and *Remove from this list…*,
instead of a dead-end screen. Your name, vault registry, and settings persist
in `localStorage` (`editor:config`, migrated automatically from the pre-M2
keys).

Inside a workspace, the header's **vault name ▾** switches between vaults or
returns to the manager, and **⚙** opens Settings (display name, default relay,
relay operator secret for the upcoming in-app share minting, remembered
shares/vaults).

**The default relay is set at build time.** `VITE_DEFAULT_RELAY=wss://… rushx
build` (or a git-ignored `apps/web/.env.local`, see `apps/web/.env.example`)
sets the relay a fresh install proposes for new shares; unset or malformed →
`ws://localhost:8787`. A relay saved in Settings › Sync & devices always wins; an install
that never saved one follows each new build's default.
**The relay is one card** (`RelayCard.svelte`, first-run D1), drawn in the
Shared view, Settings › Sync & devices and the share sheet's first run: icon, host in
mono, a status line, actions. For a relay this vault holds rooms on it reads
the Shared view's snapshot ("Connected · N rooms · in sync with the relay
since …" / "Reconnecting…" / "Offline · last in sync …" / "Refused by the
relay: …" — receipt, never "durable"); for one it is not connected to yet it
probes `GET /healthz` ("reachable · checked just now" / "can't reach it from
here" — a health check, never a valid token); with no relay saved and none in
the build (`config.ts relayKnown`) it says "No relay yet", one relay per
group, and links the relay guide. The team's relay (same host as the build's
default) is marked so, with `VITE_TEAM_NETWORK_NOTE` under it. The Shared
view's empty state shows the card above its three doors, reading the relay,
not the secret (plus "To create links you will need the team's secret once."
until a secret is saved).
Two more build-time sentences sit beside it, `VITE_TEAM_SECRET_HINT` (where
the operator secret lives) and `VITE_TEAM_NETWORK_NOTE` (reachability), read
by `config.ts` as `TEAM_SECRET_HINT` / `TEAM_NETWORK_NOTE` ('' when unset);
the release workflow fills them from repo variables (`docs/desktop-builds.md`).
**A pinned build** (`VITE_TEAM_HOST`, the workflow's `TEAM_HOST`; `config.ts
TEAM_HOST`) has a CSP that allows no other relay, so the card offers no
*Use another…* / *Change…*, Settings › Sync & devices shows the relay address
read-only, and both say "This build syncs through <host> only."

**The secret is verified and placed** (D2): titled "Permission to create
links", it is checked against the relay's admin API after a paste (debounced)
and on blur — "works" (a listing call answered 200), "doesn't match this
relay", "this relay has no admin API", "can't reach the relay" — with a
*Where do I get this?* disclosure (the build's hint, else the generic
sentence). The same disclosure sits in *Your devices* in Settings › Sync & devices and
in the device-link dialog when no secret is saved.

**The share sheet's first run** (no operator secret yet): "Syncs through" +
the relay card (*Use another…* opens the address field, which is open from
the start when no relay is known), the verified secret, then — for any folder
not shared yet — "First link: who is it for?" (+ read-only) and "Your name,
shown to them" (prefilled from the saved name, saved on Share; Fork 5-A), then
*Share and copy link*, disabled with the reason until the secret says
"works". Share remembers relay + secret in Settings › Sync & devices, carves (the
carve's token is this device's own credential, never read-only), and — when
the first link is named — mints that person's link beside it and copies it.
Links leave the sheet in the URL form when an origin is known
(`share-message.ts`: the browser's `location.origin`; the desktop's
`originForRelay(<room relay>)`; else the bare `editor1:` link), carrying
`label` (the folder) and `from` (the name typed). After Share and on every
link row there are *Copy link* and *Copy message*; the message is "I shared
<folder> with you in Oh hi markdown. Open this link: <link>", then the network
sentence for the team's relay, then "New to the app? <origin>/guide/start.html"
when there is an origin. The e2e relay runs without an operator secret, so
specs see the secret answer "this relay has no admin API".

**Adding a shared folder as its own vault** says what happens next under the
choice (desktop: you will pick an empty folder; browser: kept in this
browser), and the progress panel is titled "Adding <folder>" with a Folder
row — "Linking this device" is the device link's alone. A browser vault
opened this way is named after the link's folder label, else "Shared folder
on <host>".

**Browser storage.** A browser vault lives in storage the browser may clear
unless it has promised to keep it. At launch the web app checks
`navigator.storage.persisted()` and, if false, asks once with `persist()`.
While the answer is no, the welcome's browser door carries *Ask the browser
to keep it* under its description (the list shows a dismissible note with the
same button), a workspace reopened straight into a browser vault gets
one notice per session, and Settings › Sync & devices shows the status,
usage and the reminder switch. None of this runs in the desktop app. To see
the note in Chromium, use a fresh profile (a well-used site may already hold
the grant).

**File tree (M3).** The sidebar is a real nested tree: folders collapse
(click a focused folder to toggle), and empty folders are first-class — they
enroll, sync, and materialize on peers like files (`mkdir` is part of the
vault-adapter seam). The header's **+ file** / **+ folder** create in the
focused folder. A folder rename is one bulk folder-map transaction — children
follow on every peer — and deletes journal each file's pre-image before
touching disk. A bulk external change (a git branch switch, 20+ files at once,
live or discovered at boot) now pauses behind a real **confirm dialog** listing
the files — nothing is ingested until you apply, and *Not now* defers the batch.

**Right-click anything in the tree (2026-09-07).** The context menu replaced
the old inline row of text buttons, and it is now the only route to sharing:

| Right-clicked | Menu |
|---|---|
| A file | Rename… · Move… · Delete… |
| A folder | New file · New folder · Rename… · Move… · **Share…** · Delete… |
| A shared folder (mount root) | …the same, but **Manage tokens…** · **Unshare…** in place of Share — plus **Unmount…** when the share was joined rather than carved by you |
| Empty space below the rows | New file · New folder (at the vault root) |

It is a real ARIA menu: **Shift+F10** (or the Menu key) opens it from the
keyboard on the focused row, ↑/↓/Home/End move, Enter activates, **Escape**
closes and puts focus back on the row. When an item cannot apply it is shown
**disabled with the reason printed under it** rather than hidden — most
importantly *Share…* in a vault that is already shared as a whole, where the
V1 no-nested-shares guard (`plans/spike-s8-mount-lifecycle.md`, "The mount
model") forbids folder shares.

**Drag to rearrange.** Drag a file or folder row onto a folder row (or onto the
empty area of the tree to move it to the vault root); the destination lights up
only when the move is legal. A folder cannot be dropped into itself or a
descendant, a drop back into the same parent is a no-op, and a name collision
is refused — all decided by `planDrop()` in `apps/web/src/lib/tree-model.ts`
(unit-tested). A drop that crosses a share boundary goes through the same
confirm dialog as **Move…** (below). Keyboard users use **Move…**, which is
equivalent.

**Open a folder (desktop, O1).** Manager → **Open a folder of notes** (the
welcome's first door, or *+ Add* in the list) → pick a
folder via the native dialog (its *New Folder* button covers the create case).
Your `.md` files on disk are the source of truth; edits save back atomically.
This needs no relay — it works fully offline. Reopening the same folder later
resumes the same vault entry (same room, same durable stores).

**Share — minted in-app, zero terminal (M4).** One-time setup: start the relay
with an operator secret and store the same secret in the app —

```sh
OPERATOR_SECRET=my-secret SEED_SHARE=demo:demo-token rushx dev   # apps/relay
```

then in the app: **⚙ Settings** → set the default relay URL and the operator
secret. From there:

- **Share one folder** *(the unit of sharing — dogfood-shaping R3)*:
  right-click the folder in the tree → **Share…** → **Share this folder**. The
  app mints a token, carves the folder into its own synced space (spike S8 Q1 —
  no files are moved or changed), and hands you the copyable `editor1:…` link.
  Green pills appear **only inside the shared folder**; the rest of the vault
  stays local. The folder shows a `shared` badge, and the tree's
  All/Local/Shared filter splits the view by provenance.
- **Sharing the whole vault is no longer offered** (2026-09-07). It was one
  click away from making every folder share impossible for the life of the
  vault — mounts never nest, so a root share silently disables the affordance
  the product is built around. Vaults that are *already* root-shared (joined
  from a whole-vault link, or driven by the `mode=memory` URL contract) keep
  working exactly as before: they boot, sync, read "shared" in the header, and
  their folders' **Share…** items explain why they are disabled. They simply
  have no share-management UI. To share everything, share the folders you mean
  to share — or use the relay CLI, which still mints a token for any room.
- **Manage tokens**: right-click a shared folder → **Manage tokens…** — list a
  share's tokens (label, read-only), mint extra labeled tokens (one per
  person/device), revoke. Revoking blocks *new* connections; connected peers
  persist until they reconnect (R4.3 is deliberately deferred).
- The relay CLI (`share-add`/`share-list`/`share-rm`) still works and is the
  only path when `OPERATOR_SECRET` is unset — the admin HTTP API answers 404
  without it (see `apps/relay/README.md`).

**Join a share (desktop O2 / browser O3).** Manager → **Add a folder someone
shared with you** (a welcome door, or *+ Add* in the list) → paste
the link — the bare `editor1:…` string or its URL form
`https://<host>/join#editor1:…` (the payload rides in the fragment, so no
server sees it). Besides relay, room and token, a link may carry a `label`
(the folder's path, or the vault's name for a device link) and a `from` — the
sharer's self-reported name, "the name they typed", not a verified account.
It opens as a new vault in your list. On the browser the
vault is stored privately in **OPFS**; on desktop you pick a local folder to
materialize into. The relay's content is pulled and you're co-editing live. The
`?share=` deep-link (`/?share=editor1:…`) works too and is cleared from the URL
once you join.

**The join page (first-run C2/C3).** In a browser, the URL form
`https://<host>/join#editor1:…` opens a page of its own instead of the
manager (`params.ts` `joinPageLink`; any path `/join`, the app's index.html
served there by Vite's SPA fallback in dev and preview and by Caddy's
`try_files` on the team host). It says "<from> shared <label> with you" —
the sender as "the name they typed, not a verified account", or "Someone
shared a folder" when the link carries neither — what you get, which relay
it syncs through (the team's when its host is the build's
`VITE_DEFAULT_RELAY` host, with `VITE_TEAM_NETWORK_NOTE`; else "a relay run by
whoever shared this"), and the relay's health check (`relay-probe.ts`
`GET /healthz`, run on load: "The relay answered." means the
check answered, never that the link is valid; "Can't reach the relay from
here." says what to do, then "reload this page"). Then *In the desktop app* →
**Copy link** (paste it into the app's *Add a folder someone shared*; no deep
link yet, Fork 3-B) or *In this browser* → **Add here**, which replaces the
address with `/` (the token leaves the address bar and Back's history) and
opens the manager with the Add dialog on the link. A device link is
explained as one and offered *Link this device* instead; a damaged link
shows the codec's reason and "paste it in the app". The desktop never shows
the page: there the URL is pasted into the dialogs, which read every
spelling. To try it locally: `rushx dev` in `apps/relay` with a seeded share,
then open `http://localhost:5173/join#<editor1:… link>`.

**The Add dialog** takes the bare link, the `…/join#…` URL or a `?share=` URL.
Under a valid paste it shows "<label>, shared by “<from>” (the name they
typed) · syncs through <host> · " and the relay check's answer ("relay
reachable" / "can't reach the relay from here", plus the network note on the
team's host); the check runs per paste and is cancelled when the dialog
closes. "Your name, shown to the people in this folder" is prefilled from the
saved name and saved when the join starts.

**Join a share INTO an existing vault (M5).** In a workspace: header →
**Add share** → paste the link and pick a destination folder (new or empty —
e.g. `shared/team`). The shared content materializes there, badged
`shared with you`, syncing alongside your local notes. Guards refuse non-empty
destinations, overlaps with existing shared folders, and (V1) adding shares
inside a vault that is itself shared.

**Unshare / unmount (M5).** Right-click a shared folder in the tree →
- **Unshare…** — stop syncing and fold the folder back into the vault (files
  stay, same content identity; peers keep their copies but nothing syncs).
  Optional checkbox revokes all of the share's relay tokens.
- **Unmount…** *(joined shares)* — drop the share from this vault; the files
  stay on disk and re-enroll as plain local notes (delete the folder
  afterwards if you don't want them).

**Moving across a share boundary (M5)** asks for confirmation first — whether
you used **Move…** or dragged the row: moving a file *out* of a shared folder
removes it for everyone else; moving one *in* makes it visible to everyone. Either way the file's sync identity starts over
in its new home. A file *deleted or moved away by an external tool* (git,
Obsidian, a file manager) is never silently dropped: Editor raises a
**vanished-file review** offering *Restore file* (from the synced content —
concurrent remote edits included) or *Confirm removal* (tombstones it for
every peer; a recovery copy lands in the journal first).

> **Reopen is durable (slice M1).** Every vault — local or joined — persists
> its CRDT doc state, LCA records, and pre-image journal in a per-vault store
> (app-data under Tauri, OPFS in the browser), so a relaunch boots from those
> stores alone: no wipe, no re-pull, fully offline for shared vaults too (the
> relay is caught up with in the background when reachable). Files edited,
> added, or deleted while the app was closed are classified by the reconciler
> at boot — external edits ingest, vanished files raise a review, new files
> enroll additively; a bulk change (e.g. a git branch switch) pauses for
> confirmation. See `plans/spike-s8-mount-lifecycle.md`.

**Resetting a test vault.** To restart a vault with completely fresh shared
state while keeping every `.md` on disk: manager → the vault row's **…** → *Remove from
this list…* → confirm ("Remove?") → reopen the same folder via *Open a folder of notes*.
Forgetting a vault deletes its entire durable store namespace (mounts,
CRDT blobs, LCA records, journal) plus its tokens and remembered share
links; the reopened folder enrolls fresh under a **new room**, so old share
links are dead and new ones mint cleanly. Disk files are never touched —
except for **browser (OPFS) vaults**, whose notes live only in the browser:
forgetting one deletes its notes too (the confirm note says which you're
getting). Relay-side rows for the old rooms become inert orphans — harmless,
cleanable with `share-rm`/the admin API, or just point the dev relay at a
fresh `DATA_DIR`. If the vault is open when you remove it, the workspace is
shut down first; you stay on the manager.

**Sync devtools (M6).** A read-only inspector of every file's disk ↔ CRDT
state, opened as a pane tab. Enable it with **⚙ Settings → Developer tools**
(persisted per device) or force it for one session with `?debug=1`; then
*Open inspector* in the palette, the bug icon at the toolbar's right, or
*Inspect this note* in the sync icon's hover card opens it. The list: scope
chips per mount (each with a health dot), the mount's identity and whether
`mounts.json` agrees with the live session, then the files as pipeline rows
(`disk ═══ base ≠≠≠ doc … relay`) in the pill's colours, worst first, with tally
chips per state that are both the key and the filter. Selecting a row shows
its detail — the chain, its state in a plain sentence, the three texts and
their pairwise diffs, the raw facts — as a right column when the
pane is wide and a drawer over the list when it is narrow; *Open in its own
tab* moves one file's detail to a tab titled `Inspector · <path>`. **Copy
report** puts the selected file or every row in scope on the clipboard as
text for a bug report; the scope's report names the active filters and order
and counts `N of M rows`. The mount snapshot re-reads when the vault's shape
changes (files created, deleted or renamed, mounts coming or going), when
the scope changes and on its refresh button; a record change only re-colours
the rows and re-reads the selected file. No polling — the snapshot's age is
re-worded on a clock tick, nothing is read by it — and nothing in it can
mutate state.

---

## 5. The desktop (Tauri) shell

**Status: builds and runs.** The `TauriVaultAdapter` (real on-disk vault) and the
landing/open-folder flow are in; the fs + dialog plugins are registered and
capability-scoped to `$HOME/**`. Confirm a clean Rust compile (first run is slow;
needs the §1 system libraries):

```sh
cd apps/desktop/src-tauri && cargo check
```

Then two terminals (the Tauri config deliberately does **not** auto-start Vite —
Rush drives the web app, Tauri only attaches to it):

```sh
# terminal 1 — web frontend
cd apps/web && rushx dev

# terminal 2 — desktop shell (attaches to the Vite dev server)
cd apps/desktop && rushx dev
```

**Restart terminal 1 after any `apps/web/vite.config.ts` change** (including one
that arrives with a `git pull` or merge). `tauri dev` renders whatever answers on
`:5173`. A dev server started before a config change keeps serving the old config,
or, if its automatic restart fails, keeps running with nothing listening. With the
config from before the `server.fs.allow` fix, every bundled woff2 under
`libs/ui/fonts/` gets a 403 and the webview falls back to a system face (Noto Sans
on Ubuntu). Restart: Ctrl-C both terminals, run
`rushx dev` in `apps/web`, then run `rushx dev` in `apps/desktop`. To check, run
`curl -sI http://localhost:5173/` and expect `200`. In the browser, the Network
tab should show every `*.woff2` returning 200 from `/@fs/…/libs/ui/fonts/`.

Full desktop notes (icons, fs capability scope, how the web app detects Tauri via
`window.__TAURI_INTERNALS__`) are in [`apps/desktop/README.md`](../apps/desktop/README.md).

---

## 6. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Joiner tab hangs on **"connecting…"** forever | Old behaviour when the share didn't exist. Now the error lands on the **vault manager**, and an open still going after 5 s offers **Back to your vaults** (the opening page says "Opening your notes…" since QA round 1 — it waits for the vault's own files, never the relay). Cause is almost always a missing/mismatched share — start the relay with `SEED_SHARE="demo:demo-token"` and make sure `room`/`token` in the URLs match (§4). |
| Boot error mentioning **"relay rejected this token"** | The token isn't a valid share on the relay. Check `SEED_SHARE`, or list shares: `cd apps/relay && node --experimental-strip-types src/cli.ts share-list`. |
| Need to reset a vault's durable sync state | The per-vault stores (doc blobs, LCA, journal, `mounts.json`) live at `~/.local/share/md.ohhi/stores/<room>` (desktop; `md.ohhi.desktop` before 2026-10-16, `dev.chris.editor` before that) or OPFS `stores/<room>` (browser). Deleting a vault's store dir forces a fresh enroll (local vault) or a clean rejoin (shared vault) on next launch — file contents on disk are never touched. |
| Nothing loads, the **vault manager** shows | No `mode` param. Use the full URLs in §4. |
| `cargo check` fails at a `pkg-config` / `dbus-1.pc` step | Missing system lib — install the §1 apt line (note `libdbus-1-dev`). |
| `cargo check` fails with `E0119: conflicting implementations … From<…HourBase>` in `cookie`/`time` | The lockfile pinned `time` 0.3.48, a broken release (since yanked) that breaks downstream crates on recent rustc. Fix: `cargo update -p time` (moves to 0.3.49+). See [time#783](https://github.com/time-rs/time/issues/783). |
| Playwright e2e can't find a browser | Run `./node_modules/.bin/playwright install chromium` in `apps/web`. |
| Console says a font can't be found, or `*.woff2` returns 403 under `vite dev` / desktop dev | A stale Vite dev server: it was started before a `vite.config.ts` change and is 403-ing the bundled woff2, or it is no longer listening. Restart `cd apps/web && rushx dev`, then `cd apps/desktop && rushx dev` (§5). `npx playwright test fonts.spec.ts` in `apps/web` checks a fresh dev server. |
| Relay won't start: port in use | Another relay is running on `8787`. Stop it, or set `PORT=…` before `rushx dev`. |

---

## Quick reference

```sh
# install
rush install

# all unit tests (build the CLI bundle first — apps/cli's tests run it)
(cd apps/cli && rushx build)
for p in libs/i18n libs/sync libs/testkit libs/vault libs/agent apps/relay apps/cli apps/web; do (cd "$p" && rushx test) || break; done

# the ohhi CLI + the agent skill, on PATH
./scripts/install-ohhi.sh
./scripts/install-skill.sh

# end-to-end browser smoke (self-contained)
cd apps/web && rushx e2e

# two-tab demo
cd apps/relay && SEED_SHARE="demo:demo-token" rushx dev      # terminal 1
cd apps/web   && rushx dev                                   # terminal 2
# then open the two role=seed / role=join URLs from §4
```
