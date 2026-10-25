/**
 * VaultSession: orchestrates one enrolled folder — watcher events in,
 * reconciliation actions out, folder-map changes in both directions,
 * divergence reviews and the mass-change breaker surfaced as events.
 * All timing goes through the injected Clock (golden rule 5).
 */
import type { EngineDoc, FileEntry, SyncEngine } from '@ohhi/sync'
import {
  reconcileFile,
  resolveDivergence,
  type ReconcileContext,
} from './reconciler.js'
import { decodeFile, renderFile } from './eol.js'
import { hashBytes } from './hash.js'
import { isScratchName, NEVER_ON_DISK } from './enrollment.js'
import { mountRootsFrom } from './mounts-file.js'
import {
  DEFAULT_THRESHOLDS,
  type DivergenceReview,
  type LcaStore,
  type PreImageJournal,
  type ReconcileThresholds,
  type VaultAdapter,
  type WatchEvent,
} from './types.js'

export interface Clock {
  now(): number
  schedule(fn: () => void, ms: number): () => void
}

export interface SessionEvents {
  onReview?: (review: DivergenceReview) => void
  onReviewCleared?: (guid: string) => void
  onBreaker?: (paths: string[]) => void
  /** Fired after any reconcile that changed disk or CRDT state. */
  onActivity?: (guid: string, action: string) => void
  /**
   * Paths changed identity (local or remote rename/move, incl. every child of
   * a directory move). Hosts MUST re-key any per-path state they hold — sync
   * records especially: providers mutate the record OBJECT, so moving it under
   * the new key keeps live state flowing (M3).
   */
  onPathsRenamed?: (moves: { from: string; to: string }[]) => void
  onError?: (err: unknown) => void
}

/**
 * Live enrol-on-create (`agent-surface-shaping`: agents are first-class
 * writers): the host's answer to a watch event naming paths this session does
 * not know. The session never enrols on its own — it holds no enrolment
 * policy (ignore set, mount table, binary rule); the host applies the boot
 * scan's rules and the session counts the result toward the breaker.
 */
export interface LiveEnroller {
  /**
   * The files the host would enrol for these unknown watch paths: a file
   * path itself, or every file under a directory path (a populated folder
   * moved in arrives as ONE event). Paths the boot scan would skip are
   * left out.
   */
  candidates(paths: readonly string[]): Promise<string[]>
  /**
   * Enrol them (map entry, doc, LCA). On return the folder map holds each
   * enrolled path; the session then tracks it like one it started with.
   */
  enrol(paths: readonly string[]): Promise<void>
  /**
   * Paths the host keeps off live enrolment whatever the listing says — its
   * own writes in flight, for one. Synchronous, so a watch event naming only
   * such paths never costs a listing.
   */
  ignores?(path: string): boolean
}

export interface VaultSessionOptions {
  engine: SyncEngine
  adapter: VaultAdapter
  lcaStore: LcaStore
  journal: PreImageJournal
  clock: Clock
  folderDoc: EngineDoc
  docs: Map<string, EngineDoc>
  thresholds?: Partial<ReconcileThresholds>
  events?: SessionEvents
  /** Quiesce delay between double reads, ms. */
  quiesceMs?: number
  /** Without one, out-of-map paths are ignored until the next boot scan. */
  enroller?: LiveEnroller
}

export class VaultSession {
  private readonly engine: SyncEngine
  private readonly adapter: VaultAdapter
  private readonly lcaStore: LcaStore
  private readonly clock: Clock
  private readonly folderDoc: EngineDoc
  private readonly docs: Map<string, EngineDoc>
  private readonly events: SessionEvents
  private readonly quiesceMs: number
  private readonly ctx: ReconcileContext
  private readonly enroller: LiveEnroller | null

  private pathToGuid = new Map<string, string>()
  private lastEntries = new Map<string, FileEntry>()
  /**
   * Mount roots declared IN THIS MAP (`kind:'mount'` entries, slice N1). Each
   * is an opaque boundary: the subtree at or under it belongs to another
   * session on this device, so this session never reconciles, materializes,
   * mkdirs, removes or re-enrolls anything there. Recomputed on every map
   * change — including our own — so it is never stale.
   */
  private mountRoots: ReadonlySet<string> = new Set()
  private reviews = new Map<string, DivergenceReview>()
  private subscriptions: (() => void)[] = []
  private paused = false
  private queuedPaths = new Set<string>()
  /** New files held with a tripped breaker: enrolled on confirm, dropped on dismiss. */
  private queuedNew = new Set<string>()
  /**
   * Watch batches waiting on the enroller's listing, in arrival order. A
   * batch with nothing unknown to the map runs at once and never waits here
   * (the common case stays synchronous, and an outside edit to a known note
   * is not held behind someone else's listing); one with unknown paths
   * queues, so new-file batches never reorder among themselves.
   */
  private watchChain: Promise<void> = Promise.resolve()
  private watchPending = 0
  private reconcileScheduled = new Set<string>()
  private docQueues = new Map<string, Promise<unknown>>()
  private disposed = false

