---
status: current
date: 2026-06-29
---

# Running & testing Editor (V1)

The practical runbook: how to install the toolchain, run the automated test
suite, drive the **two-tab collaboration demo** in a browser, and (once the
system libs are installed) launch the Tauri desktop shell. This is the operational
companion to [architecture/testing.md](architecture/testing.md), which explains
*why* the test harness is shaped the way it is — this doc is just *how to run it*.

> **Where things are.** Rush monorepo. Apps in `apps/` (`relay`, `web`,
> `desktop`), libraries in `libs/` (`sync`, `vault`, `testkit`, `editor`,
> `i18n` — the app's dictionaries). `rushx <script>` runs a project's
> `package.json` script from inside that project folder.

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
| `apps/relay` | share-token auth + folder-GUID scoping, sqlite persistence |
| `apps/web` | `pill-status` truth table, tree model, share links, config, the command registry — plus **component tests** for the `src/lib/ui/` primitives (jsdom + Svelte Testing Library: Escape/click-outside/focus-return on dialogs, arrow keys on menus and tabs, tooltip on focus, the form field's ARIA wiring) |

```sh
cd libs/vault && rushx test      # one project
```

Or run every unit suite from the repo root in one go:

```sh
for p in libs/i18n libs/sync libs/testkit libs/vault libs/workspace libs/ui libs/index \
         libs/editor-lang apps/relay apps/web; do
  (cd "$p" && rushx test) || break
done
```

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

`e2e/chrome.spec.ts` covers the shell (chrome U2+): the right rail collapses
to icons and reopens to the section clicked, `Mod+ArrowRight` toggles it; the
navigator resizes from the keyboard (its handle is a valued `separator`),
hides on `Mod+ArrowLeft`, and the layout survives a reload; the breadcrumb
names the open note and reveals its folder in the tree; the status bar carries
the word count and the note's own pill. The tree test (U3) needs the
`chrome-tree` room: a synced note is green in the status bar and carries no
dot in the tree; the toolbar is icons with names; collapse-all, the filter
menu (radio items), F2 rename, `Mod+Shift+R` delete-with-confirm, a refused
drop's reason on the hovered row, and *Add a shared folder* (disabled with its
rule in a root-shared vault; reachable from the palette). The note-section
test (U4) checks the rail says where the open note lives and who is online
there, and that the header no longer carries presence. The activity test
(U5) opens an unseeded room so the relay rejects the token: the error toasts
once, stays in the rail's Activity log with its time, counts as unread on the
rail icon until the section is viewed, and the developer-tools toggle there
shows and hides the sync inspector. The settings test (U6) drives the tabs
from the keyboard, refuses an invalid relay URL inline (`aria-invalid` +
`aria-describedby`), prompts on Escape with unsaved changes, and saves a
valid change from its own tab.

`e2e/a11y.spec.ts` is the **accessibility gate**: axe (WCAG 2.1 AA + best
practice) over the vault manager, the workspace with a note open, quick-open,
the tree's context menu, a rename dialog, the vault menu, settings and the
collapsed rail. Any violation fails the run and prints the offending node
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
dogfood-shaping M2). With no URL params the app shows the **vault manager**: a
list of your known vaults (open on click, ✕ to forget — files are never
touched), plus *Open folder as vault…* (desktop), *Create vault* (browser:
a named, OPFS-backed private vault — offered only when the browser supports
OPFS), and *Join a share*. On relaunch the app reopens your last vault
automatically — and if that boot fails (moved folder, dead relay), you land
back on the manager with the error shown against the failing entry instead of
a dead-end screen. Your name, vault registry, and settings persist in
`localStorage` (`editor:config`, migrated automatically from the pre-M2 keys).

Inside a workspace, the header's **vault name ▾** switches between vaults or
returns to the manager, and **⚙** opens Settings (display name, default relay,
relay operator secret for the upcoming in-app share minting, remembered
shares/vaults).

**The default relay is set at build time.** `VITE_DEFAULT_RELAY=wss://… rushx
build` (or a git-ignored `apps/web/.env.local`, see `apps/web/.env.example`)
sets the relay a fresh install proposes for new shares; unset or malformed →
`ws://localhost:8787`. A relay saved in Settings › Sync always wins; an install
that never saved one follows each new build's default.

