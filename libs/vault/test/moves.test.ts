/**
 * `WatchEvent.moves` (nextcloud-build decision 11): a rename the WATCHER saw
 * rebinds the guid — the folder-map key, the LCA path and the journal history
 * follow the file — with no disk operation of the session's own, instead of a
 * vanished review at `from` and a fresh file at `to`.
 *
 * Two-session shape of `remote-map-races.test.ts`: A is the session under
 * test (its adapter can emit `moves`, like the WebDAV watcher does), B is a
 * peer that sees the rename only through the folder map.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine, type EngineDoc, type SyncEngine } from '@ohhi/sync'
import { SimClock, TestNetwork } from '@ohhi/testkit'
import { enrollFolder, joinFolder } from '../src/enrollment.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { MemJournal, MemLcaStore } from '../src/stores.js'
import { VaultSession } from '../src/session.js'
import { OHHI_HOST_MARKER, type WatchEvent } from '../src/types.js'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

/** A MemVaultAdapter whose test can deliver a watch event carrying `moves`. */
class MovingMemAdapter extends MemVaultAdapter {
  private cbs = new Set<(ev: WatchEvent) => void>()
  /** Every rename/renameDir/remove the session itself asked for. */
  readonly ops: string[] = []
  override watch(cb: (ev: WatchEvent) => void): () => void {
    this.cbs.add(cb)
    const off = super.watch(cb)
    return () => {
      this.cbs.delete(cb)
      off()
    }
  }
  override async rename(from: string, to: string): Promise<void> {
    this.ops.push(`rename ${from} ${to}`)
    await super.rename(from, to)
  }
  override async renameDir(from: string, to: string): Promise<void> {
    this.ops.push(`renameDir ${from} ${to}`)
    await super.renameDir(from, to)
  }
  override async remove(path: string): Promise<void> {
    this.ops.push(`remove ${path}`)
    await super.remove(path)
  }
  /** An external mover (a sync client, WebDAV MOVE): bytes move, no event. */
  async moveQuietly(from: string, to: string): Promise<void> {
    this.autoEmit = false
    try {
      if ((await this.read(from)) !== null) await super.rename(from, to)
      else await super.renameDir(from, to)
    } finally {
      this.autoEmit = true
    }
  }
  /** An external writer whose change only the next watch event reports. */
  async writeQuietly(path: string, bytes: Uint8Array): Promise<void> {
    this.autoEmit = false
    try {
      await super.writeAtomic(path, bytes)
    } finally {
      this.autoEmit = true
    }
  }
  emitEvent(ev: WatchEvent): void {
    for (const cb of this.cbs) cb(ev)
  }
}

interface Side {
  adapter: MovingMemAdapter
  session: VaultSession
  folder: EngineDoc
  docs: Map<string, EngineDoc>
  lca: MemLcaStore
  journal: MemJournal
  errors: string[]
  renamed: { from: string; to: string }[]
  breakers: string[][]
}

async function makeDuo(seed: Record<string, string>): Promise<{
  engine: SyncEngine
  a: Side
  b: Side
  deliver: () => Promise<void>
  dispose: () => void
}> {
  const engine = createYjsEngine()
  const clock = new SimClock()

  const adapterA = new MovingMemAdapter()
  for (const [p, t] of Object.entries(seed)) await adapterA.writeAtomic(p, enc(t))
  const folderA = engine.createDoc('folder')
  const lcaA = new MemLcaStore()
  let n = 0
  const { docs: docsA } = await enrollFolder(engine, adapterA, folderA, lcaA, () => `g${n++}`)

  const adapterB = new MovingMemAdapter()
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

  const mk = (adapter: MovingMemAdapter, folder: EngineDoc, docs: Map<string, EngineDoc>, lca: MemLcaStore): Side => {
    const errors: string[] = []
    const renamed: { from: string; to: string }[] = []
    const breakers: string[][] = []
    const journal = new MemJournal(() => clock.now())
    const session = new VaultSession({
      engine,
      adapter,
      lcaStore: lca,
      journal,
      clock,
      folderDoc: folder,
      docs,
      quiesceMs: 10,
      events: {
        onError: (e) => errors.push(String(e)),
        onPathsRenamed: (moves) => renamed.push(...moves),
        onBreaker: (paths) => breakers.push(paths),
      },
    })
    return { adapter, session, folder, docs, lca, journal, errors, renamed, breakers }
  }
  const a = mk(adapterA, folderA, docsA, lcaA)
  const b = mk(adapterB, folderB, docsB, lcaB)
  await a.session.start()
  await b.session.start()

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
    a,
    b,
    deliver,
    dispose: () => {
      a.session.dispose()
      b.session.dispose()
    },
  }
}

