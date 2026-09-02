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
> `desktop`), libraries in `libs/` (`sync`, `vault`, `testkit`, `editor`).
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
| `apps/relay` | share-token auth + folder-GUID scoping, sqlite persistence |
| `apps/web` | `pill-status` truth table (unit) |

```sh
cd libs/vault && rushx test      # one project
```

Or run every unit suite from the repo root in one go:

```sh
for p in libs/sync libs/testkit libs/vault apps/relay apps/web; do
  (cd "$p" && rushx test) || break
done
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
error** (not an eternal "connecting…"). The relay it spawns uses a throwaway temp
db and the fixed share `e2eroom:e2e-token` (see `e2e/start-relay.mjs`); the web
app is built and served on `localhost:4173`, the relay on `ws://localhost:8799`.

### Type checks

```sh
cd apps/web && rushx check       # svelte-check
cd apps/relay && rushx check     # tsc --noEmit
```

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

**File tree (M3).** The sidebar is a real nested tree: folders collapse
(click a focused folder to toggle), and empty folders are first-class — they
enroll, sync, and materialize on peers like files (`mkdir` is part of the
vault-adapter seam). **+ file** creates an untitled note in the selected
folder; **+ folder**, **rename**, **move**, and **delete** act on the focused
file/folder via small dialogs. A folder rename is one bulk folder-map
transaction — children follow on every peer — and deletes journal each file's
pre-image before touching disk. A bulk external change (a git branch switch,
20+ files at once, live or discovered at boot) now pauses behind a real
**confirm dialog** listing the files — nothing is ingested until you apply,
and *Not now* defers the batch.

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

- **Share one folder** *(the unit of sharing — dogfood-shaping R3)*: click the
  folder in the tree → **share** → **Share this folder**. The app mints a
  token, carves the folder into its own synced space (spike S8 Q1 — no files
  are moved or changed), and hands you the copyable `editor1:…` link. Green
  pills appear **only inside the shared folder**; the rest of the vault stays
  local. The folder shows a `shared` badge, and the tree's All/Local/Shared
  filter splits the view by provenance.
- **Share the whole vault**: header → **Share this vault** → **Create share
  link** (one click, same minting path).
- **Manage tokens**: in either share dialog — list a share's tokens (label,
  read-only), mint extra labeled tokens (one per person/device), revoke.
  Revoking blocks *new* connections; connected peers persist until they
  reconnect (R4.3 is deliberately deferred).
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

**Unshare / unmount (M5).** Click a shared folder in the tree →
- **unshare** — stop syncing and fold the folder back into the vault (files
  stay, same content identity; peers keep their copies but nothing syncs).
  Optional checkbox revokes all of the share's relay tokens.
- **unmount** *(joined shares)* — drop the share from this vault; the files
  stay on disk and re-enroll as plain local notes (delete the folder
  afterwards if you don't want them).

**Moving across a share boundary (M5)** asks for confirmation first: moving a
file *out* of a shared folder removes it for everyone else; moving one *in*
makes it visible to everyone. Either way the file's sync identity starts over
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
for p in libs/sync libs/testkit libs/vault apps/relay apps/web; do (cd "$p" && rushx test) || break; done

# end-to-end browser smoke (self-contained)
cd apps/web && rushx e2e

# two-tab demo
cd apps/relay && SEED_SHARE="demo:demo-token" rushx dev      # terminal 1
cd apps/web   && rushx dev                                   # terminal 2
# then open the two role=seed / role=join URLs from §4
```