  constructor(opts: VaultSessionOptions) {
    this.engine = opts.engine
    this.adapter = opts.adapter
    this.lcaStore = opts.lcaStore
    this.clock = opts.clock
    this.folderDoc = opts.folderDoc
    this.docs = opts.docs
    this.events = opts.events ?? {}
    this.quiesceMs = opts.quiesceMs ?? 30
    this.enroller = opts.enroller ?? null
    this.ctx = {
      engine: opts.engine,
      adapter: opts.adapter,
      lcaStore: opts.lcaStore,
      journal: opts.journal,
      thresholds: { ...DEFAULT_THRESHOLDS, ...opts.thresholds },
      recentFlushes: new Map(),
      openPaths: new Set(),
    }
  }

  async start(): Promise<void> {
    this.refreshMountRoots()
    for (const [path, entry] of this.folderDoc.getMap().entries()) {
      this.lastEntries.set(path, entry)
      if (entry.kind === 'text' && !entry.deleted && !this.underMount(path)) {
        this.pathToGuid.set(path, entry.guid)
      }
    }
    this.subscriptions.push(
      this.adapter.watch(
        (ev) => this.onWatch(ev),
        (err) => {
          if (!this.disposed) this.events.onError?.(err)
        }
      )
    )
    this.subscriptions.push(
      this.folderDoc.getMap().observe((origin) => {
        this.refreshMountRoots()
        if (isForeignOrigin(origin)) void this.onRemoteMapChange()
      })
    )
    for (const [guid, doc] of this.docs) this.subscribeDoc(guid, doc)
  }

  private refreshMountRoots(): void {
    // The MAP term alone, deliberately. `mountRootsFrom` takes descs too, and
    // a host that has them passes both — but a VaultSession is given one
    // folder doc and no mount table, and the two terms answer different
    // questions here. mounts.json says which mounts this DEVICE runs; the map
    // says which boundaries THIS ROOM declares, which is exactly the set of
    // paths this session must not touch. A desc for a mount in another room
    // is none of this session's business, and a mount root the map does not
    // declare is not a boundary in the map this session is reading.
    this.mountRoots = mountRootsFrom([], this.folderDoc.getMap().entries())
  }

  /** Is `path` at or under a `kind:'mount'` boundary in this map? */
  private underMount(path: string): boolean {
    for (const root of this.mountRoots) {
      if (path === root || path.startsWith(`${root}/`)) return true
    }
    return false
  }

  /** Does the subtree at `dir` contain a mount boundary? */
  private containsMount(dir: string): boolean {
    for (const root of this.mountRoots) {
      if (root === dir || root.startsWith(`${dir}/`)) return true
    }
    return false
  }

  private subscribeDoc(guid: string, doc: EngineDoc): void {
    this.subscriptions.push(
      this.engine.onUpdate(doc, (_update, origin) => {
        if (isForeignOrigin(origin)) this.scheduleReconcile(guid)
      })
    )
  }

  /** Editor lifecycle: while open, the editor owns the file (no materialize). */
  markOpen(guid: string): void {
    const path = this.pathOf(guid)
    if (path) this.ctx.openPaths.add(path)
  }

  async markClosed(guid: string): Promise<void> {
    const path = this.pathOf(guid)
    if (path) this.ctx.openPaths.delete(path)
    await this.reconcile(guid)
  }

  /** Debounced flush-on-idle entry point; safe for open and closed docs. */
  async flush(guid: string): Promise<void> {
    const path = this.pathOf(guid)
    if (!path) return
    // The open-path suspension brackets exactly THIS flush's own turn in the
    // per-doc queue — not the wait for predecessors — so a queued-ahead
    // reconcile still respects editor ownership.
    await this.runExclusive(guid, async () => {
      const wasOpen = this.ctx.openPaths.delete(path)
      try {
        await this.reconcileNow(guid)
      } finally {
        if (wasOpen) this.ctx.openPaths.add(path)
      }
    })
  }

  pendingReviews(): DivergenceReview[] {
    return [...this.reviews.values()]
  }

  async resolveReview(guid: string, mergedText: string): Promise<void> {
    await this.runExclusive(guid, async () => {
      const lca = await this.lcaStore.get(guid)
      const doc = this.docs.get(guid)
      if (!lca || !doc) throw new Error(`resolveReview: unknown doc ${guid}`)
      await resolveDivergence(this.ctx, doc, lca, mergedText)
    })
    this.reviews.delete(guid)
    this.events.onReviewCleared?.(guid)
  }

  /**
   * Resolve a 'vanished' review (file gone from disk with no map tombstone —
   * an external deletion). 'restore' materializes the CRDT content back onto
   * disk; 'remove' accepts the deletion for everyone: the LCA shadow text is
   * journaled for recoverability, the map entry is tombstoned (peers remove
   * their copies through the normal remote-delete path), and the LCA is
   * dropped. (M5, spike S8 Q5.)
   */
  async resolveVanished(guid: string, action: 'restore' | 'remove'): Promise<void> {
    await this.runExclusive(guid, async () => {
      const lca = await this.lcaStore.get(guid)
      const doc = this.docs.get(guid)
      if (!lca || !doc) throw new Error(`resolveVanished: unknown doc ${guid}`)
      if (action === 'restore') {
        await resolveDivergence(this.ctx, doc, lca, doc.getText())
      } else {
        await this.ctx.journal.record(lca.path, renderFile(lca.baseText, lca.eol, lca.bom))
        const entry = this.folderDoc.getMap().get(lca.path)
        if (entry && !entry.deleted) {
          const tomb = { ...entry, deleted: true }
          this.folderDoc.transactMap((m) => m.set(lca.path, tomb), 'local')
          this.lastEntries.set(lca.path, tomb)
        }
        this.pathToGuid.delete(lca.path)
        this.ctx.openPaths.delete(lca.path)
        await this.lcaStore.remove(guid)
      }
    })
    this.reviews.delete(guid)
    this.events.onReviewCleared?.(guid)
  }

