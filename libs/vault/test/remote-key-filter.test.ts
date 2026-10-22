/**
 * `VaultSession.onRemoteMapChange` refuses an unsafe key (nextcloud-build
 * decision 12). The folder map is client-writable CRDT state: a peer can set
 * `../evil.md`, `.obsidian/plugins/x/main.js` or the reserved marker, and
 * without this filter the session would materialize them as the owner.
 *
 * One-direction duo in the shape of `remote-map-races.test.ts`: A is the
 * session under test, B is "a peer" writing keys into the shared map.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine, type EngineDoc } from '@ohhi/sync'
import { SimClock, TestNetwork } from '@ohhi/testkit'
import { enrollFolder, joinFolder } from '../src/enrollment.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { MemJournal, MemLcaStore } from '../src/stores.js'
import { VaultSession } from '../src/session.js'
import { isSafeVaultPath, OHHI_HOST_MARKER } from '../src/types.js'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

describe('isSafeVaultPath', () => {
  it('accepts ordinary vault paths', () => {
    for (const p of ['a.md', 'notes/a.md', 'deep/er/path with spaces.md', 'ünïcode/ñ.md', '50% done.md']) {
      expect(isSafeVaultPath(p), p).toBe(true)
    }
  })
  it('refuses escapes, ignored dirs and the reserved marker', () => {
    for (const p of [
      '',
      '/abs.md',
      'trailing/',
      '../evil.md',
      'a/../../evil.md',
      'a/./b.md',
      'a//b.md',
      'a\\b.md',
      'a\0b.md',
      'a%2e%2e/b.md',
      '.git/hooks/pre-commit',
      '.obsidian/plugins/x/main.js',
      'x/.ohhi/layouts/l.json',
      OHHI_HOST_MARKER,
    ]) {
      expect(isSafeVaultPath(p), JSON.stringify(p)).toBe(false)
    }
    // Not root-level: an ordinary note.
    expect(isSafeVaultPath(`notes/${OHHI_HOST_MARKER}`)).toBe(true)
  })
})

describe('VaultSession refuses unsafe remote map keys', () => {
  it('drops the unsafe key, reports it once, and still materializes the safe one', async () => {
    const engine = createYjsEngine()
    const clock = new SimClock()
    const adapterA = new MemVaultAdapter()
    await adapterA.writeAtomic('seed.md', enc('seed\n'))
    const folderA = engine.createDoc('folder-a')
    const lcaA = new MemLcaStore()
    let n = 0
    const { docs: docsA } = await enrollFolder(engine, adapterA, folderA, lcaA, () => `g${n++}`)
    // The host owns doc lifecycle: pre-create the docs the peer's keys will name.
    const evilDoc: EngineDoc = engine.createDoc('g-evil')
    evilDoc.transact((t) => t.insert(0, 'evil\n'), 'remote')
    docsA.set('g-evil', evilDoc)
    const okDoc: EngineDoc = engine.createDoc('g-ok')
    okDoc.transact((t) => t.insert(0, 'hello\n'), 'remote')
    docsA.set('g-ok', okDoc)

    const errors: string[] = []
    const session = new VaultSession({
      engine,
      adapter: adapterA,
      lcaStore: lcaA,
      journal: new MemJournal(() => clock.now()),
      clock,
      folderDoc: folderA,
      docs: docsA,
      quiesceMs: 10,
      events: { onError: (e) => errors.push(String(e)) },
    })
    await session.start()

    // "A peer": a second copy of the folder map, wired through the test net.
    const folderB = engine.createDoc('folder-b')
    engine.applyUpdate(folderB, engine.encodeUpdateSince(folderA, null), 'remote')
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

    folderB.getMap().set('../evil.md', { guid: 'g-evil', kind: 'text' })
    folderB.getMap().set(OHHI_HOST_MARKER, { guid: 'g-evil', kind: 'text' })
    folderB.getMap().set('notes/ok.md', { guid: 'g-ok', kind: 'text' })
    await deliver()
    await deliver()

    const paths = (await adapterA.list()).map((f) => f.path).sort()
    expect(paths).toEqual(['notes/ok.md', 'seed.md'])
    expect(dec((await adapterA.read('notes/ok.md'))!)).toBe('hello\n')
    expect(await adapterA.read('../evil.md')).toBeNull()
    expect(await adapterA.read(OHHI_HOST_MARKER)).toBeNull()
    const refusals = errors.filter((e) => e.includes('refused unsafe folder-map key'))
    expect(refusals).toHaveLength(2)
    expect(refusals.join('\n')).toContain('../evil.md')
    expect(refusals.join('\n')).toContain(OHHI_HOST_MARKER)

    // A later, unrelated change does not re-report the same keys.
    folderB.getMap().set('notes/later.md', { guid: 'g-ok', kind: 'text' })
    await deliver()
    expect(errors.filter((e) => e.includes('refused unsafe folder-map key'))).toHaveLength(2)

    session.dispose()
  })
})

/**
 * Review R1 #1: the live filter alone left the boot and join paths open. A key
 * a peer set while the custodian refused it stays in the CRDT map; a restart
 * (reopen) or a lost store (first join) must not bind it either.
 */
