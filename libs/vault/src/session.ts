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
import { decodeFile } from './eol.js'
import { hashBytes } from './hash.js'
import { NEVER_ON_DISK } from './enrollment.js'
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
  private reviews = new Map<string, DivergenceReview>()
  private subscriptions: (() => void)[] = []
  private paused = false
  private queuedPaths = new Set<string>()
  private reconcileScheduled = new Set<string>()
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
    for (const [path, entry] of this.folderDoc.getMap().entries()) {
      this.lastEntries.set(path, entry)
      if (entry.kind === 'text' && !entry.deleted) this.pathToGuid.set(path, entry.guid)
    }
    this.subscriptions.push(this.adapter.watch((ev) => this.onWatch(ev)))
    this.subscriptions.push(
      this.folderDoc.getMap().observe((origin) => {
        if (origin === 'remote') void this.onRemoteMapChange()
      })
    )
    for (const [guid, doc] of this.docs) this.subscribeDoc(guid, doc)
  }

  private subscribeDoc(guid: string, doc: EngineDoc): void {
    this.subscriptions.push(
      this.engine.onUpdate(doc, (_update, origin) => {
        if (origin === 'remote') this.scheduleReconcile(guid)
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

  /** Debounced flush-on-idle entry point for open docs. */
  async flush(guid: string): Promise<void> {
    const path = this.pathOf(guid)
    if (!path) return
    this.ctx.openPaths.delete(path)
    try {
      await this.reconcile(guid)
    } finally {
      this.ctx.openPaths.add(path)
    }
  }

  pendingReviews(): DivergenceReview[] {
    return [...this.reviews.values()]
  }

  async resolveReview(guid: string, mergedText: string): Promise<void> {
    const lca = await this.lcaStore.get(guid)
    const doc = this.docs.get(guid)
    if (!lca || !doc) throw new Error(`resolveReview: unknown doc ${guid}`)
    await resolveDivergence(this.ctx, doc, lca, mergedText)
    this.reviews.delete(guid)
    this.events.onReviewCleared?.(guid)
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

  private async reconcile(guid: string): Promise<void> {
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

    for (const [path, entry] of current) {
      if (entry.kind !== 'text') continue
      const oldPath = prevByGuid.get(entry.guid)

      if (entry.deleted && oldPath && !previous.get(oldPath)?.deleted) {
        // Remote deletion → journal pre-image, remove local file.
        const pre = await this.adapter.read(oldPath)
        if (pre) await this.ctx.journal.record(oldPath, pre)
        await this.adapter.remove(oldPath).catch(() => {})
        this.pathToGuid.delete(oldPath)
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
        this.pathToGuid.delete(oldPath)
        this.pathToGuid.set(path, entry.guid)
        const lca = await this.lcaStore.get(entry.guid)
        if (lca) await this.lcaStore.put({ ...lca, path })
      }
    }
  }

  /** UI action: rename a file locally and propagate via the folder map. */
  async renameFile(from: string, to: string): Promise<void> {
    const guid = this.pathToGuid.get(from)
    if (!guid) throw new Error(`rename: unknown path ${from}`)
    const entry = this.folderDoc.getMap().get(from)
    if (!entry) throw new Error(`rename: no map entry for ${from}`)
    await this.adapter.rename(from, to)
    this.folderDoc.transactMap((m) => {
      m.delete(from)
      m.set(to, entry)
    }, 'local')
    this.pathToGuid.delete(from)
    this.pathToGuid.set(to, guid)
    this.lastEntries.delete(from)
    this.lastEntries.set(to, entry)
    const lca = await this.lcaStore.get(guid)
    if (lca) await this.lcaStore.put({ ...lca, path: to })
  }
}

function emptyHeads(engine: import('@editor/sync').SyncEngine) {
  const tmp = engine.createDoc('empty-baseline')
  const heads = engine.heads(tmp)
  tmp.destroy()
  return heads
}