const keys = (folder: EngineDoc): Record<string, string> =>
  Object.fromEntries(
    folder
      .getMap()
      .entries()
      .filter(([, e]) => !e.deleted)
      .map(([p, e]) => [p, e.guid])
  )

async function disk(a: MemVaultAdapter): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const stat of await a.list()) out[stat.path] = dec((await a.read(stat.path))!)
  return out
}

describe('VaultSession — watched moves (decision 11)', () => {
  it('rebinds the guid, LCA and journal with no disk op, and a peer sees the rename', async () => {
    const duo = await makeDuo({ 'a.md': 'alpha\n', 'b.md': 'beta\n' })
    const { a, b } = duo
    const guid = keys(a.folder)['a.md']!
    await a.journal.record('a.md', enc('older alpha\n'))

    await a.adapter.moveQuietly('a.md', 'notes/renamed.md')
    a.adapter.emitEvent({
      paths: ['a.md', 'notes/renamed.md'],
      moves: [{ from: 'a.md', to: 'notes/renamed.md' }],
    })
    await duo.deliver()

    expect(keys(a.folder)['notes/renamed.md']).toBe(guid)
    expect(keys(a.folder)['a.md']).toBeUndefined()
    expect((await a.lca.get(guid))?.path).toBe('notes/renamed.md')
    expect((await a.journal.list('notes/renamed.md')).length).toBe(1)
    expect(await a.journal.list('a.md')).toEqual([])
    expect(a.adapter.ops).toEqual([]) // the move already happened on disk
    expect(a.renamed).toEqual([{ from: 'a.md', to: 'notes/renamed.md' }])
    expect(a.session.pendingReviews()).toEqual([])
    expect(a.errors).toEqual([])

    // The peer applies an ordinary remote rename through the map.
    expect(keys(b.folder)['notes/renamed.md']).toBe(guid)
    expect(await disk(b.adapter)).toEqual({ 'notes/renamed.md': 'alpha\n', 'b.md': 'beta\n' })
    expect(b.renamed).toEqual([{ from: 'a.md', to: 'notes/renamed.md' }])
    expect(b.session.pendingReviews()).toEqual([])

    // The doc is still bound at its new path: an edit there ingests.
    await a.adapter.writeAtomic('notes/renamed.md', enc('alpha edited\n'))
    await duo.deliver()
    expect(a.docs.get(guid)!.getText()).toBe('alpha edited\n')
    duo.dispose()
  })

  it('rebinds every child of a directory move, also when children are reported too', async () => {
    const duo = await makeDuo({ 'd/x.md': 'x\n', 'd/sub/y.md': 'y\n', 'z.md': 'z\n' })
    const { a, b } = duo
    const gx = keys(a.folder)['d/x.md']!
    const gy = keys(a.folder)['d/sub/y.md']!

    await a.adapter.moveQuietly('d', 'e')
    a.adapter.emitEvent({
      paths: ['d', 'e', 'd/x.md', 'e/x.md', 'd/sub/y.md', 'e/sub/y.md'],
      moves: [
        { from: 'd', to: 'e' },
        { from: 'd/x.md', to: 'e/x.md' }, // the adapter also reports a child
      ],
    })
    await duo.deliver()

    const ka = keys(a.folder)
    expect(ka['e/x.md']).toBe(gx)
    expect(ka['e/sub/y.md']).toBe(gy)
    expect(ka['e']).toBeDefined()
    expect(ka['e/sub']).toBeDefined()
    expect(Object.keys(ka).some((p) => p === 'd' || p.startsWith('d/'))).toBe(false)
    expect((await a.lca.get(gy))?.path).toBe('e/sub/y.md')
    expect(a.adapter.ops).toEqual([])
    expect(a.session.pendingReviews()).toEqual([])
    expect(a.errors).toEqual([])

    expect(await disk(b.adapter)).toEqual({ 'e/x.md': 'x\n', 'e/sub/y.md': 'y\n', 'z.md': 'z\n' })
    expect(b.session.pendingReviews()).toEqual([])
    duo.dispose()
  })

  it('refuses a move to an unsafe or reserved path; the source is a plain change', async () => {
    const duo = await makeDuo({ 'a.md': 'alpha\n', 'b.md': 'beta\n' })
    const { a } = duo
    const guid = keys(a.folder)['a.md']!

    await a.adapter.moveQuietly('a.md', OHHI_HOST_MARKER)
    a.adapter.emitEvent({ paths: ['a.md'], moves: [{ from: 'a.md', to: OHHI_HOST_MARKER }] })
    a.adapter.emitEvent({ paths: [], moves: [{ from: 'b.md', to: '../escape.md' }] })
    await duo.deliver()

    expect(a.errors.filter((e) => e.includes('refused watched move'))).toHaveLength(2)
    const ka = keys(a.folder)
    expect(ka[OHHI_HOST_MARKER]).toBeUndefined()
    expect(ka['../escape.md']).toBeUndefined()
    expect(ka['a.md']).toBe(guid)
    expect(a.renamed).toEqual([])
    // a.md is gone from disk: the plain change raises the ordinary vanished review.
    expect(a.session.pendingReviews().map((r) => [r.path, r.reason])).toEqual([['a.md', 'vanished']])
    duo.dispose()
  })

  it('a move of an unmapped source is ignored without a live-enrol hook', async () => {
    const duo = await makeDuo({ 'a.md': 'alpha\n' })
    const { a } = duo
    a.adapter.autoEmit = false
    await a.adapter.writeAtomic('new.md', enc('n\n'))
    await a.adapter.moveQuietly('new.md', 'moved.md')
    a.adapter.emitEvent({ paths: ['moved.md'], moves: [{ from: 'new.md', to: 'moved.md' }] })
    await duo.deliver()
    expect(keys(a.folder)['moved.md']).toBeUndefined()
    expect(a.errors).toEqual([])
    duo.dispose()
  })

  it('moves count toward the mass-change breaker: rebound at once, content held until confirmed (nextcloud-build R1 #6)', async () => {
    const seed: Record<string, string> = {}
    for (let i = 0; i < 25; i++) seed[`n${i}.md`] = `note ${i}\n`
    const duo = await makeDuo(seed)
    const { a } = duo
    const guids = keys(a.folder)
    // One walk: every note renamed AND rewritten (ransomware's shape).
    const moves = Object.keys(seed).map((p) => ({ from: p, to: `enc/${p}` }))
    for (const { from, to } of moves) {
      await a.adapter.moveQuietly(from, to)
      await a.adapter.writeQuietly(to, enc('ENCRYPTED\n'))
    }
    a.adapter.emitEvent({ paths: moves.flatMap((m) => [m.from, m.to]), moves })
    await duo.deliver()

    expect(a.breakers).toHaveLength(1)
    expect(a.breakers[0]!.sort()).toEqual(moves.map((m) => m.to).sort())
    // Rebound (harmless), not ingested.
    for (const { from, to } of moves) expect(keys(a.folder)[to]).toBe(guids[from])
    for (const { from } of moves) expect(a.docs.get(guids[from]!)!.getText()).not.toContain('ENCRYPTED')

    await a.session.confirmPendingBatch()
    await duo.deliver()
    for (const { from } of moves) expect(a.docs.get(guids[from]!)!.getText()).toBe('ENCRYPTED\n')
    duo.dispose()
  })
})