  /**
   * Restore a journaled pre-image over `path` (History rail section, W3).
   *
   * The pre-image's TEXT is applied to the CRDT as a minimal diff and then
   * materialized — the same route a divergence resolution takes — rather than
   * written to disk directly. That matters three ways: peers see an ordinary
   * edit instead of a file that changed under them, the bytes currently on
   * disk are journaled first (so a restore is itself undoable from the same
   * list), and the only disk write is the atomic one inside `materialize`
   * (golden rule 1). Text-only by construction: a path with no doc — a binary,
   * a deleted note — has nothing to apply the diff to, and says so.
   */
  async restoreFile(path: string, bytes: Uint8Array): Promise<void> {
    const guid = this.pathToGuid.get(path)
    if (!guid) throw new Error(`restoreFile: '${path}' is not a live note in this vault`)
    await this.runExclusive(guid, async () => {
      const doc = this.docs.get(guid)
      if (!doc) throw new Error(`restoreFile: unknown doc ${guid}`)
      // FLUSH FIRST (M9). `resolveDivergence` journals what is ON DISK and
      // diffs from the LCA, and for an open note disk lags the editor by the
      // flush debounce: without this, a sentence typed in the last 800 ms is
      // deleted by the restore, is in no journal entry and no LCA, and — its
      // ops carrying origin 'disk' — is out of the UndoManager's reach.
      // Inlined rather than `this.flush(guid)` because `runExclusive` is not
      // re-entrant; it is the same suspend/reconcile/restore turn that flush
      // runs, and the LCA is re-read after it because it just moved.
      const wasOpen = this.ctx.openPaths.delete(path)
      try {
        await this.reconcileNow(guid)
      } finally {
        if (wasOpen) this.ctx.openPaths.add(path)
      }
      const lca = await this.lcaStore.get(guid)
      if (!lca) throw new Error(`restoreFile: unknown doc ${guid}`)
      // The pre-image carries its own EOL/BOM; the LCA's flavour is what the
      // file is written back with, so decode to text and let materialize
      // render it. Restoring must not flip a CRLF file to LF behind the user.
      await resolveDivergence(this.ctx, doc, lca, decodeFile(bytes).text)
    })
    // A restore RESOLVES the note: any review raised for it (including one
    // the flush above just raised) is answered by the bytes we put back, and
    // leaving it pending would keep a modal open over a file that is now what
    // the person asked for — the same ending `resolveReview`/`resolveVanished`
    // give (M9b).
    this.reviews.delete(guid)
    this.events.onReviewCleared?.(guid)
  }

  /** Mass-change breaker confirmation: process everything queued. */
  async confirmPendingBatch(): Promise<void> {
    this.paused = false
    const paths = [...this.queuedPaths]
    const fresh = [...this.queuedNew]
    this.queuedPaths.clear()
    this.queuedNew.clear()
    if (fresh.length > 0) await this.enrolLive(fresh)
    for (const path of paths) await this.reconcilePath(path)
  }

  /** Drop the held batch: the known paths go unreconciled, the new files wait for the next boot scan. */
  dismissPendingBatch(): void {
    this.paused = false
    this.queuedPaths.clear()
    this.queuedNew.clear()
  }

  dispose(): void {
    this.disposed = true
    for (const off of this.subscriptions) off()
    this.subscriptions = []
  }

  // ---- internals ----

  private pathOf(guid: string): string | null {
    for (const [path, g] of this.pathToGuid) if (g === guid) return path
    return null
  }

  private onWatch(ev: WatchEvent): void {
    // A mount boundary is out of scope even when the host's ignore set has not
    // caught up yet (a peer sees the mount entry before it has a desc): the
    // subtree is another session's business, never ours (N1, shaping A2).
    const paths = ev.paths.filter((p) => !this.underMount(p))
    if (paths.length === 0) return
    const known = paths.filter((p) => this.pathToGuid.has(p))
    // Unknown means unknown to the folder MAP, in any kind: an attachment, a
    // folder or a note the map already holds needs no listing — only a path
    // nobody has enrolled can be a new file (or a folder of them).
    const map = this.folderDoc.getMap()
    const enroller = this.enroller
    const unknown = enroller
      ? paths.filter((p) => {
          if (this.pathToGuid.has(p)) return false
          const entry = map.get(p)
          if (entry && !entry.deleted) return false
          // Another tool's swap, partial or backup file is never a new note.
          return !isScratchName(p) && !enroller.ignores?.(p)
        })
      : []
    if (unknown.length === 0) {
      // Nothing to list: handled at once, never queued behind a listing.
      void this.handleWatch(known, []).catch((err) => this.events.onError?.(err))
      return
    }
    this.watchPending++
    this.watchChain = this.watchChain
      .then(async () => {
        const fresh = await enroller!.candidates(unknown)
        if (this.disposed) return
        // Re-split: a batch queued behind an enrolment may name a path that
        // enrolment just made known.
        const nowKnown = paths.filter((p) => this.pathToGuid.has(p))
        await this.handleWatch(nowKnown, fresh.filter((p) => !this.pathToGuid.has(p)))
      })
      .catch((err) => this.events.onError?.(err))
      .finally(() => {
        this.watchPending--
      })
  }

