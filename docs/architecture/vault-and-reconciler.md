---
status: V1 design — update as built
date: 2026-10-04
---

# Vault and reconciler — V1 dataflow

`libs/vault` is the bridge between the canonical world (plain `.md` files on disk, also
written by git, Claude Code, and Obsidian) and the CRDT world (always-on Y.Docs for
enrolled files, reached only through the `libs/sync` seam). This doc covers the watcher,
the reconciler's classification matrix, the LCA store, enrollment, escalation, and
recovery. Ground truth: shaping **D2, D2a, D2b, D2d, D2f** and the V1 non-UI affordances
in [plans/slices.md](../../plans/slices.md). Background reading: the
[LCA reconciliation primer](../primers/03-lca-reconciliation.md).

Design lineage note: the reconciler is our own design implementing the general
LCA/shadow-copy pattern (keep a durable record of the last state both sides agreed on;
classify changes by diffing each side against it). It is informed by published
post-mortems of the alternatives — overwrite-on-load anti-patterns, LCA-bump-without-
ingest data loss (shaping decision log) — not by any external implementation's source.

## Watcher

`TauriVaultAdapter` (Tauri's native `watchImmediate`) emits raw FS events, which are
useless as-is: editors write via temp+rename, git touches hundreds of files per branch
switch, and a single save can produce several events. The adapter layer normalizes:

- **Content-hash change detection.** An event only becomes a reconciler input if the
  file's content hash actually differs from the last known hash. Timestamp churn,
  metadata-only writes, and our own just-flushed writes (hash matches what we wrote)
  are dropped.
- **Quiesce = double-read-same-hash.** A changed file is read, hashed, and re-read
  after a short injected-clock delay; only when two consecutive reads hash identically
  is the content considered settled and handed to the reconciler. This is the defense
  against partial writes from non-atomic external writers.
- **Ignore list:** `libs/vault`'s `IGNORED_DIRS` — `.git/`, `.obsidian/`, `.ohhi/`, `.ohhi-cache/`, `.trash/`, `node_modules/`, plus the pre-rename `.editor/` and `.editor-cache/`.

## The reconciler: classification matrix

For each enrolled file the durable **LCA record** captures the last state where disk and
CRDT provably agreed. On every settled watcher event (and on every CRDT advance for a
closed file), the reconciler asks two independent questions: *did disk move since the
LCA?* (compare content hash) and *did the CRDT move since the LCA?* (compare heads
against the stored snapshot).

| Disk moved? | CRDT moved? | Classification | Action |
|---|---|---|---|
| no | no | In sync | No-op. Running the reconciler over a settled state must change nothing (idempotence — a blocking L1 invariant). |
| yes | no | **External-only** | diff-match-patch the LCA `baseText` → new disk text; apply the resulting span edits to the Y.Text as one transaction of CRDT ops tagged **origin `'disk'`**; advance the LCA in that same transaction. External edits become first-class ops other replicas merge normally. |
| no | yes | **CRDT-advanced** | Materialize the Y.Text to disk: restore the recorded EOL flavor/BOM, snapshot the current file into the pre-image journal, then write via atomic temp → fsync(temp) → rename; advance the LCA with the write. |
| yes | yes | **Diverged** (true three-way) | Set the `diverged` flag on the doc's `syncRecord`; surface diff3 hunks (base = LCA `baseText`) in the crude review UI with keep-mine / keep-theirs / accept-merge per hunk. **Never auto-write disk while unresolved.** CRDT sync continues; the disk file is simply not touched until a human resolves. |

```mermaid
flowchart TD
    EV[Settled watcher event / CRDT advance for closed file] --> D{disk hash == LCA contentHash?}
    D -- yes --> C1{CRDT heads == LCA snapshot?}
    D -- no --> C2{CRDT heads == LCA snapshot?}
    C1 -- yes --> NOP["No-op (idempotent)"]
    C1 -- no --> MAT["Materialize CRDT → disk<br/>pre-image journal + temp-fsync-rename<br/>LCA advances with the write"]
    C2 -- yes --> ESC{Escalation threshold tripped?}
    C2 -- no --> DIV["diverged := true<br/>diff3 hunk review<br/>no disk writes until resolved"]
    ESC -- no --> ING["dmp diff vs baseText → Y.Text ops, origin 'disk'<br/>LCA advances in the same transaction"]
    ESC -- yes --> DIV
```

Origin tags matter downstream: the editor binding ignores its own echoes, the sync layer
can distinguish disk-ingested ops in telemetry, and L1 fixtures assert that origin
`'disk'` transactions never loop back out as spurious disk writes.

## Editor ownership: the open set

`ReconcileContext.openPaths` is the one input that suppresses a row of the matrix: while
a path is in it, the *CRDT-advanced* case noops (`reconciler.ts`) and the editor's own
debounced flush is the single writer for that file. The set is a **set of open paths per
mount**, not one path: since tab groups, N panes can hold N notes and two panes can hold
the same one (spike S9). `MountSession.setOpenPaths(rels)` takes the whole set each time
and diffs it — a path that entered runs `VaultSession.markOpen`, a path that left has its
pending flush debounce cancelled and runs `reconcileClosedDoc` (`markClosed` → reconcile).
The **last-view rule** falls out of that: two views over one note collapse to one member,
so nothing closes while any view still holds it, and the last view to leave is the one
that closes the doc and flushes its bytes. The refcount itself lives in the shell
(`apps/web/src/lib/workspace.svelte.ts`, `setLiveViews`), which derives it from the pane
tree and hands each mount its own slice; the reconciler, `MountSession` and the pane model
each know only their own half. Ownership is rekeyed, never dropped, by a rename
(`onPathsRenamed` maps the set prefix-wise), is released by a delete before the bytes go,
and is re-marked after a session restart — the L1 fixture
`libs/workspace/test/multi-view-lifecycle.test.ts` asserts all four, plus "no edit lost"
and "no open doc materialized over", for every open/close/rename/delete/unshare ordering.

A path can also enter the open set **before its doc exists** (a tab opened on a note a
peer is about to announce, or one being created): `markOpen` has nothing to name yet, so
the mark is retried from `refreshFiles` — the one path every map change takes — rather
than skipped for the life of the session.

**Mount surgery is the hard case**, because it destroys and replaces the sessions
underneath live views. Carve, unshare, unmount and the pull branch of `activateMount` all
follow one shape in the shell: `dropLiveViewsUnder(prefix)` **returns** the paths it
released, the surgery runs, and `reapplyLiveViews(held)` re-tells every mount — the
replacements included, whose open sets start empty. Dropping without re-applying leaves a
pane rendering a buffer the vault believes is closed, which is the reconciler free to
materialize over it (golden rule 1); the facade's `workspace-live-views.test.ts` is the
guard. A session already out of the registry is never spoken to again. While any of those
surgeries is in flight the shell sees `ui.settling === true` — `ui.files` is a partial
picture mid-surgery, so anything that *deletes* state derived from it (the tab prune)
waits for it to go false.

## The LCA record and the iron rule

One record per enrolled file, in `lcaStore` — the **durable** app-data store
(one small atomic JSON file per record, `<room>/lca/<guid>.json`, so a put
costs one record and not a rewrite of the whole shadow corpus — spike S10-Q4;
a pre-S10 `<room>/lca.json` is split in on first open. SQLite behind the same
interface if it is ever needed)
(shaping D5b): never the droppable index, never browser-evictable storage. Losing an LCA
record silently degrades every future merge of that file, so it is treated as
never-droppable state alongside the pre-image journal.

```
{ guid,          // stable doc identity (survives renames; path is just a binding)
  path,          // current path binding within the folder
  baseText,      // the agreed text at the LCA — the diff3/dmp base
  contentHash,   // hash of the exact bytes on disk at the LCA (post-EOL-restore)
  snapshot,      // CRDT heads at the LCA: state vector + delete-set digest (D1)
  eolFlavor,     // recorded at enrollment; text is normalized in-CRDT, restored on write
  bom }          // byte-order mark presence, same treatment
```

*(Assumption, consistent with D2/D5: `baseText` is stored directly for cheap diff3 even
though it is in principle re-derivable from the snapshot; slices lists the same record
with `stateVector+deleteDigest` spelled out — that pair is what `snapshot` means here.)*

**The iron rule: the LCA advances only in the same transaction as the CRDT ingestion or
materialization it describes.** Never on a timer, never on "looks equal", never as a
standalone bump. An LCA bump without a matching CRDT transaction *is* the data-loss bug
that killed the dormant-mode designs (shaping decision log, Offline/collab seam): once
disk == LCA with the CRDT left behind, the next reconcile classifies real offline work
as "only remote moved" and overwrites it.

## Enrollment

`enrollmentService` runs on first open of a shared folder (shaping D2b, slices wiring):

1. Walk the folder; for each text file, **mint a GUID** and record `path → guid` in the
   **folder Y.Doc** (the shared path map; advisory metadata, never an auth source).
2. **Seed once**: insert the file's content into a fresh Y.Text exactly one time, then
   write the initial LCA record in the same breath. A one-time-insertion guard makes
   re-running enrollment a no-op — content insertion must never repeat (MergeHSM-style
   invariant 1: no delete-all-and-reinsert, ever).
3. **Single-seeder rule for joiners** (V1): only the first device seeds. A device
   joining via share token pulls relay state into a clean or identical folder and
   inserts content only if the doc is verifiably empty. The full join/re-seed state
   machine (epoch fencing after relay restore, the git-clone-already-present case,
   tombstoned-GUID drains) is **Spike S1** — V1 simply forbids the ambiguous paths.
4. **Binary detection** → exclude from enrollment entirely + "not synced" badge in the
   tree (shaping D2f). V2 brings content-addressed blob sync; V1 just refuses to lie.

Create/rename/delete flow through the folder doc both directions: a local rename updates
the path binding (same GUID — content history survives renames); a remote map change
renames on disk through the same journaled, atomic write path.

**Mount entries** (N1, device-link-shaping A2): a fourth entry kind, `mount`, marks a
subtree that has become its own room — `{kind:'mount', guid:<room>, relay:<url>}` at the
mount root, written in the *same* transaction that removes the subtree's keys. It is a
boundary, not a file: enrollment, the delta scan and the reconciler never look at or
under it, because those paths belong to another mount session on this device. It is also
the announcement channel — a peer of the parent room learns from that one entry that the
subtree moved, and adopts it (spike S10 Q1). Advisory as ever: the entry carries the
room and the relay, never a token.

## Escalation thresholds

Auto-ingest is for routine external edits. The reconciler escalates to review — same
`diverged` affordance, even when only one side moved — when a merge is *technically*
possible but *suspicious* (shaping D2, D2d):

- **Size/ratio threshold:** an external diff that rewrites too much of the file (large
  absolute churn or high changed-to-total ratio) is not silently merged.
- **Revert-of-recently-flushed:** an external write that reverts spans Editor recently
  flushed escalates instead of ingesting — the stale-editor-buffer signature (Obsidian's
  autosave echoing old content). A small ring of recently-flushed content hashes backs
  the check; its sufficiency against Obsidian's real autosave loop is **Spike S6**.
- **Mass-change circuit breaker:** many files changing within one quiesce window (a git
  branch switch, `git checkout .`) pauses reconciliation folder-wide and asks for
  confirmation rather than ingesting a storm of "external edits".

Thresholds are pure, clock-injected functions — unit-tested directly, with interleaving
explored by the L1 fuzzer ([testing.md](testing.md)).

## Recovery story

Two independent safety nets, because the reconciler is the highest-blast-radius code in
the system (shaping D2a; requirement R1.3):

- **Pre-image journal** (`preImageJournal`): before *every* Editor-initiated disk write,
  the file's current content is snapshotted into the durable store, with bounded
  retention (20 per path). Each entry carries a `seq` — a stable id within the journal,
  because a coarse clock stamps two records of one path identically. Recovery from a
  reconciler bug must not depend on a git commit having happened. The shipped
  affordances are the dock's History tab (floating, or the rail column when
  pinned) and, from a terminal, `ohhi restore`.

  The journal is keyed by **path**, so every rename carries it: `renameFile`,
  `renameDir` (prefix-wise, one call for the whole subtree) and the remote-rename
  branch of `onRemoteMapChange` all call `PreImageJournal.rename(from, to)`. Without
  it a rename silently ended a note's recoverable history — the pre-images stayed in
  the store under a name nothing would ever ask for. `FileJournal` copies each entry
  to its new name before removing the old one, so a crash mid-rename can only leave a
  visible duplicate, never a lost version.

  Listing is metadata-only: `list(path)` answers `{ seq, path, at, size }` per entry
  **without reading any pre-image back**, because the size travels in the entry's file
  name (`journal/<seq>.<at>.<size>-<encoded path>.bin`). The History rail re-lists on
  every flush, and reading the bytes to measure them made a sidebar read a note's whole
  retention window. `entries()`/`latest()` still hand the bytes over, for the restore
  that actually asks. Two older name layouts (`<seq>.<at>-…`, and pre-S10 `<seq>-…`
  dated from a surviving `index.json`) still read; only those cost a read to size.

  **Restoring one** (`VaultSession.restoreFile`, surfaced as the History section in
  W3 and reachable from `MountSession.fileHistory` / `restorePreImage`) does *not* write
  the bytes back: it **flushes the live doc first**, then decodes the pre-image to text,
  applies it to the CRDT as a minimal diff and materializes, exactly as a divergence
  resolution does. So peers see an ordinary edit rather than a file that changed under
  them, the file's own EOL/BOM flavour is preserved, the bytes being replaced are
  themselves journaled (a restore is undoable), and the only disk write is the atomic
  one inside `materialize` — golden rule 1 holds without a second write path existing.

  The flush is what makes that promise true for an OPEN note: the journal records what
  is on *disk*, and while a view holds a note disk lags the editor by the flush
  debounce, so a sentence typed just before Restore would otherwise be deleted by the
  diff while being in no journal entry, no LCA, and (its ops carrying origin `disk`)
  out of the UndoManager's reach. A restore also **clears any pending review** for the
  note: the bytes put back are the answer to the divergence, and a modal left open over
  them would be a sync state that lies (golden rule 4). `MountSession.restorePreImage`
  **rejects** on failure rather than swallowing into a notice, so the confirm dialog
  can stay open and say what went wrong instead of closing as though it had worked.
- **Post-session git audit**: after any real-vault session, a `git diff --stat` audit
  script verifies only intended changes touched disk — no churn diffs, no EOL flips, no
  frontmatter reserialization (golden rule: never reserialize what you didn't change;
  byte fidelity is also a blocking L1 invariant).

V1 precondition (slices): no real-vault session until the test subfolder is committed
clean, the durable LCA store and pre-image journal exist, and the audit script is wired.

## See also

- [overview.md](overview.md) — where `libs/vault` sits; dependency rules (vault never
  imports editor, talks CRDT only through the seam).
- [sync.md](sync.md) — the other half: doc lifecycle, offline behavior, `syncRecord`.
- [testing.md](testing.md) — L1 reconciler fuzz, blocking invariants, `fuzz-crashers/`.
- Primers: [03-lca-reconciliation](../primers/03-lca-reconciliation.md),
  [02-plain-text-crdt-over-markdown](../primers/02-plain-text-crdt-over-markdown.md).
- Plans: [shaping.md](../../plans/shaping.md) D2/D2a–D2f, Spikes S1/S2/S3/S6;
  [slices.md](../../plans/slices.md) V1 non-UI affordances.
