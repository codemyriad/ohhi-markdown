/**
 * Regression fixtures for the reconcile race family (dogfood 2026-09-07):
 * a joiner with NO local edits raised a spurious three-way review one
 * keystroke apart from its own materialized disk ("[[Broa" vs "[[Broad").
 * Two structural defects, each pinned here:
 *
 *  1. TORN LCA SNAPSHOT — materialize() read doc text before its awaits
 *     (journal + atomic write) but doc heads after them, so a remote update
 *     landing in that window stored an LCA whose text/hash and heads describe
 *     different moments. Next classification: noop over stale disk; with
 *     overlapping entry points, spurious reviews.
 *  2. NO PER-DOC SERIALIZATION — flush / markClosed / scheduled reconciles
 *     for the same guid interleaved across await points, racing disk reads,
 *     writes, and LCA puts.
 *
 * These act as fuzz-crashers-style permanent regressions: they assert the
 * CORRECT behavior and fail on the pre-fix code.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@editor/sync'
import { SimClock } from '@editor/testkit'
import { enrollFolder } from '../src/enrollment.js'
import { hashBytes } from '../src/hash.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { reconcileFile, type ReconcileContext } from '../src/reconciler.js'
import { VaultSession } from '../src/session.js'
import { MemJournal, MemLcaStore } from '../src/stores.js'
import { DEFAULT_THRESHOLDS, type VaultAdapter, type WriteOptions } from '../src/types.js'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

/**
 * Wraps an adapter so writeAtomic parks until released — the deterministic
 * stand-in for a slow OPFS/fs write, letting a remote update land mid-flight.
 */
class GatedAdapter implements VaultAdapter {
  private gates: (() => void)[] = []
  gateWrites = false
  /** How many writes are parked right now (concurrency probe). */
  get parked(): number {
    return this.gates.length
  }

  constructor(private base: VaultAdapter) {}

  list() {
    return this.base.list()
  }
  listDirs() {
    return this.base.listDirs()
  }
  read(path: string) {
    return this.base.read(path)
  }
  async writeAtomic(path: string, bytes: Uint8Array, opts?: WriteOptions): Promise<void> {
    if (this.gateWrites) await new Promise<void>((r) => this.gates.push(r))
    return this.base.writeAtomic(path, bytes, opts)
  }
  rename(from: string, to: string) {
    return this.base.rename(from, to)
  }
  renameDir(from: string, to: string) {
    return this.base.renameDir(from, to)
  }
  remove(path: string) {
    return this.base.remove(path)
  }
  mkdir(path: string) {
    return this.base.mkdir(path)
  }
  removeDir(path: string) {
    return this.base.removeDir(path)
  }
  watch(cb: Parameters<VaultAdapter['watch']>[0]) {
    return this.base.watch(cb)
  }

  release(): void {
    this.gates.shift()?.()
  }
  releaseAll(): void {
    while (this.gates.length) this.release()
  }
}

