/**
 * Durable CRDT doc state: one full-state blob per doc (the relay's own
 * persistence model — spike S8 Q2), debounce-written on update, awaitable on
 * demand. Restores apply with origin 'seed', which both the session's
 * foreign-origin test and the workspace's update routing already treat as
 * "our own content arriving", exactly like enrollment seeding — a restore
 * must never be classified as a remote edit.
 *
 * INVARIANT D (spike S8): the durable doc state must always be ≥ the durable
 * LCA heads. A doc blob *older* than its LCA record makes the reconciler read
 * "doc changed vs LCA" on reopen and materialize stale text over newer disk.
 * `lcaGuard` enforces the safe ordering at the only choke point that
 * advances an LCA: flush the doc blob first, then write the record.
 */
import type { EngineDoc, SyncEngine } from '@editor/sync'
import type { LcaRecord, LcaStore } from './types.js'
import type { Clock } from './session.js'
import type { StoreDir } from './store-dir.js'

/** Store key for a mount's folder doc → blob `docs/folder.bin`. */
export const FOLDER_DOC_KEY = 'folder'

export interface DocStore {
  /**
   * Register a doc for dirty-tracking + debounced persistence. Tracking marks
   * the doc dirty immediately: a doc must never be LCA-recorded without a
   * blob at least as new (Invariant D), and a just-enrolled doc has no blob.
   */
  track(key: string, doc: EngineDoc): void
  /** Stop tracking (cancels any pending debounce; does not remove the blob). */
  untrack(key: string): void
  /**
   * Apply the persisted blob into `doc` (origin 'seed'). Returns false when
   * no blob exists. Call before track() to avoid one redundant rewrite.
   */
  restore(key: string, doc: EngineDoc): Promise<boolean>
  /** Await durable persistence of the doc's current state. No-op if untracked. */
  flush(key: string): Promise<void>
  flushAll(): Promise<void>
  /** Delete the persisted blob (untrack first if tracked). */
  remove(key: string): Promise<void>
  /** Untrack everything. Does NOT flush — call flushAll() first if needed. */
  dispose(): void
}

interface Tracked {
  doc: EngineDoc
  off: () => void
  /** Bumped on every doc update; compared against persistedEpoch. */
  dirtyEpoch: number
  persistedEpoch: number
  cancelDebounce: (() => void) | null
  /** Serializes flushes per key; kept resolved after failures. */
  chain: Promise<void>
}

/**
 * Blob file name for a doc key within a mount namespace. Exported for
 * store-surgery recovery paths (vault-boot rollforward) that must address
 * blobs without a live BlobDocStore. encodeURIComponent keeps UUIDs and
 * 'folder' verbatim and makes any other key filesystem-safe and reversible.
 */
export function docBlobName(key: string): string {
  return `docs/${encodeURIComponent(key)}.bin`
}

const blobName = docBlobName

export class BlobDocStore implements DocStore {
  private tracked = new Map<string, Tracked>()
  private readonly debounceMs: number

  constructor(
    private engine: SyncEngine,
    private dir: StoreDir,
    private clock: Clock,
    opts?: { debounceMs?: number }
  ) {
    this.debounceMs = opts?.debounceMs ?? 1000
  }

  track(key: string, doc: EngineDoc): void {
    if (this.tracked.has(key)) return
    const t: Tracked = {
      doc,
      off: () => {},
      dirtyEpoch: 1, // persist at least once after tracking (see interface note)
      persistedEpoch: 0,
      cancelDebounce: null,
      chain: Promise.resolve(),
    }
    t.off = this.engine.onUpdate(doc, () => {
      t.dirtyEpoch++
      this.scheduleFlush(key, t)
    })
    this.tracked.set(key, t)
    this.scheduleFlush(key, t)
  }

  untrack(key: string): void {
    const t = this.tracked.get(key)
    if (!t) return
    t.cancelDebounce?.()
    t.off()
    this.tracked.delete(key)
  }

  async restore(key: string, doc: EngineDoc): Promise<boolean> {
    const bytes = await this.dir.io(blobName(key)).read()
    if (bytes === null) return false
    this.engine.applyUpdate(doc, bytes, 'seed')
    return true
  }

  flush(key: string): Promise<void> {
    const t = this.tracked.get(key)
    if (!t) return Promise.resolve()
    t.cancelDebounce?.()
    t.cancelDebounce = null
    const run = t.chain.then(async () => {
      while (t.persistedEpoch < t.dirtyEpoch) {
        const epoch = t.dirtyEpoch
        const bytes = this.engine.encodeUpdateSince(t.doc, null)
        await this.dir.io(blobName(key)).writeAtomic(bytes)
        t.persistedEpoch = epoch
      }
    })
    // A failed write leaves the epoch un-advanced (retried on the next flush)
    // and must not poison the chain for later flushes.
    t.chain = run.catch(() => {})
    return run
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.tracked.keys()].map((key) => this.flush(key)))
  }

  async remove(key: string): Promise<void> {
    await this.dir.remove(blobName(key))
  }

  dispose(): void {
    for (const key of [...this.tracked.keys()]) this.untrack(key)
  }

  private scheduleFlush(key: string, t: Tracked): void {
    t.cancelDebounce?.()
    t.cancelDebounce = this.clock.schedule(() => {
      t.cancelDebounce = null
      void this.flush(key).catch(() => {
        /* retried on next update/flush; reconciler-path flushes surface errors via lcaGuard */
      })
    }, this.debounceMs)
  }
}

/**
 * Invariant D enforcement: an LcaStore whose put() awaits the doc blob first,
 * so no caller (reconciler, enrollment, session) can advance an LCA past the
 * durable doc state. Wrap the real store once at wiring time.
 */
export function lcaGuard(docStore: DocStore, lcaStore: LcaStore): LcaStore {
  return {
    get: (guid) => lcaStore.get(guid),
    put: async (rec: LcaRecord) => {
      await docStore.flush(rec.guid)
      await lcaStore.put(rec)
    },
    remove: (guid) => lcaStore.remove(guid),
    all: () => lcaStore.all(),
  }
}
