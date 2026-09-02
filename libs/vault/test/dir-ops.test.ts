/**
 * M3 directory seam: adapter conformance (mem + node) and two-session L1
 * fixtures — empty-dir round trip, dir rename as ONE bulk map txn applied
 * remotely, folder delete with journaled pre-images.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createYjsEngine, type EngineDoc } from '@editor/sync'
import { SimClock, TestNetwork } from '@editor/testkit'
import { enrollFolder, joinFolder } from '../src/enrollment.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { NodeVaultAdapter } from '../src/node-adapter.js'
import { MemJournal, MemLcaStore } from '../src/stores.js'
import { VaultSession } from '../src/session.js'
import type { VaultAdapter } from '../src/types.js'

const enc = (s: string) => new TextEncoder().encode(s)
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

// ---- adapter conformance ----

const tmpRoots: string[] = []
afterAll(async () => {
  for (const root of tmpRoots) await rm(root, { recursive: true, force: true })
})

async function adapters(): Promise<[string, VaultAdapter][]> {
  const root = await mkdtemp(join(tmpdir(), 'editor-dir-ops-'))
  tmpRoots.push(root)
  return [
    ['mem', new MemVaultAdapter()],
    ['node', new NodeVaultAdapter(root)],
  ]
}

describe('VaultAdapter directory ops (conformance: mem + node)', () => {
  it('mkdir/listDirs round-trip incl. parents implied by files', async () => {
    for (const [name, a] of await adapters()) {
      await a.mkdir('empty/deep')
      await a.writeAtomic('docs/x/file.md', enc('x'))
      const dirs = await a.listDirs()
      for (const d of ['empty', 'empty/deep', 'docs', 'docs/x']) {
        expect(dirs, `${name}: ${d}`).toContain(d)
      }
    }
  })

  it('removeDir: empty-only refusal, missing is a no-op', async () => {
    for (const [name, a] of await adapters()) {
      await a.writeAtomic('d/file.md', enc('x'))
      await expect(a.removeDir('d'), `${name}: non-empty must refuse`).rejects.toThrow()
      await a.remove('d/file.md')
      await a.removeDir('d')
      expect(await a.listDirs(), name).not.toContain('d')
      await a.removeDir('never-existed') // no-op, no throw
    }
  })

  it('renameDir moves children; read() of a dir path is null', async () => {
    for (const [name, a] of await adapters()) {
      await a.writeAtomic('old/one.md', enc('1'))
      await a.mkdir('old/emptysub')
      await a.renameDir('old', 'new')
      expect(new TextDecoder().decode((await a.read('new/one.md'))!), name).toBe('1')
      expect(await a.read('old/one.md'), name).toBeNull()
      const dirs = await a.listDirs()
      expect(dirs, name).toContain('new/emptysub')
      expect(dirs, name).not.toContain('old')
      expect(await a.read('new'), `${name}: dir read is null`).toBeNull()
    }
  })
})

// ---- two-session L1 fixtures ----

interface Duo {
  a: { adapter: MemVaultAdapter; session: VaultSession; journal: MemJournal }
  b: { adapter: MemVaultAdapter; session: VaultSession }
  net: TestNetwork
  clock: SimClock
}

/** Two VaultSessions over the same folder doc content, folder-map net only. */
async function makeDuo(seed: Record<string, string>, dirs: string[] = []): Promise<Duo> {
  const engine = createYjsEngine()
  const clock = new SimClock()

  const adapterA = new MemVaultAdapter()
  for (const [p, t] of Object.entries(seed)) await adapterA.writeAtomic(p, enc(t))
  for (const d of dirs) await adapterA.mkdir(d)
  const folderA = engine.createDoc('folder')
  const lcaA = new MemLcaStore()
  let n = 0
  const { docs: docsA } = await enrollFolder(engine, adapterA, folderA, lcaA, () => `g${n++}`)

  const adapterB = new MemVaultAdapter()
  for (const [p, t] of Object.entries(seed)) await adapterB.writeAtomic(p, enc(t))
  for (const d of dirs) await adapterB.mkdir(d)
  const folderB = engine.createDoc('folder-b')
  engine.applyUpdate(folderB, engine.encodeUpdateSince(folderA, null), 'remote')
  const docsB = new Map<string, EngineDoc>()
  for (const [guid, docA] of docsA) {
    const docB = engine.createDoc(`${guid}:b`)
    engine.applyUpdate(docB, engine.encodeUpdateSince(docA, null), 'remote')
    docsB.set(guid, docB)
  }
  const lcaB = new MemLcaStore()
  const { problems } = await joinFolder(engine, adapterB, folderB, docsB, lcaB)
  expect(problems).toEqual([])

  const journalA = new MemJournal(() => clock.now())
  const mk = (
    adapter: MemVaultAdapter,
    folderDoc: EngineDoc,
    docs: Map<string, EngineDoc>,
    lcaStore: MemLcaStore,
    journal: MemJournal
  ) =>
    new VaultSession({
      engine,
      adapter,
      lcaStore,
      journal,
      clock,
      folderDoc,
      docs,
      quiesceMs: 10,
      events: {
        onError: (e) => {
          throw e
        },
      },
    })
  const sessionA = mk(adapterA, folderA, docsA, lcaA, journalA)
  const sessionB = mk(adapterB, folderB, docsB, lcaB, new MemJournal(() => clock.now()))
  await sessionA.start()
  await sessionB.start()

  const net = new TestNetwork(engine)
  net.addPeer('A', folderA)
  net.addPeer('B', folderB)

  return {
    a: { adapter: adapterA, session: sessionA, journal: journalA },
    b: { adapter: adapterB, session: sessionB },
    net,
    clock,
  }
}

