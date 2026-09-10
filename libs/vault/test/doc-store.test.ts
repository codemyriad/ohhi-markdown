import { describe, expect, it } from 'vitest'
import { createYjsEngine, type SyncEngine } from '@editor/sync'
import { SimClock } from '@editor/testkit'
import { MemStoreDir, type StoreDir } from '../src/store-dir.js'
import { BlobDocStore, FOLDER_DOC_KEY, lcaGuard } from '../src/doc-store.js'
import { JsonFileLcaStore, MemJournal } from '../src/stores.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { enrollFolder } from '../src/enrollment.js'
import { reconcileFile, type ReconcileContext } from '../src/reconciler.js'
import { DEFAULT_THRESHOLDS, type LcaStore } from '../src/types.js'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)

/** Counts writeAtomic calls per name (debounce-coalescing assertions). */
class CountingStoreDir implements StoreDir {
  writes = new Map<string, number>()
  constructor(private inner: StoreDir) {}
  io(name: string) {
    const io = this.inner.io(name)
    // Binding names THIS dir: a store that addresses siblings (the per-record
    // LCA store) must route those writes back through the counter.
    return {
      read: io.read,
      writeAtomic: async (bytes: Uint8Array) => {
        this.writes.set(name, (this.writes.get(name) ?? 0) + 1)
        await io.writeAtomic(bytes)
      },
      binding: { dir: this, name },
    }
  }
  remove(name: string) {
    return this.inner.remove(name)
  }
  list(prefix?: string) {
    return this.inner.list(prefix)
  }
}

/** Crash injection: after `writesLeft` writes, every write "crashes" (throws, nothing stored). */
class FailingStoreDir implements StoreDir {
  writesLeft = Infinity
  constructor(private inner: StoreDir) {}
  io(name: string) {
    const io = this.inner.io(name)
    return {
      read: io.read,
      writeAtomic: async (bytes: Uint8Array) => {
        if (this.writesLeft <= 0) throw new Error(`crash: write dropped (${name})`)
        this.writesLeft--
        await io.writeAtomic(bytes)
      },
      binding: { dir: this, name },
    }
  }
  remove(name: string) {
    return this.inner.remove(name)
  }
  list(prefix?: string) {
    return this.inner.list(prefix)
  }
}

function makeCtx(
  engine: SyncEngine,
  adapter: MemVaultAdapter,
  lcaStore: LcaStore
): ReconcileContext {
  return {
    engine,
    adapter,
    lcaStore,
    journal: new MemJournal(),
    thresholds: DEFAULT_THRESHOLDS,
    recentFlushes: new Map(),
    openPaths: new Set(),
  }
}

