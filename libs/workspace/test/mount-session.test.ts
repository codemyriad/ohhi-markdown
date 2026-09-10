import { describe, expect, it } from 'vitest'
import { createYjsEngine, type EngineDoc, type SyncEngine } from '@editor/sync'
import { MemJournal, MemLcaStore, MemVaultAdapter } from '@editor/vault'
import { SimClock } from '@editor/testkit'
import { MountSession, type MountSessionConfig } from '../src/mount-session.js'
import type { FileRow, MountEntryInfo, SyncRecordFields } from '../src/types.js'

const enc = new TextEncoder()
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

/**
 * An engine that remembers the docs it made, so a test can reach the session's
 * private folder doc and play a peer against it (there is no public accessor,
 * and there should not be one).
 */
function tracingEngine(): { engine: SyncEngine; docs: Map<string, EngineDoc> } {
  const base = createYjsEngine()
  const docs = new Map<string, EngineDoc>()
  return {
    engine: {
      ...base,
      createDoc: (guid) => {
        const doc = base.createDoc(guid)
        docs.set(guid, doc)
        return doc
      },
    },
    docs,
  }
}

/** Files + dirs on an adapter — the "not a byte moved" witness. */
async function snapshot(a: MemVaultAdapter): Promise<{ files: Record<string, string>; dirs: string[] }> {
  const files: Record<string, string> = {}
  for (const stat of await a.list()) {
    files[stat.path] = new TextDecoder().decode((await a.read(stat.path))!)
  }
  return { files, dirs: (await a.listDirs()).sort() }
}

