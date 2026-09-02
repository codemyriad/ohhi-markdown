---
status: current
date: 2026-06-12
---

# Glossary

Every term a newcomer hits in this repo, alphabetical. One to three sentences each, with links to the [primers](README.md) for depth. Ground truth for decisions is [plans/shaping.md](../plans/shaping.md); if a definition and the plans ever disagree, the plans win and this file gets fixed in the same change.

### Awareness
Yjs's ephemeral presence channel: each peer broadcasts a small state (cursor, selection, name) that disappears on disconnect and never enters document history. Used for remote cursors now, agent presence later. See [primer 01](primers/01-crdts-and-yjs.md#awareness-presence-is-not-history).

### CodeMirror 6 (CM6)
The editor component. Its document model is a plain-text string — the file's literal bytes — which makes round-trip fidelity structural; Obsidian-style live preview is a view-only decoration layer added later. See [primer 02](primers/02-plain-text-crdt-over-markdown.md) and [editor-component research](../plans/research/editor-component.md).

### Content-addressed storage (CAS)
Storing blobs under the hash of their content. The V2 plan for syncing attachments (images, PDFs) as last-writer-wins blobs through the relay — binaries never enter Y.Text (D2f).

### CRDT (Conflict-free Replicated Data Type)
A data structure where replicas that have seen the same operations are guaranteed to be in the same state, regardless of delivery order — so concurrent edits merge automatically with no conflict files and no referee. The foundation of all sync here. See [primer 01](primers/01-crdts-and-yjs.md).