  /**
   * One watch batch, split: `known` paths are reconciled, `fresh` files are
   * enrolled. The breaker counts both — an agent's 21 new notes are as much a
   * mass change as a branch switch rewriting 21 old ones.
   */
  private async handleWatch(known: string[], fresh: string[]): Promise<void> {
    if (known.length + fresh.length > this.ctx.thresholds.massChangePaths) {
      this.paused = true
      for (const p of known) this.queuedPaths.add(p)
      for (const p of fresh) this.queuedNew.add(p)
      this.events.onBreaker?.([...known, ...fresh])
      return
    }
    if (this.paused) {
      for (const p of known) this.queuedPaths.add(p)
      for (const p of fresh) this.queuedNew.add(p)
      return
    }
    // A new file is quiesced like a known one before it is enrolled: a writer
    // that is not atomic must not have its first half synced to every peer.
    if (fresh.length > 0) this.quiesceThenEnrol(fresh)
    // Only a tracked note has anything to reconcile: a path the map holds as
    // an attachment or a folder, or one that is neither known nor a candidate
    // (a deletion of a file we never knew), is nothing to read.
    for (const path of known) this.quiesceThenReconcile(path)
  }

  /**
   * Hand new files to the host's enroller, then track what it put in the map —
   * the per-path half of `start()`, so no restart (and no lost open-path
   * marks) is needed for a file that appeared while the session ran.
   */
  private async enrolLive(paths: string[]): Promise<void> {
    if (!this.enroller || this.disposed) return
    await this.enroller.enrol(paths)
    if (this.disposed) return
    for (const path of paths) {
      const entry = this.folderDoc.getMap().get(path)
      if (!entry || entry.deleted || this.underMount(path)) continue
      this.lastEntries.set(path, entry)
      if (entry.kind !== 'text' || this.pathToGuid.has(path)) continue
      const doc = this.docs.get(entry.guid)
      if (!doc) continue
      this.pathToGuid.set(path, entry.guid)
      this.subscribeDoc(entry.guid, doc)
      // A write that landed while the file was being enrolled named a path
      // nobody tracked yet: one reconcile catches the doc up with the disk
      // (a no-op when the bytes are the ones enrolled).
      void this.reconcilePath(path).catch((err) => this.events.onError?.(err))
    }
  }

  /**
   * The double-read-same-hash quiesce for files that are not enrolled yet:
   * read each, wait, read again; a file whose bytes held still is enrolled, a
   * file still being written is tried again, and one that vanished in the
   * meantime (a temp file renamed away, a download cancelled) is dropped.
   */
  private quiesceThenEnrol(paths: string[]): void {
    const hashOf = (b: Uint8Array | null): string | null => (b ? hashBytes(b) : null)
    void (async () => {
      const first = await Promise.all(paths.map(async (p) => hashOf(await this.adapter.read(p))))
      await new Promise<void>((resolve) => this.clock.schedule(resolve, this.quiesceMs))
      const second = await Promise.all(paths.map(async (p) => hashOf(await this.adapter.read(p))))
      const still: string[] = []
      const moving: string[] = []
      paths.forEach((p, i) => {
        if (first[i] === null || second[i] === null) return
        if (first[i] === second[i]) still.push(p)
        else moving.push(p)
      })
      if (still.length > 0) await this.enrolLive(still)
      if (moving.length > 0) this.quiesceThenEnrol(moving)
    })().catch((err) => this.events.onError?.(err))
  }

  /** Double-read-same-hash quiesce before acting on a watch event. */
  private quiesceThenReconcile(path: string): void {
    void this.adapter
      .read(path)
      .then((first) => {
        const firstHash = first ? hashBytes(first) : null
        this.clock.schedule(() => {
          void this.adapter
            .read(path)
            .then((second) => {
              const secondHash = second ? hashBytes(second) : null
              if (firstHash === secondHash) void this.reconcilePath(path)
              else this.quiesceThenReconcile(path) // still being written; retry
            })
            .catch((err) => this.events.onError?.(err))
        }, this.quiesceMs)
      })
      .catch((err) => this.events.onError?.(err))
  }

  private scheduleReconcile(guid: string): void {
    if (this.reconcileScheduled.has(guid)) return
    this.reconcileScheduled.add(guid)
    this.clock.schedule(() => {
      this.reconcileScheduled.delete(guid)
      void this.reconcile(guid)
    }, 50)
  }

  private async reconcilePath(path: string): Promise<void> {
    const guid = this.pathToGuid.get(path)
    if (!guid) return // not a tracked note: new files are enrolled by the watch path, not here
    await this.reconcile(guid)
  }

