/**
 * `VaultSession.onRemoteMapChange` under the three shapes the nested L1 fuzz
 * found (crashers 0002, 0004 and 0005 in
 * `libs/workspace/test/fuzz-crashers/`). They are driven from `libs/vault`
 * here because none of them involves a mount: they are the folder map's own
 * rename / delete / resurrect semantics, and this is the lane those crashers
 * asked to be moved into once fixed.
 *
 * Same two-session shape as `dir-ops.test.ts` (folder-map net, per-doc
 * seeding, injected SimClock) with two additions the races need: errors are
 * COLLECTED rather than re-thrown — a fault-isolation claim is a claim about
 * what reaches `onError` — and the net can be partitioned so both sides act
 * on the same key while apart.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine, type EngineDoc, type SyncEngine } from '@editor/sync'
import { SimClock, TestNetwork } from '@editor/testkit'
import { enrollFolder, joinFolder } from '../src/enrollment.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { MemJournal, MemLcaStore } from '../src/stores.js'
import { VaultSession } from '../src/session.js'
import type { VaultAdapter } from '../src/types.js'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

interface Side {
  adapter: MemVaultAdapter
  session: VaultSession
  folder: EngineDoc
  docs: Map<string, EngineDoc>
  errors: string[]
}

interface Duo {
  engine: SyncEngine
  a: Side
  b: Side
  net: TestNetwork
  clock: SimClock
  deliver: () => Promise<void>
  dispose: () => void
}

/**
 * Two sessions over the same enrolled content. `wrapB` may swap a failing
 * adapter under the B side: the only way to prove fault isolation is to make
 * one entry of a batch fail on purpose.
 */
async function makeDuo(
  seed: Record<string, string>,
  wrapB: (base: MemVaultAdapter) => VaultAdapter = (a) => a
): Promise<Duo> {
  const engine = createYjsEngine()
  const clock = new SimClock()

  const adapterA = new MemVaultAdapter()
  for (const [p, t] of Object.entries(seed)) await adapterA.writeAtomic(p, enc(t))
  const folderA = engine.createDoc('folder')
  const lcaA = new MemLcaStore()
  let n = 0
  const { docs: docsA } = await enrollFolder(engine, adapterA, folderA, lcaA, () => `g${n++}`)

  const adapterB = new MemVaultAdapter()
  for (const [p, t] of Object.entries(seed)) await adapterB.writeAtomic(p, enc(t))
  const folderB = engine.createDoc('folder-b')
  engine.applyUpdate(folderB, engine.encodeUpdateSince(folderA, null), 'remote')
  const docsB = new Map<string, EngineDoc>()
  for (const [guid, docA] of docsA) {
    const docB = engine.createDoc(`${guid}:b`)
    engine.applyUpdate(docB, engine.encodeUpdateSince(docA, null), 'remote')
    docsB.set(guid, docB)
  }
  const lcaB = new MemLcaStore()
  expect((await joinFolder(engine, adapterB, folderB, docsB, lcaB)).problems).toEqual([])

  const errorsA: string[] = []
  const errorsB: string[] = []
  const mk = (
    adapter: VaultAdapter,
    folderDoc: EngineDoc,
    docs: Map<string, EngineDoc>,
    lcaStore: MemLcaStore,
    errors: string[]
  ): VaultSession =>
    new VaultSession({
      engine,
      adapter,
      lcaStore,
      journal: new MemJournal(() => clock.now()),
      clock,
      folderDoc,
      docs,
      quiesceMs: 10,
      events: { onError: (e) => errors.push(String(e)) },
    })

  const sessionA = mk(adapterA, folderA, docsA, lcaA, errorsA)
  const sessionB = mk(wrapB(adapterB), folderB, docsB, lcaB, errorsB)
  await sessionA.start()
  await sessionB.start()

  const net = new TestNetwork(engine)
  net.addPeer('A', folderA)
  net.addPeer('B', folderB)

  const deliver = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      net.deliverAll()
      await settle()
      clock.advance(100)
      await settle()
    }
  }

  return {
    engine,
    a: { adapter: adapterA, session: sessionA, folder: folderA, docs: docsA, errors: errorsA },
    b: { adapter: adapterB, session: sessionB, folder: folderB, docs: docsB, errors: errorsB },
    net,
    clock,
    deliver,
    dispose: () => {
      sessionA.dispose()
      sessionB.dispose()
    },
  }
}