### Delete set
Yjs's record of which character IDs have been deleted (tombstoned). Deletes don't advance the [state vector](#state-vector), so any "are we in the same state?" comparison must include the delete set — see [heads](#heads) and the bug class explained in [primer 01](primers/01-crdts-and-yjs.md#delete-sets--and-the-bug-class-heads--sv--ds-prevents).

### diff-match-patch (dmp)
Google's character-level diff library (vendored — upstream is dormant). The reconciler uses it to turn an external file edit into minimal CRDT insert/delete ops instead of replacing content wholesale. See [primer 03](primers/03-lca-reconciliation.md).

### diff3
The classic three-way merge algorithm (also vendored, as node-diff3): given *ours*, *theirs*, and a common *base*, it auto-merges non-overlapping changes and flags overlapping hunks. Used only for true [three-way divergence](#three-way-merge); overlaps go to [divergence review](#divergence-review).

### Divergence review
The human-facing affordance when both disk and CRDT changed since the [LCA](#lca-last-common-ancestor) and their hunks overlap: in-editor keep-mine / keep-theirs / accept-merge, hunk by hunk. Never a `*.conflict` file, never git resolution UX (R3). See [primer 03](primers/03-lca-reconciliation.md).

### Dogfood gate
A slice-completion criterion defined by real use, not features: gate 1 (closes V2) = the team's shared business-dev folder lives in Editor; gate 2 (closes V4) = Chris's whole vault does, Obsidian optional. See [plans/slices.md](../plans/slices.md).

### Dual transport
The transition period where the same edits travel via both git and the relay, requiring a dedup rule so a git pull of already-relayed edits doesn't duplicate content (D2c, Spike S2).

### Durable ack
Confirmation that the relay has *fsynced* an update to persistent storage, not merely received it. The [sync pill](#sync-pill) shows green only on durable ack — the y-protocol has no per-update acks, so this needs a small protocol extension (Spike S4). See [primer 05](primers/05-sync-and-relay.md#sync-state-that-never-lies).

### Eg-walker
A 2025 algorithm (Gentle & Kleppmann) that keeps a document as plain text plus an event graph, engaging CRDT machinery only when concurrency must actually be merged. Intellectual support for files-first thinking; not something we run. See [file-crdt-reconciliation research](../plans/research/file-crdt-reconciliation.md).

### Engine seam
The thin interface in `libs/sync` that hides the CRDT engine; nothing outside `libs/sync` imports `yjs`. Exists for the v14 migration, the Loro hedge, and invariant-first testing. See [primer 04](primers/04-engine-seam.md).

### Enrolled file
A file that is shared (or multi-device) and therefore has an always-on local [Y.Doc](#ydoc), an [LCA](#lca-last-common-ancestor) record, and a [GUID binding](#guid-binding). Contrast [tracked file](#tracked-file); the dichotomy is strict — there is no dormant in-between mode (see [primer 03](primers/03-lca-reconciliation.md#the-iron-rule-and-the-bug-that-forged-it)).

### EOL/BOM flags
Per-file records (made at enrollment) of line-ending flavor and byte-order mark. Content is normalized to LF inside the CRDT and restored on write, so a CRLF file stays byte-stable on disk (R1.1).

### Epoch fencing
Preventing a stale client's replayed history from merging into a doc that was re-seeded after a relay restore — detecting "this is a different generation of the same doc". Undesigned; part of Spike S1.

### Folder doc
One Y.Doc per shared folder holding a CRDT map of vault-relative paths → doc GUIDs plus metadata. It propagates creates/renames/deletes and renders the file tree; it is *advisory*, never an auth source. See [primer 05](primers/05-sync-and-relay.md#sharing-per-note-and-per-folder).

### FTS5
SQLite's full-text search extension. **Not what V2 ships.** The index was
shaped as FTS5 (sqlite-wasm in the browser, rusqlite under Tauri), but measured
against the real vault — 1,029 notes / 3.0 MB, where an index build is a pure
CPU pass over text already resident in RAM and search answers in ~1 ms — the
5,000-doc premise did not hold. V2 ships `libs/index`: one swap-proof query
interface over an in-memory TypeScript backend. FTS5 returns behind a measured
trigger (>5k files, >20 MB, cold build >750 ms, or search p95 >50 ms). See
[`plans/v2-shaping.md`](../plans/v2-shaping.md) Fork 1.

### Fuzz-crashers
The `fuzz-crashers/` directory: every counterexample the fuzz harness ever finds is checked in as a permanent regression fixture (a habit borrowed from Automerge). See [collab-testing research](../plans/research/collab-testing.md).

### GUID binding
The association between a file's stable GUID and its current vault path, held in the [folder doc](#folder-doc)'s path-map and the durable store. Paths rename; GUIDs don't — so history survives reorganization.

### Heads
This repo's word for the complete position of a doc: **state vector + delete-set digest** (equivalently, a Yjs snapshot). Never compare state vectors alone — delete-only changes would be invisible. See [primer 01](primers/01-crdts-and-yjs.md#delete-sets--and-the-bug-class-heads--sv--ds-prevents).

### Hocuspocus
The maintained Node.js Yjs sync server we run as `apps/relay` (v4, thin, on Fly.io): standard y-protocol over WebSocket plus hooks where we add auth (shares table) and SQLite persistence. See [primer 05](primers/05-sync-and-relay.md#what-the-relay-runs).

### Keyhive
Ink & Switch's capability-based access control + E2EE system for CRDTs — pre-alpha, unaudited, Automerge-oriented. Watch-only (R8); we keep cheap compatibility levers (device-key identity, payload-opaque sync). See [keyhive research](../plans/research/keyhive.md).

### LCA (last common ancestor)
The per-file durable record of what disk and CRDT last agreed on — base text, content hash, EOL/BOM flags, CRDT [heads](#heads)/snapshot. The merge base that turns reconciliation into classification; it advances *only* atomically with a matching CRDT transaction. The core idea of [primer 03](primers/03-lca-reconciliation.md).

### Litestream
Continuous streaming replication of the relay's SQLite database to off-box storage, so losing the Fly volume doesn't lose persisted doc state.

### Mass-change breaker
The circuit breaker that pauses reconciliation when many files change near-simultaneously (a git branch switch, a bulk script) and asks for confirmation instead of auto-merging hundreds of files. See [primer 03](primers/03-lca-reconciliation.md#escalation-when-not-to-auto-merge).

### Materialization
Writing CRDT content out to the disk file (the top-right quadrant of the classification matrix) — always through the [pre-image journal](#pre-image-journal) and atomic temp→fsync→rename, never while the editor owns the file.

### MergeHSM
relay.md's hierarchical state machine for disk↔CRDT reconciliation — the production proof that the [shadow-copy](#shadow-copy)/LCA pattern works for an Obsidian vault. Our `reconciler` is our own design implementing the same proven invariants, not a port of their code. See [primer 03](primers/03-lca-reconciliation.md#invariants-the-reconciler-must-never-break).

### Model-based testing
Property testing where a simple model (here: a plain string) runs alongside the real system under generated command sequences, and divergence between them is a failure — with automatic shrinking to a minimal failing script (fast-check `fc.commands`). Layer 0 of the harness. See [collab-testing research](../plans/research/collab-testing.md).

### OPFS
Origin Private File System — the browser's private, worker-accessible file storage. Editor uses it for the browser vault tier (`OpfsVaultAdapter`) and for the durable store, behind a best-effort `navigator.storage.persist()`. It is browser-*evictable*, which is why the durable/droppable split exists at all (D5); the V2 index is in memory and simply rebuilds.

### Origin (transaction origin)
The tag on every CRDT transaction saying who wrote and why (`'editor'`, `'disk'`, `'remote'`, …). How observers suppress their own echoes — the reconciler ignores `'disk'`-origin updates when deciding whether to materialize. See [primer 01](primers/01-crdts-and-yjs.md#transactions-and-origins).

### Pre-image journal
A bounded-retention snapshot of a file's content taken before *every* Editor-initiated disk write, with `editor restore <file> <t>` to roll back — recoverability without depending on a git commit having happened (R1.3, D2a).

### Provider
The client-side connector between a local Y.Doc and a sync server: speaks the sync protocol, tracks connection state, reconnects with backoff. Ours is `syncProvider` (a Hocuspocus client per doc + folder doc). See [primer 05](primers/05-sync-and-relay.md).

### Quiesce
The watcher's settle rule: a file change is only classified after two consecutive reads return the same content hash, so partial writes and editor save-storms are never processed mid-flight. See [primer 03](primers/03-lca-reconciliation.md#escalation-when-not-to-auto-merge).

### Reconciler
The `libs/vault` service that keeps disk and CRDT truthful with each other: classifies changes against the [LCA](#lca-last-common-ancestor), ingests external edits via [dmp](#diff-match-patch-dmp), materializes CRDT state, and escalates true divergence to review. The subject of [primer 03](primers/03-lca-reconciliation.md).

### Relay
Our self-hosted rendezvous server (`apps/relay`, [Hocuspocus](#hocuspocus) on Fly.io): authenticates shares, persists updates, rebroadcasts them. A meeting point, not an authority — every device holds full state. See [primer 05](primers/05-sync-and-relay.md).

### relay.md
The Obsidian collaboration plugin (No-Instructions/Relay, MIT) whose architecture — Yjs per file, folder path-map doc, file-canonical reconciliation with an LCA — is our closest prior art and existence proof. We adopt its *patterns*, clean-room, not its code. See [relay-md research](../plans/research/relay-md.md).

### Shadow copy
The general pattern of keeping a private copy of "what we last synced" to diff and merge against — used by Dropbox-style syncers and every three-way file merger. Our [LCA](#lca-last-common-ancestor) is a shadow copy plus CRDT heads. See [primer 03](primers/03-lca-reconciliation.md#the-pattern-a-shadow-copy-as-merge-base).

### Single-seeder rule
Exactly one device inserts a folder's content at enrollment; every joiner pulls relay state instead, inserting only if a doc is verifiably empty. Prevents whole-document duplication (invariant 1); the full join state machine is Spike S1.

### Snapshot
In Yjs terms, the pair `{state vector, delete set}` — a complete description of a doc's position, stored in each LCA record. Interchangeable with [heads](#heads) in this repo's usage.

### Stale echo
An external write that re-asserts old content — typically another editor (Obsidian) autosaving a buffer from before remote edits arrived. Detected via a ring of recently-flushed content hashes; always escalates rather than auto-ingesting (D2d, Spike S6).

### State vector
A compact map of `clientID → highest op counter seen`; the "what have you seen?" half of the sync handshake. Insufficient alone for equality checks because deletes don't advance it — see [delete set](#delete-set) and [heads](#heads). See [primer 01](primers/01-crdts-and-yjs.md).

### Sync pill
The per-doc (plus quiet global rollup) status indicator, computed as a *pure function* of the sync record `{connected, pendingOps, diskMatchesCrdt, diverged, durableAck}`. Green requires [durable ack](#durable-ack); honesty under partition is harness-asserted (R2.3, D11). See [primer 05](primers/05-sync-and-relay.md#sync-state-that-never-lies).

### Three-way merge
Merging two changed versions through their common base so each side's changes are identified precisely — what [diff3](#diff3) does with the [LCA](#lca-last-common-ancestor) as base when both disk and CRDT moved. See [primer 03](primers/03-lca-reconciliation.md).

### Tracer bullet
The V1 slice: the thinnest end-to-end path through every risky layer — two Tauri clients co-editing a real vault subfolder through the relay, reconciler and harness included — proving the architecture before features. See [plans/slices.md](../plans/slices.md).

### Tracked file
A file Editor edits but that is never shared: no CRDT, no LCA, no GUID — just a plain file. Becomes [enrolled](#enrolled-file) only when sharing/multi-device requires it (D2).

### Transaction (Yjs)
The atomic unit of CRDT mutation; related edits bundled so observers and remote peers see them as one change, tagged with an [origin](#origin-transaction-origin). The LCA-advance rule is stated in terms of transactions: see [primer 03](primers/03-lca-reconciliation.md#the-iron-rule-and-the-bug-that-forged-it).

### Update (Yjs)
A binary blob of CRDT operations (including delete-set info) exchanged between replicas; idempotent and order-tolerant to apply, mergeable offline. What providers ship and the relay persists. See [primer 01](primers/01-crdts-and-yjs.md#updates).

### Vault
The existing directory tree of plain `.md` files (Chris's Obsidian vault) that remains the source of truth — co-edited by git, Claude Code, and Obsidian throughout (R1). Editor is a citizen of the vault, never its owner.

### Vendoring
Copying a dependency's source into our repo and owning it, rather than depending on upstream releases — applied to small frozen/dormant deps: y-codemirror.next, diff-match-patch, node-diff3 (Decision log: "vendor frozen deps, don't call them maintained").

### Y.Doc
Yjs's container for one collaborative document — the unit of sync, persistence, and connection. One per enrolled file, plus one [folder doc](#folder-doc) per shared folder. See [primer 01](primers/01-crdts-and-yjs.md#ydoc-and-ytext).

### Y.Text
The shared sequence type inside a Y.Doc holding, in our case, the literal markdown characters of one file (key `"contents"`). Why plain text rather than a rich-text tree: [primer 02](primers/02-plain-text-crdt-over-markdown.md).

### y-codemirror.next
The Yjs↔CodeMirror 6 collab binding (cursors, edit relay between Y.Text and the editor). Vendored; the one acknowledged engine-coupled component, kept with the engine code. See [primer 04](primers/04-engine-seam.md#the-acknowledged-seam-crossing-the-editor-binding).

### y-indexeddb
Stock browser-side persistence for Y.Docs, used for V1 CRDT logs with a hard exit trigger (migrate to a durable doc store before teammate onboarding) because browser storage is evictable (D5).

### Yjs
The CRDT engine (v13.6.x, pinned, MIT) behind the [engine seam](#engine-seam) — chosen for ecosystem maturity, tiny pure-JS runtime, and relay.md's production precedent. See [primer 01](primers/01-crdts-and-yjs.md) and [crdt-engine research](../plans/research/crdt-engine.md).

### Derived index
`libs/index` — full text, links, tags, headings and frontmatter keys, all
derived from note text. **Never a system of record** (golden rule 8): losing it
costs a rebuild, never data. One writer path feeds it, every query is
Promise-returning and paged, and a backend conformance suite defines what any
replacement must do. See [`plans/v2-shaping.md`](../plans/v2-shaping.md) Fork 1.

### Design token
A named CSS custom property that every surface reads instead of a literal
colour, so a theme change is a token change in one place. Editor has three
bands: DaisyUI's semantic chrome tokens, our `--ed-*` editor tokens, and the
unlayered `--ed-sync-*` honesty tokens (golden rule 7). See
[theming.md](theming.md).

### `data-theme`
The attribute on `<html>` that selects a theme. Set synchronously before first
paint by an inline script in `index.html`, so there is no flash; `system`
resolves to a built-in rather than being written as a value.

### Wikilink
`[[Target]]`, `[[Target|alias]]`, `[[Target#anchor]]` — the vault's own
navigation structure (949 occurrences across 29% of the real vault). Parsed by
a `MarkdownConfig` on upstream `@codemirror/lang-markdown` in
`libs/editor-lang`, deliberately *not* a fork of the Obsidian grammar. A target
that resolves to nothing is styled differently on purpose: 12% of this vault's
targets are notes the author meant to write.