  /**
   * Serialize every disk/LCA-touching operation per doc. Overlapping entry
   * points (flush, markClosed, scheduled reconciles, boot scans, review
   * resolution) used to interleave across await boundaries for one guid —
   * racing disk reads, atomic writes, and LCA puts into torn states and
   * spurious divergence reviews (dogfood 2026-09-07). Pure promise chaining:
   * no timers, injected-clock friendly; cross-doc concurrency is preserved.
   */
  private runExclusive<T>(guid: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.docQueues.get(guid) ?? Promise.resolve()
    const run = tail.then(fn, fn)
    const settled = run.then(
      () => undefined,
      () => undefined
    )
    this.docQueues.set(guid, settled)
    void settled.then(() => {
      if (this.docQueues.get(guid) === settled) this.docQueues.delete(guid)
    })
    return run
  }

  /**
   * `runExclusive` over several docs at once (a directory rename): waits for
   * whatever each doc's queue holds, runs `fn` once, and holds every queue
   * until it settles — so a reconcile queued on any of them in the meantime
   * runs after the whole operation, never in the middle of it. Nothing
   * queued earlier can depend on this section, so the wait cannot deadlock.
   */
  private runExclusiveAll<T>(guids: readonly string[], fn: () => Promise<T>): Promise<T> {
    const unique = [...new Set(guids)]
    if (unique.length === 0) return fn()
    if (unique.length === 1) return this.runExclusive(unique[0]!, fn)
    const tails = unique.map((g) => this.docQueues.get(g) ?? Promise.resolve())
    const run = Promise.all(
      tails.map((t) =>
        t.then(
          () => undefined,
          () => undefined
        )
      )
    ).then(fn)
    const settled = run.then(
      () => undefined,
      () => undefined
    )
    for (const g of unique) this.docQueues.set(g, settled)
    void settled.then(() => {
      for (const g of unique) if (this.docQueues.get(g) === settled) this.docQueues.delete(g)
    })
    return run
  }

  private reconcile(guid: string): Promise<void> {
    return this.runExclusive(guid, () => this.reconcileNow(guid))
  }

  /** Only ever call from inside runExclusive (or a fn queued through it). */
  private async reconcileNow(guid: string): Promise<void> {
    if (this.disposed) return
    const doc = this.docs.get(guid)
    const lca = await this.lcaStore.get(guid)
    if (!doc || !lca) return
    try {
      const result = await reconcileFile(this.ctx, doc, lca)
      if (result.review) {
        this.reviews.set(guid, result.review)
        this.events.onReview?.(result.review)
      }
      if (result.action !== 'noop') this.events.onActivity?.(guid, result.action)
    } catch (err) {
      this.events.onError?.(err)
    }
  }

  /**
   * Rename-vs-rename resolution (fuzz crasher 0004). `renameFile`/`renameDir`
   * both write `m.delete(from); m.set(to, entry)` with the SAME guid. Two
   * peers doing that concurrently UNION rather than conflict — neither side's
   * delete ever saw the other side's `set` — so the guid ends up at BOTH new
   * paths in BOTH maps, and each device's reconciler then resolves the pair
   * from its own disk. That breaks A6's first clause ("every guid in exactly
   * one map, at one path") and leaves two permanently divergent disks with no
   * review raised on either side.
   *
   * The map is an LWW register per KEY; it carries no per-guid clock, and
   * `MapHandle` exposes no item id to break the tie with. So the rule is one
   * both devices can compute from the merged state alone, with no engine
   * support at all:
   *
   *   **the lexicographically greatest path wins** (UTF-16 code-unit order,
   *   the same order `<`/`>` give everywhere), and every other key holding
   *   that guid is HARD-deleted.
   *
   * Every peer sees the same merged key set, so every peer elects the same
   * survivor and converges. Hard-deleted, never tombstoned: a tombstone would
   * tell peers to remove the bytes, and the bytes are the survivor's (the
   * ghost-entry rule's reasoning, S10 Q5). Mount entries are excluded — their
   * guid is a ROOM guid and the same room at two paths is a mount move, which
   * the adopt machine owns — and so is everything at or under one, and
   * everything that is not `text`; see the guards.
   */
  private dedupeGuidKeys(current: Map<string, FileEntry>): void {
    // The same two guards every other pass over this map carries. Both are
    // about not acting on someone else's rows:
    //
    //  - anything at or under a `kind:'mount'` boundary belongs to a mount
    //    session on this device, and a key there is a GHOST the adopt
    //    machine's sweep resolves by guid (rename inside the mount, import,
    //    replay the delete). Electing a winner here would hard-delete the
    //    very key that sweep is about to read, and the two rooms would then
    //    disagree about where the file went.
    //  - only `text`. A concurrent rename splitting a guid across two keys is
    //    reconstructed by the passes below from `previous`, and those passes
    //    move text. Nothing moves a `binary` or a `dir` by guid, so collapsing
    //    one here deletes a live key that no pass will ever put back.
    this.refreshMountRoots()
    const byGuid = new Map<string, string[]>()
    for (const [path, entry] of current) {
      if (entry.deleted || entry.kind !== 'text') continue
      if (this.underMount(path)) continue
      const seen = byGuid.get(entry.guid)
      if (seen) seen.push(path)
      else byGuid.set(entry.guid, [path])
    }
    const losers: string[] = []
    for (const paths of byGuid.values()) {
      if (paths.length < 2) continue
      const winner = paths.reduce((a, b) => (b > a ? b : a))
      for (const p of paths) if (p !== winner) losers.push(p)
    }
    if (losers.length === 0) return
    this.folderDoc.transactMap((m) => {
      for (const p of losers) m.delete(p)
    }, 'local')
    for (const p of losers) current.delete(p)
  }