async function disk(a: MemVaultAdapter): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const stat of await a.list()) out[stat.path] = dec((await a.read(stat.path))!)
  return out
}

/** Every live text key, as `path -> guid`. */
function textKeys(folder: EngineDoc): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [p, e] of folder.getMap().entries()) {
    if (e.kind === 'text' && !e.deleted) out[p] = e.guid
  }
  return out
}

/**
 * A peer creating a note, at the seam a real host uses: the doc appears in
 * the docs map (the host owns doc lifecycle) and the entry appears in the
 * map. `VaultSession` has no create of its own — creation is the host's delta
 * scan — so the fixture writes both halves.
 */
function peerCreates(duo: Duo, guid: string, path: string, text: string): void {
  const docB = duo.engine.createDoc(guid)
  docB.transact((t) => t.insert(0, text), 'remote')
  duo.b.docs.set(guid, docB)
  duo.a.folder.transactMap((m) => m.set(path, { guid, kind: 'text' }), 'local')
}

describe('remote rename of a file this device has not materialized (crasher 0002)', () => {
  it('is not an error: the disk move is skipped and the file lands at the NEW path', async () => {
    const duo = await makeDuo({ 'keep.md': '# keep\n' })
    try {
      peerCreates(duo, 'gnew', 'n1.md', 'hello\n')
      duo.net.deliverAll()
      await settle()
      // NOT advancing the clock is the whole point: B's reconcile for the new
      // guid is scheduled and has not run, so nothing is on B's disk yet.
      expect(await duo.b.adapter.read('n1.md')).toBeNull()

      // …and now the rename arrives, ahead of that materialize.
      const entry = duo.a.folder.getMap().get('n1.md')!
      duo.a.folder.transactMap((m) => {
        m.delete('n1.md')
        m.set('r2.md', entry)
      }, 'local')
      await duo.deliver()

      expect(duo.b.errors).toEqual([])
      expect(dec((await duo.b.adapter.read('r2.md'))!)).toBe('hello\n')
      expect(await duo.b.adapter.read('n1.md')).toBeNull()
      expect(Object.keys(textKeys(duo.b.folder)).sort()).toEqual(['keep.md', 'r2.md'])
    } finally {
      duo.dispose()
    }
  })

  it('one failing entry never skips the rest of the batch', async () => {
    // B's disk refuses to read `a.md`, so the remote DELETE of a.md throws
    // while journaling its pre-image. Before the per-entry try/catch that
    // throw aborted the whole pass, and the delete batched behind it in the
    // same transaction was silently skipped — leaving a file on disk that
    // both maps say is gone.
    const duo = await makeDuo({ 'a.md': '# a\n', 'z.md': '# z\n' }, (base) =>
      Object.create(base, {
        read: {
          value: (p: string) =>
            p === 'a.md' ? Promise.reject(new Error('disk says no')) : base.read(p),
        },
      })
    )
    try {
      const entryA = duo.a.folder.getMap().get('a.md')!
      const entryZ = duo.a.folder.getMap().get('z.md')!
      // `a.md` is key 0 and `z.md` key 1 (enrollment order), so the failing
      // entry really is reached first.
      duo.a.folder.transactMap((m) => {
        m.set('a.md', { ...entryA, deleted: true })
        m.set('z.md', { ...entryZ, deleted: true })
      }, 'local')
      await duo.deliver()

      expect(duo.b.errors.filter((e) => e.includes('disk says no'))).toHaveLength(1)
      // The failing entry did fail — its file is still there…
      expect(await duo.b.adapter.read('a.md')).not.toBeNull()
      // …and the delete that shared its batch still happened.
      expect(await duo.b.adapter.read('z.md')).toBeNull()
    } finally {
      duo.dispose()
    }
  })
})