describe('BlobDocStore', () => {
  it('persist/restore round-trips encoded CRDT state (heads equality, cross-engine)', async () => {
    const dir = new MemStoreDir()
    const clock = new SimClock()
    const engineA = createYjsEngine()
    const store = new BlobDocStore(engineA, dir, clock)
    const docA = engineA.createDoc('g1')
    docA.transact((t) => t.insert(0, 'hello world\n'), 'local')
    docA.transact((t) => t.delete(0, 6), 'local') // deletions must survive (delete set)
    store.track('g1', docA)
    await store.flush('g1')

    const engineB = createYjsEngine()
    const docB = engineB.createDoc('g1')
    const found = await new BlobDocStore(engineB, dir, new SimClock()).restore('g1', docB)
    expect(found).toBe(true)
    // Equality on encoded heads (SV + delete set) — NOT rendered text alone.
    expect(engineB.headsEqual(engineB.heads(docB), engineA.heads(docA))).toBe(true)
    expect(docB.getText()).toBe('world\n')
  })

  it('restore returns false when no blob exists', async () => {
    const engine = createYjsEngine()
    const store = new BlobDocStore(engine, new MemStoreDir(), new SimClock())
    expect(await store.restore('ghost', engine.createDoc('ghost'))).toBe(false)
  })

  it('debounce coalesces bursts into one write; edits after a flush write again', async () => {
    const counting = new CountingStoreDir(new MemStoreDir())
    const clock = new SimClock()
    const engine = createYjsEngine()
    const store = new BlobDocStore(engine, counting, clock, { debounceMs: 1000 })
    const doc = engine.createDoc('g1')
    store.track('g1', doc) // initial-dirty schedules one flush
    doc.transact((t) => t.insert(0, 'a'), 'local')
    doc.transact((t) => t.insert(1, 'b'), 'local')
    doc.transact((t) => t.insert(2, 'c'), 'local')
    clock.advance(1000)
    await store.flush('g1') // settle the async write kicked off by the timer
    expect(counting.writes.get('docs/g1.bin')).toBe(1)

    doc.transact((t) => t.insert(3, 'd'), 'local')
    clock.advance(1000)
    await store.flush('g1')
    expect(counting.writes.get('docs/g1.bin')).toBe(2)
  })

  it('flush-on-demand persists immediately and is a no-op when clean or untracked', async () => {
    const counting = new CountingStoreDir(new MemStoreDir())
    const engine = createYjsEngine()
    const store = new BlobDocStore(engine, counting, new SimClock())
    await store.flush('untracked') // no-op, no throw
    const doc = engine.createDoc('g1')
    store.track('g1', doc)
    doc.transact((t) => t.insert(0, 'x'), 'local')
    await store.flush('g1')
    expect(counting.writes.get('docs/g1.bin')).toBe(1)
    await store.flush('g1') // clean → no extra write
    expect(counting.writes.get('docs/g1.bin')).toBe(1)
  })

  it('names the folder doc blob docs/folder.bin', async () => {
    const dir = new MemStoreDir()
    const engine = createYjsEngine()
    const store = new BlobDocStore(engine, dir, new SimClock())
    const folderDoc = engine.createDoc('room-1/folder')
    store.track(FOLDER_DOC_KEY, folderDoc)
    await store.flush(FOLDER_DOC_KEY)
    expect(await dir.list('docs/')).toEqual(['docs/folder.bin'])
  })
})

describe('lcaGuard (Invariant D)', () => {
  it('awaits the doc blob before delegating put, and propagates flush failures', async () => {
    const order: string[] = []
    const docStore = {
      flush: async (key: string) => {
        order.push(`flush:${key}`)
      },
    }
    const inner: LcaStore = {
      get: async () => null,
      put: async (rec) => {
        order.push(`put:${rec.guid}`)
      },
      remove: async () => {},
      all: async () => [],
    }
    const guarded = lcaGuard(docStore as never, inner)
    await guarded.put({
      guid: 'g1',
      path: 'a.md',
      baseText: '',
      contentHash: '',
      heads: new Uint8Array(),
      eol: 'lf',
      bom: false,
    })
    expect(order).toEqual(['flush:g1', 'put:g1'])

    const failing = lcaGuard(
      { flush: async () => Promise.reject(new Error('crash')) } as never,
      inner
    )
    await expect(failing.put({ guid: 'g2' } as never)).rejects.toThrow('crash')
    expect(order).toHaveLength(2) // inner.put never ran for g2
  })
})

/**
 * L1 fixture 3 (spike S8): crash between doc-blob flush and LCA put must
 * never let a reopen materialize a regression. The stack under test is the
 * real durable wiring: JsonFileLcaStore + BlobDocStore over one crashable
 * StoreDir, classified on "reboot" by the real reconciler.
 */