function freshRecord(): SyncRecordFields {
  return { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
}

/** Local-mode harness: mem adapter + stores, sim clock, no relay. */
async function bootLocal(seed: Record<string, string>) {
  const adapter = new MemVaultAdapter()
  for (const [path, text] of Object.entries(seed)) {
    await adapter.writeAtomic(path, enc.encode(text))
  }
  const clock = new SimClock()
  const records = new Map<string, SyncRecordFields>()
  let files: FileRow[] = []
  const errors: unknown[] = []
  const mountEmissions: MountEntryInfo[][] = []
  const { engine, docs: engineDocs } = tracingEngine()
  const cfg: MountSessionConfig = {
    engine,
    adapter,
    user: { name: 'Test', color: '#000' },
    room: 'room-1',
    clock,
    lcaStore: new MemLcaStore(),
    journal: new MemJournal(() => clock.now()),
    recordFor: (path) => {
      let rec = records.get(path)
      if (!rec) {
        rec = freshRecord()
        records.set(path, rec)
      }
      return rec
    },
    makeShareLink: (relay, room) => `link:${relay.url}:${room}`,
    events: {
      onFiles: (rows) => {
        files = rows
      },
      onMountEntries: (entries) => mountEmissions.push(entries),
      onError: (err) => errors.push(err),
    },
  }
  const session = await MountSession.create(cfg)
  /** Record for a path via its (rename-stable) guid — records are guid-keyed (M3). */
  const recordAt = (path: string) => {
    const row = files.find((r) => r.path === path)
    return row ? records.get(row.guid) : undefined
  }
  /** The session's own folder doc (room 'room-1'). */
  const folderDoc = (): EngineDoc => engineDocs.get('room-1/folder')!
  return {
    session,
    adapter,
    clock,
    engine,
    records,
    errors,
    mountEmissions,
    folderDoc,
    files: () => files,
    recordAt,
  }
}

/**
 * Replay another peer's carve of `prefix` against this session's folder doc:
 * the exact transaction MountSession.detachSubtree writes (hard-delete the
 * subtree's keys, set the mount entry at its root), delivered as a FOREIGN
 * update the way a relay provider would.
 */
function applyForeignCarve(
  h: { engine: SyncEngine; folderDoc: () => EngineDoc },
  prefix: string,
  mount: { room: string; relay: string }
): void {
  const folder = h.folderDoc()
  const peer = h.engine.createDoc(`peer:${prefix}`)
  h.engine.applyUpdate(peer, h.engine.encodeUpdateSince(folder, null), 'remote')
  peer.transactMap((m) => {
    for (const [p] of m.entries()) {
      if (p === prefix || p.startsWith(`${prefix}/`)) m.delete(p)
    }
    m.set(prefix, { guid: mount.room, kind: 'mount', relay: mount.relay })
  }, 'local')
  h.engine.applyUpdate(folder, h.engine.encodeUpdateSince(peer, null), 'remote')
  peer.destroy()
}

describe('MountSession (local mode)', () => {
  it('enrolls disk files (and their dirs) and emits sorted rows with records', async () => {
    const h = await bootLocal({ 'b.md': 'bee', 'a/nested.md': 'nested' })
    // 'a' enrolls as a first-class dir entry (M3).
    expect(h.files().map((r) => r.path)).toEqual(['a', 'a/nested.md', 'b.md'])
    expect(h.files().find((r) => r.path === 'a')?.kind).toBe('dir')
    expect(h.recordAt('a/nested.md')).toBeDefined()
    expect(h.session.docForPath('b.md')?.getText()).toBe('bee')
    expect(h.errors).toEqual([])
    h.session.dispose()
  })

  it('flushes an open doc edit to disk after the debounce', async () => {
    const h = await bootLocal({ 'note.md': 'v1' })
    h.session.setOpenPath('note.md')
    h.session.docForPath('note.md')!.transact((t) => t.insert(2, '-edited'), 'local')
    h.clock.advance(1000) // FLUSH_DEBOUNCE_MS is 800
    await Promise.resolve() // let the flush promise chain settle
    await new Promise((r) => setTimeout(r, 0))
    expect(new TextDecoder().decode((await h.adapter.read('note.md'))!)).toBe('v1-edited')
    expect(h.recordAt('note.md')!.diskMatchesCrdt).toBe(true)
    h.session.dispose()
  })

  it('creates untitled notes at the root and inside a target dir', async () => {
    const h = await bootLocal({})
    const path = await h.session.createFile()
    expect(path).toBe('untitled-1.md')
    await h.session.createDir('notes')
    const nested = await h.session.createFile('notes')
    expect(nested).toBe('notes/untitled-1.md')
    expect(await h.adapter.read('notes/untitled-1.md')).not.toBeNull()
    expect(h.files().some((r) => r.path === 'notes/untitled-1.md')).toBe(true)
    h.session.dispose()
  })
})

describe('MountSession — nested mount entries (N1, device-link-shaping A2)', () => {
  it('announces a peer\'s carve once, touches no disk, and never re-enrolls the subtree', async () => {
    const h = await bootLocal({
      'keep.md': 'k',
      'team/plan.md': 'plan',
      'team/sub/deep.md': 'deep',
    })
    // Boot always announces the CURRENT set — here, nothing nested yet. That
    // emission is what lets a device adopt a carve it slept through.
    expect(h.mountEmissions).toEqual([[]])
    const before = await snapshot(h.adapter)

    applyForeignCarve(h, 'team', { room: 'carved-room', relay: 'ws://relay.test' })
    await settle()

    // Fired ONCE for the whole transaction, carrying the room and relay.
    expect(h.mountEmissions).toEqual([
      [],
      [{ path: 'team', room: 'carved-room', relay: 'ws://relay.test' }],
    ])
    // The row the tree renders: guid IS the room.
    expect(h.files().filter((r) => r.path.startsWith('team'))).toEqual([
      { path: 'team', guid: 'carved-room', kind: 'mount' },
    ])
    expect(await snapshot(h.adapter)).toEqual(before)

    // The delta scan is the dangerous one: this session's adapter is the RAW
    // adapter (no ignore set yet — the host derives it from this very event),
    // so without the boundary the subtree would re-enroll with fresh guids
    // into the parent map and flow back to the carver.
    await h.session.rescan()
    expect(h.files().filter((r) => r.path.startsWith('team'))).toEqual([
      { path: 'team', guid: 'carved-room', kind: 'mount' },
    ])
    expect(await snapshot(h.adapter)).toEqual(before)
    // Still one announcement: rescan changes nothing about the mount set.
    expect(h.mountEmissions).toHaveLength(2)
    expect(h.errors).toEqual([])
    h.session.dispose()
  })
})