describe('reconcile races (regression: spurious joiner divergence, 2026-09-07)', () => {
  it('materialize snapshots text+heads atomically: a remote update mid-write never tears the LCA', async () => {
    const engine = createYjsEngine()
    const adapter = new GatedAdapter(new MemVaultAdapter())
    const lcaStore = new MemLcaStore()
    const journal = new MemJournal()
    const ctx: ReconcileContext = {
      engine,
      adapter,
      lcaStore,
      journal,
      thresholds: DEFAULT_THRESHOLDS,
      recentFlushes: new Map(),
      openPaths: new Set(),
    }

    // In-sync baseline: doc == disk == LCA.
    const doc = engine.createDoc('g1')
    doc.transact((t) => t.insert(0, 'Linking to [[Bro'), 'seed')
    const bytes = enc('Linking to [[Bro')
    await adapter.writeAtomic('note.md', bytes)
    await lcaStore.put({
      guid: 'g1',
      path: 'note.md',
      baseText: 'Linking to [[Bro',
      contentHash: hashBytes(bytes),
      heads: engine.encodeHeads(engine.heads(doc)),
      eol: 'lf',
      bom: false,
    })

    // Keystroke 1 arrives from the relay → materialize starts, write parks.
    doc.transact((t) => t.insert(16, 'a'), 'remote')
    adapter.gateWrites = true
    const first = reconcileFile(ctx, doc, (await lcaStore.get('g1'))!)
    await settle()
    expect(adapter.parked).toBe(1)

    // Keystroke 2 lands while the write is in flight.
    doc.transact((t) => t.insert(17, 'd'), 'remote')
    adapter.release()
    expect((await first).action).toBe('materialized')
    expect(dec(await adapter.read('note.md'))).toBe('Linking to [[Broa')

    // The stored LCA must describe ONE moment: since disk holds "…Broa" and
    // the doc holds "…Broad", the next pass MUST see doc-ahead and
    // materialize the missing keystroke. The torn pre-fix record (old
    // text/hash + new heads) classified this as noop — disk stale forever.
    adapter.gateWrites = false
    const second = await reconcileFile(ctx, doc, (await lcaStore.get('g1'))!)
    expect(second.action).toBe('materialized')
    expect(second.review).toBeUndefined()
    expect(dec(await adapter.read('note.md'))).toBe('Linking to [[Broad')

    const third = await reconcileFile(ctx, doc, (await lcaStore.get('g1'))!)
    expect(third.action).toBe('noop')
  })

  it('per-doc serialization: overlapping flush + markClosed never run two writes, never review, converge', async () => {
    const engine = createYjsEngine()
    const adapter = new GatedAdapter(new MemVaultAdapter())
    const lcaStore = new MemLcaStore()
    const journal = new MemJournal()
    const clock = new SimClock()

    await adapter.writeAtomic('note.md', enc('Linking to [[Bro'))
    const folderDoc = engine.createDoc('room/folder')
    const { docs } = await enrollFolder(engine, adapter, folderDoc, lcaStore)
    const guid = folderDoc.getMap().get('note.md')!.guid
    const doc = docs.get(guid)!

    const reviews: string[] = []
    const session = new VaultSession({
      engine,
      adapter,
      lcaStore,
      journal,
      clock,
      folderDoc,
      docs,
      events: { onReview: (r) => reviews.push(r.reason) },
    })
    await session.start()

    // Joiner-shaped interleaving: keystroke → flush parks in the write;
    // next keystroke → a second entry point (markClosed) fires while the
    // first is still in flight. Pre-fix both proceeded concurrently (two
    // parked writes, racing LCA puts); post-fix the second queues.
    doc.transact((t) => t.insert(16, 'a'), 'remote')
    adapter.gateWrites = true
    const flush1 = session.flush(guid)
    await settle()
    expect(adapter.parked).toBe(1)

    doc.transact((t) => t.insert(17, 'd'), 'remote')
    const flush2 = session.markClosed(guid)
    await settle()
    // THE serialization assertion: the second reconcile must be queued, not
    // parked in a concurrent write. Pre-fix this reads 2.
    expect(adapter.parked).toBe(1)

    adapter.release()
    await settle()
    adapter.releaseAll()
    await Promise.all([flush1, flush2])
    adapter.gateWrites = false

    // One more pass for any tail delta, then: converged, quiet, no review.
    await session.flush(guid)
    expect(dec(await adapter.read('note.md'))).toBe('Linking to [[Broad')
    expect(reviews).toEqual([])
    expect(session.pendingReviews()).toEqual([])
    const final = await reconcileFile(
      {
        engine,
        adapter,
        lcaStore,
        journal,
        thresholds: DEFAULT_THRESHOLDS,
        recentFlushes: new Map(),
        openPaths: new Set(),
      },
      doc,
      (await lcaStore.get(guid))!
    )
    expect(final.action).toBe('noop')
    session.dispose()
  })
})