  /** Remote folder-map changes → local disk effects (create/rename/delete). */
  private async onRemoteMapChange(): Promise<void> {
    const current = new Map(this.folderDoc.getMap().entries())
    // Before anything is compared against `previous`: collapse a guid that a
    // concurrent rename left at two keys, so the passes below see one path
    // per guid and both devices see the SAME one (crasher 0004).
    this.dedupeGuidKeys(current)
    const previous = this.lastEntries
    this.lastEntries = new Map(current)

    const prevByGuid = new Map([...previous.entries()].map(([p, e]) => [e.guid, p]))
    const moves: { from: string; to: string }[] = []
    /** Old dir paths to clear once their children have moved/gone (pass 2). */
    const dirCleanups: string[] = []

    // Mount entries (N1) are pure announcements: never a doc, never an LCA,
    // never a disk effect. Their subtrees are skipped in BOTH passes — the
    // files under a mount root belong to another session on this device, so a
    // remove/mkdir here would be one session editing another's files. The
    // carve transaction that introduces one hard-deletes the subtree's keys in
    // the same transaction, so those keys are simply absent from `current`.
    // Recomputed before the passes because the entry may have arrived in the
    // very change we are handling.
    this.refreshMountRoots()

    // Pass 1: text files — content-bearing effects first, so a directory
    // move's children land before its old dir is cleaned up in pass 2.
    //
    // Every entry is handled in its OWN try/catch (crasher 0002): one entry's
    // failure used to abort the whole pass, so a rename batched with a delete
    // could leave a file on disk that the map says is gone. A failure is now
    // exactly one report on `onError` and the rest of the batch still runs.
    for (const [path, entry] of current) {
      if (entry.kind !== 'text') continue
      try {
        const oldPath = prevByGuid.get(entry.guid)
        // Either end inside a mount boundary → another session's disk.
        if (this.underMount(path) || (oldPath && this.underMount(oldPath))) continue

        if (entry.deleted && oldPath && !previous.get(oldPath)?.deleted) {
          // Remote deletion → journal pre-image, remove local file.
          const pre = await this.adapter.read(oldPath)
          if (pre) await this.ctx.journal.record(oldPath, pre)
          await this.adapter.remove(oldPath).catch(() => {})
          this.pathToGuid.delete(oldPath)
          this.ctx.openPaths.delete(oldPath)
          continue
        }
        if (entry.deleted) continue

        if (oldPath && previous.get(oldPath)?.deleted) {
          // RESURRECTION (crasher 0005): this device tombstoned the key and a
          // peer re-`set` the same guid — which every unshare does, because
          // announcing an absorb re-states the whole subtree on the live map.
          // `deleteFile` leaves the doc AND the LCA in place, so the "new
          // remote file" branch below is guarded out and nothing would ever
          // materialize: both maps would say the note exists, one device
          // would have it, the other silently would not, and no review would
          // be raised on either side. Reset the LCA to NEVER_ON_DISK at the
          // CURRENT path and let the reconciler write the doc back to disk.
          if (oldPath !== path) {
            await this.ctx.journal.rename(oldPath, path) // history follows (M10)
            this.rekeyPath(oldPath, path, entry.guid)
          }
          this.pathToGuid.set(path, entry.guid)
          const doc = this.docs.get(entry.guid)
          if (doc) {
            await this.lcaStore.put({
              guid: entry.guid,
              path,
              baseText: '',
              contentHash: NEVER_ON_DISK,
              heads: this.engine.encodeHeads(emptyHeads(this.engine)),
              eol: 'lf',
              bom: false,
            })
            // Already subscribed: the doc predates the delete, and `deleteFile`
            // never dropped it. Only the LCA had to come back.
            this.scheduleReconcile(entry.guid)
          }
          if (oldPath !== path) moves.push({ from: oldPath, to: path })
          continue
        }

        if (!oldPath) {
          // New remote file: doc content arrives via provider; LCA marks "never on disk".
          this.pathToGuid.set(path, entry.guid)
          const doc = this.docs.get(entry.guid)
          if (doc && !(await this.lcaStore.get(entry.guid))) {
            await this.lcaStore.put({
              guid: entry.guid,
              path,
              baseText: '',
              contentHash: NEVER_ON_DISK,
              heads: this.engine.encodeHeads(emptyHeads(this.engine)),
              eol: 'lf',
              bom: false,
            })
            this.subscribeDoc(entry.guid, doc)
            this.scheduleReconcile(entry.guid)
          }
          continue
        }

        if (oldPath !== path) {
          // Remote rename. The source may not be on disk at all: a file this
          // device learned about in an earlier map change whose materialize is
          // still queued behind this scan (crasher 0002). That is not an
          // error — it is a file we have not written YET — so skip the move
          // and let the reconciler write the bytes at the NEW path.
          const onDisk = (await this.adapter.read(oldPath)) !== null
          if (onDisk) await this.adapter.rename(oldPath, path)
          await this.ctx.journal.rename(oldPath, path) // history follows (M10)
          this.rekeyPath(oldPath, path, entry.guid)
          const lca = await this.lcaStore.get(entry.guid)
          if (lca) await this.lcaStore.put({ ...lca, path })
          if (!onDisk) this.scheduleReconcile(entry.guid)
          moves.push({ from: oldPath, to: path })
        }
      } catch (err) {
        this.events.onError?.(err)
      }
    }

    // Pass 2: directories (M3) — mkdir creates, rename/delete cleanup after
    // the children moved above. Old dirs are removed empty-only, deepest
    // first; untracked leftovers legitimately keep a dir alive.
    for (const [path, entry] of current) {
      if (entry.kind !== 'dir') continue
      try {
        const oldPath = prevByGuid.get(entry.guid)
        if (this.underMount(path) || (oldPath && this.underMount(oldPath))) continue

        if (entry.deleted && oldPath && !previous.get(oldPath)?.deleted) {
          dirCleanups.push(oldPath)
          continue
        }
        if (entry.deleted) continue

        if (!oldPath) {
          await this.adapter.mkdir(path).catch((err) => this.events.onError?.(err))
          continue
        }
        if (oldPath !== path) {
          await this.adapter.mkdir(path).catch((err) => this.events.onError?.(err))
          dirCleanups.push(oldPath)
          moves.push({ from: oldPath, to: path })
        }
      } catch (err) {
        this.events.onError?.(err)
      }
    }
    for (const p of dirCleanups.sort((a, b) => b.length - a.length)) {
      await this.adapter.removeDir(p).catch(() => {})
    }

    if (moves.length) this.events.onPathsRenamed?.(moves)
  }