**Browser storage.** A browser vault lives in storage the browser may clear
unless it has promised to keep it. At launch the web app checks
`navigator.storage.persisted()` and, if false, asks once with `persist()`.
While the answer is no, the manager shows a dismissible note with *Ask the
browser to keep it*, a workspace reopened straight into a browser vault gets
one notice per session, and Settings › Vaults & shares shows the status,
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

**Open a folder (desktop, O1).** Manager → **Open folder as vault…** → pick a
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

**Join a share (desktop O2 / browser O3).** Manager → **Join a share** → paste
the `editor1:…` link — it opens as a new vault in your list. On the browser the
vault is stored privately in **OPFS**; on desktop you pick a local folder to
materialize into. The relay's content is pulled and you're co-editing live. The
`?share=` deep-link (`/?share=editor1:…`) works too and is cleared from the URL
once you join.

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
state while keeping every `.md` on disk: manager → **✕** on the vault →
confirm ("Remove?") → reopen the same folder via *Open folder as vault…*.
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

**Sync devtools (M6).** A read-only inspector of any file's disk ↔ CRDT
state. Enable it with **⚙ Settings → Developer tools** (persisted per
device) or force it for one session with `?debug=1`. A bottom drawer shows,
for the selected file: the raw sync-record fields plus the pill status they
compute to (so you can see *why* a pill is that color); the LCA vs live doc
heads with an explicit **DOC AHEAD of LCA** marker while a flush is pending;
LCA facts (content hash — "(never on disk)" for remote-created files — EOL
flavor, BOM, base-text length); the durable doc blob's size and time since
last flush (session-local — a blob restored from a previous launch reads
"never" until its first flush); the pre-image **journal timeline** (every
guarded disk write, newest first); and the file's mount (room, provenance).
A footer lists every mount's room, provenance, and entry/doc/LCA/journal
counts. It refreshes on selection, on record changes, and via its refresh
button — no polling, and nothing in it can mutate state.

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

Full desktop notes (icons, fs capability scope, how the web app detects Tauri via
`window.__TAURI_INTERNALS__`) are in [`apps/desktop/README.md`](../apps/desktop/README.md).

---

## 6. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Joiner tab hangs on **"connecting…"** forever | Old behaviour when the share didn't exist. Now the error lands on the **vault manager** (and "connecting…" has a Cancel). Cause is almost always a missing/mismatched share — start the relay with `SEED_SHARE="demo:demo-token"` and make sure `room`/`token` in the URLs match (§4). |
| Boot error mentioning **"relay rejected this token"** | The token isn't a valid share on the relay. Check `SEED_SHARE`, or list shares: `cd apps/relay && node --experimental-strip-types src/cli.ts share-list`. |
| Need to reset a vault's durable sync state | The per-vault stores (doc blobs, LCA, journal, `mounts.json`) live at `~/.local/share/dev.chris.editor/stores/<room>` (desktop) or OPFS `stores/<room>` (browser). Deleting a vault's store dir forces a fresh enroll (local vault) or a clean rejoin (shared vault) on next launch — file contents on disk are never touched. |
| Nothing loads, the **vault manager** shows | No `mode` param. Use the full URLs in §4. |
| `cargo check` fails at a `pkg-config` / `dbus-1.pc` step | Missing system lib — install the §1 apt line (note `libdbus-1-dev`). |
| `cargo check` fails with `E0119: conflicting implementations … From<…HourBase>` in `cookie`/`time` | The lockfile pinned `time` 0.3.48, a broken release (since yanked) that breaks downstream crates on recent rustc. Fix: `cargo update -p time` (moves to 0.3.49+). See [time#783](https://github.com/time-rs/time/issues/783). |
| Playwright e2e can't find a browser | Run `./node_modules/.bin/playwright install chromium` in `apps/web`. |
| Relay won't start: port in use | Another relay is running on `8787`. Stop it, or set `PORT=…` before `rushx dev`. |

---

## Quick reference

```sh
# install
rush install

# all unit tests
for p in libs/i18n libs/sync libs/testkit libs/vault apps/relay apps/web; do (cd "$p" && rushx test) || break; done

# end-to-end browser smoke (self-contained)
cd apps/web && rushx e2e

# two-tab demo
cd apps/relay && SEED_SHARE="demo:demo-token" rushx dev      # terminal 1
cd apps/web   && rushx dev                                   # terminal 2
# then open the two role=seed / role=join URLs from §4
```
