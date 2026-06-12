/**
 * L1: reconciler round-trip fuzz (shape D9).
 * Two peers, each a full VaultSession over its own in-memory disk, docs
 * synced via TestNetwork frames. fast-check interleaves editor edits,
 * EXTERNAL writer edits (the git/Claude Code/Obsidian stand-in), partial
 * delivery, partitions, and clock advancement.
 *
 * Blocking invariants:
 *  - convergence: review-free files end byte-identical on both disks
 *  - no data loss: every marker survives somewhere (disk/doc/review), always
 *  - idempotence: a quiet extra round produces zero reconcile activity
 *
 * Failures print a fast-check seed; check minimal repros into
 * test/fuzz-crashers/ as directed regression tests (permanent corpus rule).
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createYjsEngine, type EngineDoc, type SyncEngine } from '@editor/sync'
import { SimClock, TestNetwork } from '@editor/testkit'
import { enrollFolder, joinFolder } from '../src/enrollment.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { MemJournal, MemLcaStore } from '../src/stores.js'
import { VaultSession } from '../src/session.js'
import type { DivergenceReview } from '../src/types.js'

const FILES = ['notes/a.md', 'notes/b.md'] as const
const INITIAL: Record<string, string> = {
  'notes/a.md': '# A\n\nalpha base\n',
  'notes/b.md': '# B\n\nbeta base\n',
}

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : '')
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

interface Peer {
  name: 'A' | 'B'
  adapter: MemVaultAdapter
  session: VaultSession
  docs: Map<string, EngineDoc>
  folderDoc: EngineDoc
  guidByPath: Map<string, string>
  reviews: Map<string, DivergenceReview>
  activity: number
}

interface World {
  engine: SyncEngine
  clock: SimClock
  peers: [Peer, Peer]
  nets: TestNetwork[]
  markers: { marker: string; path: string }[]
  seq: number
}

async function makeWorld(): Promise<World> {
  const engine = createYjsEngine()
  const clock = new SimClock()

  // Peer A: seeder.
  const adapterA = new MemVaultAdapter()
  for (const [p, t] of Object.entries(INITIAL)) await adapterA.writeAtomic(p, enc(t))
  const folderA = engine.createDoc('folder')
  const lcaA = new MemLcaStore()
  let n = 0
  const { docs: docsA } = await enrollFolder(engine, adapterA, folderA, lcaA, () => `g${n++}`)

  // Peer B: identical clean copy joins (the git-clone case).
  const adapterB = new MemVaultAdapter()
  for (const [p, t] of Object.entries(INITIAL)) await adapterB.writeAtomic(p, enc(t))
  const folderB = engine.createDoc('folder')
  engine.applyUpdate(folderB, engine.encodeUpdateSince(folderA, null), 'remote')
  const docsB = new Map<string, EngineDoc>()
  for (const [guid, docA] of docsA) {
    const docB = engine.createDoc(guid)
    engine.applyUpdate(docB, engine.encodeUpdateSince(docA, null), 'remote')
    docsB.set(guid, docB)
  }
  const lcaB = new MemLcaStore()
  const { problems } = await joinFolder(engine, adapterB, folderB, docsB, lcaB)
  if (problems.length > 0) throw new Error(`join problems: ${JSON.stringify(problems)}`)

  const mkPeer = (
    name: 'A' | 'B',
    adapter: MemVaultAdapter,
    folderDoc: EngineDoc,
    docs: Map<string, EngineDoc>,
    lcaStore: MemLcaStore
  ): Peer => {
    const peer: Partial<Peer> = { name, adapter, docs, folderDoc }
    peer.reviews = new Map()
    peer.activity = 0
    peer.guidByPath = new Map(
      folderDoc.getMap().entries().filter(([, e]) => e.kind === 'text').map(([p, e]) => [p, e.guid])
    )
    peer.session = new VaultSession({
      engine,
      adapter,
      lcaStore,
      journal: new MemJournal(() => clock.now()),
      clock,
      folderDoc,
      docs,
      quiesceMs: 10,
      events: {
        onReview: (r) => peer.reviews!.set(r.guid, r),
        onReviewCleared: (g) => peer.reviews!.delete(g),
        onActivity: () => peer.activity!++,
        onError: (e) => {
          throw e
        },
      },
    })
    return peer as Peer
  }

  const peerA = mkPeer('A', adapterA, folderA, docsA, lcaA)
  const peerB = mkPeer('B', adapterB, folderB, docsB, lcaB)
  await peerA.session.start()
  await peerB.session.start()

  // One TestNetwork per logical doc (folder + each file).
  const nets: TestNetwork[] = []
  const netFolder = new TestNetwork(engine)
  netFolder.addPeer('A', folderA)
  netFolder.addPeer('B', folderB)
  nets.push(netFolder)
  for (const [guid, docA] of docsA) {
    const net = new TestNetwork(engine)
    net.addPeer('A', docA)
    net.addPeer('B', docsB.get(guid)!)
    nets.push(net)
  }

  return { engine, clock, peers: [peerA, peerB], nets, markers: [], seq: 0 }
}

type Cmd =
  | { kind: 'editorEdit'; peer: 0 | 1; file: 0 | 1; pos: number }
  | { kind: 'externalEdit'; peer: 0 | 1; file: 0 | 1 }
  | { kind: 'deliver'; count: number }
  | { kind: 'partition' }
  | { kind: 'heal' }
  | { kind: 'tick'; ms: number }

const cmdArb: fc.Arbitrary<Cmd> = fc.oneof(
  { weight: 4, arbitrary: fc.record({
      kind: fc.constant('editorEdit' as const),
      peer: fc.constantFrom(0 as const, 1 as const),
      file: fc.constantFrom(0 as const, 1 as const),
      pos: fc.nat({ max: 500 }),
    }) },
  { weight: 3, arbitrary: fc.record({
      kind: fc.constant('externalEdit' as const),
      peer: fc.constantFrom(0 as const, 1 as const),
      file: fc.constantFrom(0 as const, 1 as const),
    }) },
  { weight: 4, arbitrary: fc.record({
      kind: fc.constant('deliver' as const),
      count: fc.integer({ min: 1, max: 6 }),
    }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'partition' as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'heal' as const }) },
  { weight: 3, arbitrary: fc.record({
      kind: fc.constant('tick' as const),
      ms: fc.integer({ min: 5, max: 120 }),
    }) }
)

async function runCmd(world: World, cmd: Cmd): Promise<void> {
  const { peers, nets, clock } = world
  switch (cmd.kind) {
    case 'editorEdit': {
      const peer = peers[cmd.peer]
      const path = FILES[cmd.file]
      const guid = peer.guidByPath.get(path)!
      const doc = peer.docs.get(guid)!
      const marker = `[m${world.seq++}-${peer.name}]`
      const text = doc.getText()
      // Insert at a line boundary to keep markers intact under merges.
      const nl = text.indexOf('\n', cmd.pos % Math.max(1, text.length))
      const at = nl === -1 ? text.length : nl + 1
      doc.transact((t) => t.insert(at, `${marker}\n`), 'local')
      world.markers.push({ marker, path })
      await peer.session.flush(guid)
      break
    }
    case 'externalEdit': {
      const peer = peers[cmd.peer]
      const path = FILES[cmd.file]
      const marker = `[x${world.seq++}-${peer.name}]`
      const current = dec(await peer.adapter.read(path))
      peer.adapter.externalWrite(path, enc(current + `${marker}\n`))
      world.markers.push({ marker, path })
      await settle()
      break
    }
    case 'deliver':
      for (const net of nets) for (let i = 0; i < cmd.count; i++) net.deliverOne()
      await settle()
      break
    case 'partition':
      for (const net of nets) net.partition([['A'], ['B']])
      break
    case 'heal':
      for (const net of nets) net.heal()
      break
    case 'tick':
      clock.advance(cmd.ms)
      await settle()
      break
  }
}

async function stabilize(world: World): Promise<void> {
  const { peers, nets, clock } = world
  for (const net of nets) net.heal()
  for (let round = 0; round < 8; round++) {
    for (const peer of peers) {
      for (const [path, guid] of peer.guidByPath) {
        if (![...peer.reviews.values()].some((r) => r.path === path)) {
          await peer.session.flush(guid)
        }
      }
    }
    for (const net of nets) net.deliverAll()
    await settle()
    clock.advance(300)
    await settle()
    clock.advance(300)
    await settle()
  }
}

function reviewedPaths(world: World): Set<string> {
  const out = new Set<string>()
  for (const peer of world.peers)
    for (const r of peer.reviews.values()) out.add(r.path)
  return out
}

describe('L1 reconciler fuzz', () => {
  it('two sessions + external writers: convergence, no loss, idempotence', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cmdArb, { minLength: 1, maxLength: 40 }), async (cmds) => {
        const world = await makeWorld()
        try {
          for (const cmd of cmds) await runCmd(world, cmd)
          await stabilize(world)

          const reviewed = reviewedPaths(world)
          const [a, b] = world.peers

          // Convergence on review-free files.
          for (const path of FILES) {
            if (reviewed.has(path)) continue
            const da = dec(await a.adapter.read(path))
            const db = dec(await b.adapter.read(path))
            if (da !== db) {
              throw new Error(`disks diverged without review on ${path}:\nA:${da}\nB:${db}`)
            }
            // Disk reflects CRDT state.
            const guid = a.guidByPath.get(path)!
            expect(da).toBe(a.docs.get(guid)!.getText())
          }

          // No data loss, anywhere, ever: every marker is still visible in
          // some surface (disk, doc, or pending review) of some peer.
          for (const { marker, path } of world.markers) {
            let found = false
            for (const peer of world.peers) {
              const guid = peer.guidByPath.get(path)!
              const surfaces = [
                dec(await peer.adapter.read(path)),
                peer.docs.get(guid)!.getText(),
                ...[...peer.reviews.values()]
                  .filter((r) => r.path === path)
                  .flatMap((r) => [r.mine, r.theirs]),
              ]
              if (surfaces.some((s) => s.includes(marker))) {
                found = true
                break
              }
            }
            if (!found) throw new Error(`marker ${marker} lost from ${path}`)
          }

          // Idempotence: a quiet extra stabilization does nothing.
          a.activity = 0
          b.activity = 0
          await stabilize(world)
          expect(a.activity + b.activity).toBe(0)
        } finally {
          for (const peer of world.peers) peer.session.dispose()
          for (const net of world.nets) net.destroy()
        }
      }),
      { numRuns: 25 }
    )
  }, 120_000)
})