async function deliver(duo: Duo): Promise<void> {
  duo.net.deliverAll()
  await settle()
  duo.clock.advance(100)
  await settle()
}

describe('directory sync (L1 fixtures, M3)', () => {
  it('empty dir: created on A, materialized on B; enrolls from disk', async () => {
    const duo = await makeDuo({ 'a.md': 'x' }, ['already/there'])
    // Enrolled from disk: both peers know the seeded empty dir.
    expect(await duo.b.adapter.listDirs()).toContain('already/there')

    await duo.a.session.createDir('fresh/empty')
    expect(await duo.a.adapter.listDirs()).toContain('fresh/empty')
    await deliver(duo)
    expect(await duo.b.adapter.listDirs()).toContain('fresh/empty')

    duo.a.session.dispose()
    duo.b.session.dispose()
  })

  it('dir rename: one bulk txn moves children + empty subdirs on the peer', async () => {
    const duo = await makeDuo({ 'n/one.md': '1', 'n/sub/two.md': '2' })
    await duo.a.session.renameDir('n', 'renamed')

    expect(new TextDecoder().decode((await duo.a.adapter.read('renamed/one.md'))!)).toBe('1')
    await deliver(duo)

    expect(new TextDecoder().decode((await duo.b.adapter.read('renamed/one.md'))!)).toBe('1')
    expect(new TextDecoder().decode((await duo.b.adapter.read('renamed/sub/two.md'))!)).toBe('2')
    expect(await duo.b.adapter.read('n/one.md')).toBeNull()
    const dirsB = await duo.b.adapter.listDirs()
    expect(dirsB).toContain('renamed/sub')
    expect(dirsB).not.toContain('n')

    duo.a.session.dispose()
    duo.b.session.dispose()
  })

  it('folder delete: journaled pre-images, tombstoned for the peer, dirs cleared', async () => {
    const duo = await makeDuo({ 'gone/one.md': '1', 'gone/sub/two.md': '2', 'keep.md': 'k' })
    await duo.a.session.deleteDir('gone')

    // Every file's pre-image was journaled before its bytes were removed.
    expect((await duo.a.journal.latest('gone/one.md'))?.bytes).toBeDefined()
    expect((await duo.a.journal.latest('gone/sub/two.md'))?.bytes).toBeDefined()
    expect(await duo.a.adapter.read('gone/one.md')).toBeNull()

    await deliver(duo)
    expect(await duo.b.adapter.read('gone/one.md')).toBeNull()
    expect(await duo.b.adapter.read('gone/sub/two.md')).toBeNull()
    expect(new TextDecoder().decode((await duo.b.adapter.read('keep.md'))!)).toBe('k')
    expect(await duo.b.adapter.listDirs()).not.toContain('gone')

    duo.a.session.dispose()
    duo.b.session.dispose()
  })

  it('file rename across dirs (move): peer disk follows', async () => {
    const duo = await makeDuo({ 'src/f.md': 'body' }, ['dst'])
    await duo.a.session.renameFile('src/f.md', 'dst/f.md')
    await deliver(duo)
    expect(new TextDecoder().decode((await duo.b.adapter.read('dst/f.md'))!)).toBe('body')
    expect(await duo.b.adapter.read('src/f.md')).toBeNull()
    duo.a.session.dispose()
    duo.b.session.dispose()
  })
})
