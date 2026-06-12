---
status: V1 design — update as built
date: 2026-06-12
---

# Architecture overview — V1 tracer bullet

This is the system map for Editor's V1: a minimal collaborative markdown editor over a
test subfolder of the real vault, with CRDT sync between two Tauri clients and the collab
test harness green in CI. Ground truth is [plans/slices.md](../../plans/slices.md) (V1
section) and [plans/shaping.md](../../plans/shaping.md) (shape D); this doc is the
narrative map over those decisions.

The one-sentence model: **plain `.md` files on disk are canonical; CRDTs are the
transport and merge mechanism for files you chose to share; a reconciler keeps the two
honest with each other.**

## Component diagram

```mermaid
flowchart TB
    subgraph desktop["apps/desktop — Tauri 2 shell"]
        subgraph web["apps/web — Svelte 5 UI"]
            ui["File tree · Sync pill · Divergence review · Vault picker"]
            editor["libs/editor — CM6 + thin Svelte wrapper"]
        end
        vault["libs/vault — VaultAdapter · watcher · enrollment · reconciler"]
        sync["libs/sync — engine seam (Yjs 13.6.x inside)"]
        durable[("Durable store (app-data SQLite)<br/>LCA records · GUID bindings · pre-image journal")]
        ydb[("y-indexeddb<br/>local CRDT update log")]
    end
    disk[("Vault folder on disk<br/>plain .md files — canonical")]
    relay["apps/relay — Hocuspocus v4 + SQLite<br/>on a Fly.io volume"]
    external["External writers<br/>git · Claude Code · Obsidian"]
    testkit["libs/testkit — TestNetwork · memfs fuzz driver · injected clock/scheduler"]

    ui --> editor
    editor --> sync
    web --> vault
    web --> sync
    vault --> sync
    vault --> durable
    vault <--> disk
    external --> disk
    sync <--> relay
    sync --> ydb
    testkit -. "drives in CI" .-> sync
    testkit -. "drives in CI" .-> vault
```

Two clients in the V1 demo run this whole stack each; they meet only at `apps/relay`
(and, out-of-band, at git — the dual-transport question is deferred to Spike S2).

## Packages and responsibilities

Rush monorepo, packages named `@editor/<name>`, created per-slice (shaping D10).
`rush.json`'s projects list is the source of truth for what exists.

