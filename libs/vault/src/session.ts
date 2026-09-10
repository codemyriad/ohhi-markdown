/**
 * VaultSession: orchestrates one enrolled folder — watcher events in,
 * reconciliation actions out, folder-map changes in both directions,
 * divergence reviews and the mass-change breaker surfaced as events.
 * All timing goes through the injected Clock (golden rule 5).
 */
import type { EngineDoc, FileEntry, SyncEngine } from '@editor/sync'
import {
  reconcileFile,
  resolveDivergence,
  type ReconcileContext,
} from './reconciler.js'
import { decodeFile, renderFile } from './eol.js'
import { hashBytes } from './hash.js'
import { NEVER_ON_DISK } from './enrollment.js'
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
    this.subscriptions.push(this.adapter.watch((ev) => this.onWatch(ev)))
    this.subscriptions.push(
      this.folderDoc.getMap().observe((origin) => {
        this.refreshMountRoots()
        if (isForeignOrigin(origin)) void this.onRemoteMapChange()
      })
    )
    for (const [guid, doc] of this.docs) this.subscribeDoc(guid, doc)
  }

  private refreshMountRoots(): void {
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
      const lca = await this.lcaStore.get(guid)
      const doc = this.docs.get(guid)
      if (!lca || !doc) throw new Error(`restoreFile: unknown doc ${guid}`)
      // The pre-image carries its own EOL/BOM; the LCA's flavour is what the
      // file is written back with, so decode to text and let materialize
      // render it. Restoring must not flip a CRLF file to LF behind the user.
      await resolveDivergence(this.ctx, doc, lca, decodeFile(bytes).text)
    })
  }

  /** Mass-change breaker confirmation: process everything queued. */
  async confirmPendingBatch(): Promise<void> {
    this.paused = false
    const paths = [...this.queuedPaths]
    this.queuedPaths.clear()
    for (const path of paths) await this.reconcilePath(path)
  }

  dismissPendingBatch(): void {
    this.paused = false
    this.queuedPaths.clear()
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
    ev = { paths: ev.paths.filter((p) => !this.underMount(p)) }
    if (ev.paths.length === 0) return
    const known = ev.paths.filter((p) => this.pathToGuid.has(p))
    if (known.length > this.ctx.thresholds.massChangePaths) {
      this.paused = true
      for (const p of known) this.queuedPaths.add(p)
      this.events.onBreaker?.(known)
      return
    }
    for (const path of ev.paths) {
      if (this.paused) {
        this.queuedPaths.add(path)
        continue
      }
      this.quiesceThenReconcile(path)
    }
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
    if (!guid) return // unknown path: V1 ignores out-of-map files (enroll-on-create is a UI action)
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

  /** Remote folder-map changes → local disk effects (create/rename/delete). */
  private async onRemoteMapChange(): Promise<void> {
    const current = new Map(this.folderDoc.getMap().entries())
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
    for (const [path, entry] of current) {
      if (entry.kind !== 'text') continue
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
        // Remote rename: move the disk file, update the LCA path.
        await this.adapter.rename(oldPath, path).catch((err) => this.events.onError?.(err))
        this.rekeyPath(oldPath, path, entry.guid)
        const lca = await this.lcaStore.get(entry.guid)
        if (lca) await this.lcaStore.put({ ...lca, path })
        moves.push({ from: oldPath, to: path })
      }
    }

    // Pass 2: directories (M3) — mkdir creates, rename/delete cleanup after
    // the children moved above. Old dirs are removed empty-only, deepest
    // first; untracked leftovers legitimately keep a dir alive.
    for (const [path, entry] of current) {
      if (entry.kind !== 'dir') continue
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

  /** UI action: rename/move a file (text or binary) and propagate via the map. */
  async renameFile(from: string, to: string): Promise<void> {
    const entry = this.folderDoc.getMap().get(from)
    if (!entry || entry.deleted || entry.kind === 'dir' || entry.kind === 'mount') {
      throw new Error(`rename: unknown path ${from}`)
    }
    await this.adapter.rename(from, to)
    this.folderDoc.transactMap((m) => {
      m.delete(from)
      m.set(to, entry)
    }, 'local')
    this.lastEntries.delete(from)
    this.lastEntries.set(to, entry)
    if (entry.kind === 'text') {
      this.rekeyPath(from, to, entry.guid)
      const lca = await this.lcaStore.get(entry.guid)
      if (lca) await this.lcaStore.put({ ...lca, path: to })
    }
    this.events.onPathsRenamed?.([{ from, to }])
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
    for (const { from: p, to: np } of moves) {
      const e = this.lastEntries.get(p)
      if (e) {
        this.lastEntries.delete(p)
        this.lastEntries.set(np, e)
      }
      const guid = this.pathToGuid.get(p) ?? null
      this.rekeyPath(p, np, guid)
      if (guid) {
        const lca = await this.lcaStore.get(guid)
        if (lca) await this.lcaStore.put({ ...lca, path: np })
      }
    }
    this.events.onPathsRenamed?.(moves)
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

function emptyHeads(engine: import('@editor/sync').SyncEngine) {
  const tmp = engine.createDoc('empty-baseline')
  const heads = engine.heads(tmp)
  tmp.destroy()
  return heads
}