  /** Move every piece of per-path session bookkeeping from one key to another. */
  private rekeyPath(from: string, to: string, guid: string | null): void {
    if (guid !== null) {
      this.pathToGuid.delete(from)
      this.pathToGuid.set(to, guid)
    }
    if (this.ctx.openPaths.delete(from)) this.ctx.openPaths.add(to)
    const ring = this.ctx.recentFlushes.get(from)
    if (ring) {
      this.ctx.recentFlushes.delete(from)
      this.ctx.recentFlushes.set(to, ring)
    }
  }

  /**
   * UI action: rename/move a file (text or binary) and propagate via the map.
   *
   * Two orderings matter here (the desktop rename, QA 2026-10-16;
   * `test/rename-race.test.ts`):
   *
   *  - The whole rename runs INSIDE the doc's exclusive section. A native
   *    watcher reports the rename while the journal and the LCA store are
   *    still being awaited, and a reconcile of the old path in that window
   *    read an LCA naming a path the disk no longer had — a 'vanished' review
   *    for a note that had merely moved. Serialized, that reconcile waits for
   *    the rename to land and then finds the file at its new path, unchanged.
   *  - `onPathsRenamed` fires in the SAME turn the map changes, before any
   *    further await. The host's file list follows the map at once, and its
   *    tab layer prunes tabs whose path has left the list; told late (after
   *    real disk I/O), it closed the tab at the old name (S9-Q4).
   */
  async renameFile(from: string, to: string): Promise<void> {
    const entry = this.folderDoc.getMap().get(from)
    if (!entry || entry.deleted || entry.kind === 'dir' || entry.kind === 'mount') {
      throw new Error(`rename: unknown path ${from}`)
    }
    const run = async (): Promise<void> => {
      await this.adapter.rename(from, to)
      this.folderDoc.transactMap((m) => {
        m.delete(from)
        m.set(to, entry)
      }, 'local')
      this.lastEntries.delete(from)
      this.lastEntries.set(to, entry)
      if (entry.kind === 'text') this.rekeyPath(from, to, entry.guid)
      this.events.onPathsRenamed?.([{ from, to }])
      // The journal is keyed by path: its history follows the file, or the
      // note arrives at its new name with nothing to restore (M10). Binaries
      // too — they are journaled by import and delete.
      await this.ctx.journal.rename(from, to)
      if (entry.kind === 'text') {
        const lca = await this.lcaStore.get(entry.guid)
        if (lca) await this.lcaStore.put({ ...lca, path: to })
      }
    }
    if (entry.kind === 'text') await this.runExclusive(entry.guid, run)
    else await run()
  }

  /** UI action: create a directory — first-class map entry, syncs to peers. */
  async createDir(path: string): Promise<void> {
    if (this.folderDoc.getMap().get(path)) throw new Error(`createDir: ${path} exists`)
    await this.adapter.mkdir(path)
    const entry: FileEntry = { guid: crypto.randomUUID(), kind: 'dir' }
    this.folderDoc.transactMap((m) => m.set(path, entry), 'local')
    this.lastEntries.set(path, entry)
  }