| Package | Responsibility |
|---|---|
| `apps/desktop` | Tauri 2 shell. Hosts `apps/web`; provides native filesystem access (`watchImmediate`, atomic writes) so corruption bugs surface where they actually live (shaping D6). |
| `apps/web` | Svelte 5 UI: vault picker / first-run enroll, file tree (rendered from the folder doc's path→GUID map), sync pill, crude divergence review, binary badges. |
| `libs/editor` | CodeMirror 6 editing surface in a thin Svelte wrapper; vendored y-codemirror.next binding; remote cursors via awareness. V1 is plain markdown, zero preview (shaping D3). |
| `libs/sync` | The **engine seam**. Owns Y.Docs, the Hocuspocus client provider per doc, reconnect/backoff, the `syncRecord` per doc, and heads/snapshot encoding. The only package that imports `yjs`. See [sync.md](sync.md). |
| `libs/vault` | The disk side: `TauriVaultAdapter` (read/write/list/rename + watcher), `enrollmentService` (GUID minting, seeding, binary detection), the `reconciler` (dmp ingest / materialize / diff3 escalation), `lcaStore`, `preImageJournal` + restore CLI. See [vault-and-reconciler.md](vault-and-reconciler.md). |
| `apps/relay` | Thin Hocuspocus v4 service on Fly.io: static-token auth against a relay-authoritative shares table, SQLite persistence. Deliberately dumb in V1. See [relay.md](relay.md). |
| `libs/testkit` | Injected clock/scheduler + lint rule, TestNetwork (seeded PRNG, partition/heal), memfs fuzz driver with crash injection, `fuzz-crashers/` corpus, git-audit script. See [testing.md](testing.md). |

Split-on-demand later: `libs/index`, `libs/editor-lang`, `libs/agent`, `apps/agentd`
(V2–V3 slices). Don't reference them before their slice creates them.

## Dependency rules

These are boundaries, not suggestions — the engine seam and the vault's independence
from the UI are what make the Yjs-v14/Loro hedge (shaping D1) and the headless test
harness possible.

1. **`apps/web` depends on `libs/*`**, never the reverse. Libraries don't know the UI exists.
2. **`libs/editor` depends on `libs/sync`** for doc handles and awareness — the editor
   binds to a doc session, it doesn't own sync state.
3. **Nothing outside `libs/sync` imports `yjs`.** All other packages speak the seam's
   vocabulary: opaque doc handles, encoded updates, heads (state vector + delete-set
   digest), origin tags. This is what keeps a future engine migration a one-package
   problem. *Enforcement note (assumption, consistent with D1/D3): the vendored
   y-codemirror.next binding is engine-coupled by nature; it is wired through types
   re-exported by the seam and its directory is the single lint exemption.* See the
   [engine seam primer](../primers/04-engine-seam.md).
4. **`libs/vault` never imports `libs/editor`.** The reconciler must run headless —
   for closed files, in tests, and eventually under any future host. It talks to docs
   only through the seam.
5. All Editor-owned sync/reconciler code takes an **injected clock/scheduler**
   (lint-enforced; third-party provider internals exempt). Deterministic simulation is
   the foundation of the harness (shaping D9).

## The two file modes

Every file in an Editor-managed folder is in exactly one mode (shaping D2; see the
[CRDT primer](../primers/01-crdts-and-yjs.md) for why this distinction matters):

| Mode | What it means | CRDT involvement |
|---|---|---|
| **Tracked** | A file Editor knows about but that is not shared anywhere. | **None at all.** No Y.Doc, no LCA record, no sync state. Editing it is plain file editing. |
| **Enrolled** | A file in a shared folder (or individually shared). | **Always-on local Y.Doc**, from enrollment onward, whether or not anyone else is online and whether or not the file is open. |

There is deliberately **no dormant or lazy mode** in between. The shaping decision log
records why: every "file write + LCA bump while the Y.Doc sleeps" design was shown to be
a specified data-loss algorithm (offline work gets classified as already-merged and
overwritten), and session-scoped engagement makes the sync pill structurally dishonest.
Always-on means offline edits are real CRDT ops captured locally with no relay and no
coordination — reconnection is just an update exchange ([sync.md](sync.md)).

The cost of always-on is that disk and CRDT can each move independently — which is
exactly the problem the reconciler exists to solve
([vault-and-reconciler.md](vault-and-reconciler.md), and the
[LCA reconciliation primer](../primers/03-lca-reconciliation.md)).

Binary files are neither: detected at enrollment, excluded from CRDT sync entirely, and
badged "not synced" in the tree. The pill never claims them (shaping D2f).

## How the pieces wire together (V1)

From [plans/slices.md](../../plans/slices.md), Wiring, in dataflow order:

1. On opening a folder, `enrollmentService` walks it, mints a GUID per file into the
   **folder Y.Doc** (the path→GUID map), seeds each file's Y.Text exactly once (single-
   seeder rule for joiners), and writes an LCA record per file to `lcaStore`.
2. `TauriVaultAdapter` watch events (content-hash change detection, quiesce =
   double-read-same-hash) flow into the `reconciler`, which either ingests external
   changes into the Y.Doc as ops tagged origin `'disk'` (LCA advanced in the same
   transaction) or raises `diverged` on the `syncRecord`, opening the review affordance.
3. `syncProvider` connects every enrolled doc plus the folder doc to `apps/relay`.
   Remote updates apply to local Y.Docs; for **closed** files they materialize to disk
   through the pre-image journal and atomic temp-fsync-rename.
4. `docSession` binds CM6 to the open doc's Y.Text — always-on, works relay-down. The
   editor owns the file while open, with a debounced flush on idle/close.
5. The sync pill renders a pure `f(syncRecord)` — it can be wrong only if the record is.
6. `libs/testkit` drives the same reconciler and sync code under injected clocks in CI.

## Golden rules (summary)

The repo-level rules in `CLAUDE.md` compress shape D; the docs here expand them:
files are canonical (1 → vault doc); never reserialize what you didn't change (2 → vault
doc, byte fidelity); always-on CRDT / zero-CRDT tracked split (3 → above); the pill never
lies (4 → [sync.md](sync.md)); injected clocks (5) and tested-not-hoped collab
correctness (6 → [testing.md](testing.md)).

## Reading order

[vault-and-reconciler.md](vault-and-reconciler.md) →
[sync.md](sync.md) → [relay.md](relay.md) → [testing.md](testing.md).
Primers, written for exactly this audience:
[01-crdts-and-yjs](../primers/01-crdts-and-yjs.md) ·
[02-plain-text-crdt-over-markdown](../primers/02-plain-text-crdt-over-markdown.md) ·
[03-lca-reconciliation](../primers/03-lca-reconciliation.md) ·
[04-engine-seam](../primers/04-engine-seam.md) ·
[05-sync-and-relay](../primers/05-sync-and-relay.md).