describe('unsafe keys already in the map at boot', () => {
  const UNSAFE = ['.obsidian/plugins/x/main.js', '../evil.md'] as const

  async function boot(mode: 'reopen' | 'first-join') {
    const engine = createYjsEngine()
    const clock = new SimClock()
    const adapter = new MemVaultAdapter()
    const folder = engine.createDoc('folder')
    const lca = new MemLcaStore()
    const docs = new Map<string, EngineDoc>()
    const put = (guid: string, path: string, text: string) => {
      const d = engine.createDoc(guid)
      d.transact((t) => t.insert(0, text), 'remote')
      docs.set(guid, d)
      folder.transactMap((m) => m.set(path, { guid, kind: 'text' }), 'remote')
    }
    put('g-ok', 'ok.md', 'ok\n')
    put('g-plugin', UNSAFE[0], 'alert(1)\n')
    put('g-evil', UNSAFE[1], 'evil\n')
    if (mode === 'first-join') {
      const { problems } = await joinFolder(engine, adapter, folder, docs, lca)
      expect(problems).toEqual([])
      expect(await lca.get('g-plugin')).toBeNull()
      expect(await lca.get('g-evil')).toBeNull()
    }
    const errors: string[] = []
    const session = new VaultSession({
      engine,
      adapter,
      lcaStore: lca,
      journal: new MemJournal(() => clock.now()),
      clock,
      folderDoc: folder,
      docs,
      quiesceMs: 10,
      events: { onError: (e) => errors.push(String(e)) },
    })
    await session.start()
    // Every doc reconciles (the boot pass), then the peer edits the unsafe docs.
    for (const guid of docs.keys()) await session.markClosed(guid)
    for (const g of ['g-plugin', 'g-evil']) docs.get(g)!.transact((t) => t.insert(0, 'more '), 'remote')
    for (let i = 0; i < 4; i++) {
      clock.advance(100)
      await settle()
    }
    for (const guid of docs.keys()) await session.markClosed(guid)
    return { adapter, errors, session }
  }

  for (const mode of ['reopen', 'first-join'] as const) {
    it(`${mode}: writes nothing at an unsafe key and reports each once`, async () => {
      const { adapter, errors, session } = await boot(mode)
      for (const p of UNSAFE) expect(await adapter.read(p), p).toBeNull()
      if (mode === 'first-join') expect(dec((await adapter.read('ok.md'))!)).toBe('ok\n')
      const refusals = errors.filter((e) => e.includes('refused unsafe folder-map key'))
      expect(refusals).toHaveLength(2)
      session.dispose()
    })
  }
})