  /**
   * UI action: rename/move a directory. ONE map transaction rewrites the
   * prefix of every child entry plus the dir entry itself (peers apply the
   * children as ordinary per-file moves and clean up the old dir); disk moves
   * first via the adapter's dir rename (copy+delete on OPFS).
   */
  async renameDir(from: string, to: string): Promise<void> {
    const dirEntry = this.folderDoc.getMap().get(from)
    if (!dirEntry || dirEntry.kind !== 'dir' || dirEntry.deleted) {
      throw new Error(`renameDir: unknown dir ${from}`)
    }
    if (to === from || to.startsWith(`${from}/`)) {
      throw new Error(`renameDir: cannot move ${from} into itself`)
    }
    // A mount boundary inside the subtree is another session's root: moving
    // its key would strand that session's path (S10-Q5 race territory).
    if (this.containsMount(from)) {
      throw new Error(`renameDir: '${from}' contains a shared folder`)
    }
    const prefix = `${from}/`
    // Every doc under the directory holds the rename's exclusive section, for
    // the same two reasons `renameFile` gives.
    const guids = this.folderDoc
      .getMap()
      .entries()
      .filter(([p, e]) => e.kind === 'text' && !e.deleted && p.startsWith(prefix))
      .map(([, e]) => e.guid)
    await this.runExclusiveAll(guids, async () => {
      await this.adapter.renameDir(from, to)
      const moves: { from: string; to: string }[] = []
      this.folderDoc.transactMap((m) => {
        for (const [p, e] of m.entries()) {
          if (p !== from && !p.startsWith(prefix)) continue
          const np = to + p.slice(from.length)
          m.delete(p)
          m.set(np, e)
          moves.push({ from: p, to: np })
        }
      }, 'local')
      const rekeyed: { guid: string; path: string }[] = []
      for (const { from: p, to: np } of moves) {
        const e = this.lastEntries.get(p)
        if (e) {
          this.lastEntries.delete(p)
          this.lastEntries.set(np, e)
        }
        const guid = this.pathToGuid.get(p) ?? null
        this.rekeyPath(p, np, guid)
        if (guid) rekeyed.push({ guid, path: np })
      }
      this.events.onPathsRenamed?.(moves)
      // Prefix-wise, in one call: every pre-image under the old directory is
      // re-keyed under the new one (M10).
      await this.ctx.journal.rename(from, to)
      for (const { guid, path } of rekeyed) {
        const lca = await this.lcaStore.get(guid)
        if (lca) await this.lcaStore.put({ ...lca, path })
      }
    })
  }

  /** UI action: delete one file (text or binary) — journaled, tombstoned for peers. */
  async deleteFile(path: string): Promise<void> {
    const entry = this.folderDoc.getMap().get(path)
    if (!entry || entry.deleted || entry.kind === 'dir' || entry.kind === 'mount') {
      throw new Error(`deleteFile: unknown path ${path}`)
    }
    const pre = await this.adapter.read(path)
    if (pre) await this.ctx.journal.record(path, pre)
    await this.adapter.remove(path)
    const tomb = { ...entry, deleted: true }
    this.folderDoc.transactMap((m) => m.set(path, tomb), 'local')
    this.lastEntries.set(path, tomb)
    this.pathToGuid.delete(path)
    this.ctx.openPaths.delete(path)
  }

  /**
   * UI action: delete a directory and everything under it. Every file's
   * pre-image is journaled before its bytes are removed; all tombstones land
   * in ONE map transaction; empty dirs are cleared deepest-first (untracked
   * leftovers legitimately keep a dir on disk).
   */
  async deleteDir(path: string): Promise<void> {
    const dirEntry = this.folderDoc.getMap().get(path)
    if (!dirEntry || dirEntry.kind !== 'dir' || dirEntry.deleted) {
      throw new Error(`deleteDir: unknown dir ${path}`)
    }
    if (this.containsMount(path)) {
      throw new Error(`deleteDir: '${path}' contains a shared folder`)
    }
    const prefix = `${path}/`
    const doomed = this.folderDoc
      .getMap()
      .entries()
      .filter(([p, e]) => !e.deleted && (p === path || p.startsWith(prefix)))
    for (const [p, e] of doomed) {
      if (e.kind === 'dir') continue
      const pre = await this.adapter.read(p)
      if (pre) await this.ctx.journal.record(p, pre)
      await this.adapter.remove(p).catch((err) => this.events.onError?.(err))
    }
    this.folderDoc.transactMap((m) => {
      for (const [p, e] of doomed) m.set(p, { ...e, deleted: true })
    }, 'local')
    for (const [p, e] of doomed) {
      this.lastEntries.set(p, { ...e, deleted: true })
      this.pathToGuid.delete(p)
      this.ctx.openPaths.delete(p)
    }
    const dirs = doomed
      .filter(([, e]) => e.kind === 'dir')
      .map(([p]) => p)
      .sort((a, b) => b.length - a.length)
    for (const d of dirs) await this.adapter.removeDir(d).catch(() => {})
  }
}

/**
 * Anything our own code didn't tag is an external change. Real network
 * providers (e.g. Hocuspocus) apply remote updates with the provider
 * instance as the transaction origin — never the seam's 'remote' string —
 * so "not one of ours" is the correct remote test.
 */
function isForeignOrigin(origin: unknown): boolean {
  return origin !== 'local' && origin !== 'disk' && origin !== 'seed'
}

function emptyHeads(engine: import('@ohhi/sync').SyncEngine) {
  const tmp = engine.createDoc('empty-baseline')
  const heads = engine.heads(tmp)
  tmp.destroy()
  return heads
}