describe('Invariant D crash fixture', () => {
  /** Era 1: enroll 'a.md'=v1, track+flush → durable baseline (blob/LCA/disk all v1). */
  async function establishBaseline(fail: FailingStoreDir, adapter: MemVaultAdapter) {
    await adapter.writeAtomic('a.md', enc('v1\n'))
    const engine = createYjsEngine()
    const docStore = new BlobDocStore(engine, fail, new SimClock())
    const lca = lcaGuard(docStore, new JsonFileLcaStore(fail.io('lca.json')))
    const folderDoc = engine.createDoc('folder')
    let n = 0
    const { docs } = await enrollFolder(engine, adapter, folderDoc, lca, () => `g${n++}`)
    const doc = docs.get('g0')!
    docStore.track('g0', doc)
    await docStore.flushAll()
    // Enrollment put the LCA before the doc was tracked — re-put through the
    // guard so the durable pair is exactly (blob v1, lca v1). This mirrors the
    // boot machine's enroll → track → flushAll → re-record sequence.
    await lca.put((await lca.get('g0'))!)
    return { engine, docStore, lca, doc }
  }

  /** Reboot: fresh engine/stores over the surviving bytes; reconcile once. */
  async function reboot(mem: MemStoreDir, adapter: MemVaultAdapter) {
    const engine = createYjsEngine()
    const docStore = new BlobDocStore(engine, mem, new SimClock())
    const jsonLca = new JsonFileLcaStore(mem.io('lca.json'))
    const lca = lcaGuard(docStore, jsonLca)
    const rec = (await jsonLca.get('g0'))!
    const doc = engine.createDoc('g0')
    const restored = await docStore.restore('g0', doc)
    docStore.track('g0', doc)
    const result = await reconcileFile(makeCtx(engine, adapter, lca), doc, rec)
    return { result, doc, restored }
  }

  it('with the guard, no crash point ever reverts disk (k = writes surviving the edit era)', async () => {
    // Writes during the edit-era reconcile: [0]=doc blob (guard flush),
    // [1]=the g0 LCA record file (`lca/g0.json`).
    for (const k of [0, 1, 2]) {
      const mem = new MemStoreDir()
      const fail = new FailingStoreDir(mem)
      const adapter = new MemVaultAdapter()
      const { engine, doc, lca } = await establishBaseline(fail, adapter)

      // Edit era: CRDT-side edit, then reconcile (materializes disk v2, then
      // advances blob+LCA through the guard) with a crash after k writes.
      doc.transact((t) => t.insert(0, 'v2 '), 'local')
      fail.writesLeft = k
      const era2 = reconcileFile(makeCtx(engine, adapter, lca), doc, (await lca.get('g0'))!)
      if (k < 2) await expect(era2).rejects.toThrow(/crash/)
      else await era2
      expect(dec(await adapter.read('a.md'))).toBe('v2 v1\n') // disk carries v2 either way

      fail.writesLeft = Infinity
      const { result } = await reboot(mem, adapter)

      // The invariant: disk is NEVER reverted to v1 by the reopen.
      expect(dec(await adapter.read('a.md'))).toBe('v2 v1\n')
      if (k === 0) {
        // Blob write crashed → durable doc == LCA (both v1) → disk-only change → ingest.
        expect(result.action).toBe('ingested')
      } else if (k === 1) {
        // Blob v2 durable, LCA still v1 → both sides "changed" → review, sides identical.
        expect(result.action).toBe('diverged')
        expect(result.review!.mine).toBe(result.review!.theirs)
      } else {
        expect(result.action).toBe('noop')
      }
    }
  })

  it('NEGATIVE CONTROL: without a durable-doc flush, reopen materializes stale text over newer disk', async () => {
    const mem = new MemStoreDir()
    const fail = new FailingStoreDir(mem)
    const adapter = new MemVaultAdapter()
    const { engine, doc } = await establishBaseline(fail, adapter)

    // Edit era WITHOUT the guard: reconcile advances disk + LCA to v2, but the
    // doc blob is never flushed (simulating LCA-before-blob ordering + crash).
    doc.transact((t) => t.insert(0, 'v2 '), 'local')
    const unguarded = new JsonFileLcaStore(fail.io('lca.json'))
    const result = await reconcileFile(makeCtx(engine, adapter, unguarded), doc, (await unguarded.get('g0'))!)
    expect(result.action).toBe('materialized')
    expect(dec(await adapter.read('a.md'))).toBe('v2 v1\n')

    // Reboot restores the STALE v1 blob against the v2 LCA: disk matches the
    // LCA, the doc looks "changed" (it is BEHIND) → materialize regression.
    const { result: reopened } = await reboot(mem, adapter)
    expect(reopened.action).toBe('materialized')
    expect(dec(await adapter.read('a.md'))).toBe('v1\n') // v2 silently reverted — the bug Invariant D kills
  })
})