describe('concurrent renames of one guid (crasher 0004)', () => {
  it('both devices keep the lexicographically greatest path, and converge', async () => {
    const duo = await makeDuo({ 'keep.md': '# keep\n', 'dir/f.md': '# f\n' })
    try {
      duo.net.partition([['A'], ['B']])
      await duo.a.session.renameFile('dir/f.md', 'dir/x.md')
      await duo.b.session.renameFile('dir/f.md', 'dir/y.md')
      duo.net.heal()
      await duo.deliver()

      // 'dir/y.md' > 'dir/x.md', so y survives on BOTH sides — including the
      // one that renamed to x and has to move its own bytes back.
      expect(textKeys(duo.a.folder)).toEqual(textKeys(duo.b.folder))
      expect(Object.keys(textKeys(duo.a.folder)).sort()).toEqual(['dir/y.md', 'keep.md'])
      const guids = Object.values(textKeys(duo.a.folder))
      expect(new Set(guids).size).toBe(guids.length)
      expect(await disk(duo.a.adapter)).toEqual(await disk(duo.b.adapter))
      expect(dec((await duo.a.adapter.read('dir/y.md'))!)).toBe('# f\n')
    } finally {
      duo.dispose()
    }
  })

  it('a dir rename racing a file rename inside it lands on one path too', async () => {
    const duo = await makeDuo({ 'keep.md': '# keep\n', 'dir/f.md': '# f\n' })
    try {
      duo.net.partition([['A'], ['B']])
      await duo.a.session.renameDir('dir', 'moved')
      await duo.b.session.renameFile('dir/f.md', 'dir/g.md')
      duo.net.heal()
      await duo.deliver()

      // 'moved/f.md' > 'dir/g.md'.
      expect(textKeys(duo.a.folder)).toEqual(textKeys(duo.b.folder))
      expect(Object.keys(textKeys(duo.a.folder)).sort()).toEqual(['keep.md', 'moved/f.md'])
      expect(await disk(duo.a.adapter)).toEqual(await disk(duo.b.adapter))
    } finally {
      duo.dispose()
    }
  })
})

describe('a resurrected entry (crasher 0005)', () => {
  it('comes back on the device that deleted it', async () => {
    const duo = await makeDuo({ 'keep.md': '# keep\n', 'other/side.md': '# side\n' })
    try {
      // B deletes the note, and A hears about it.
      await duo.b.session.deleteFile('other/side.md')
      await duo.deliver()
      expect(await duo.b.adapter.read('other/side.md')).toBeNull()
      expect(await duo.a.adapter.read('other/side.md')).toBeNull()

      // A then re-`set`s the SAME key with the SAME guid — which is exactly
      // what an unshare announcement does to every key of its subtree. The
      // re-set is causally after the tombstone, so it wins the key outright
      // (no clientID coin-flip); B is the device under test.
      const entry = { ...duo.a.folder.getMap().get('other/side.md')!, deleted: false }
      duo.a.folder.transactMap((m) => m.set('other/side.md', entry), 'local')
      await duo.deliver()

      expect(duo.b.errors).toEqual([])
      expect(textKeys(duo.b.folder)['other/side.md']).toBeDefined()
      // The restore branch: doc and LCA both survived B's delete, so nothing
      // else in the pass would ever have written these bytes back.
      expect(dec((await duo.b.adapter.read('other/side.md'))!)).toBe('# side\n')
    } finally {
      duo.dispose()
    }
  })

  it('converges when the delete and the re-set are concurrent', async () => {
    // The crasher's own shape. Which side wins the key is a Yjs clientID
    // coin-flip, so the claim is symmetric — whatever the map decides, both
    // devices must agree AND their disks must match it.
    const duo = await makeDuo({ 'keep.md': '# keep\n', 'other/side.md': '# side\n' })
    try {
      duo.net.partition([['A'], ['B']])
      await duo.b.session.deleteFile('other/side.md')
      const entry = duo.a.folder.getMap().get('other/side.md')!
      duo.a.folder.transactMap((m) => m.set('other/side.md', { ...entry }), 'local')
      duo.net.heal()
      await duo.deliver()

      const liveA = textKeys(duo.a.folder)['other/side.md'] !== undefined
      const liveB = textKeys(duo.b.folder)['other/side.md'] !== undefined
      expect(liveA).toBe(liveB)
      const onA = await duo.a.adapter.read('other/side.md')
      const onB = await duo.b.adapter.read('other/side.md')
      expect(onB === null ? null : dec(onB)).toBe(onA === null ? null : dec(onA))
      expect(onB !== null).toBe(liveB)
    } finally {
      duo.dispose()
    }
  })
})
