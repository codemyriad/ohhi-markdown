/**
 * Watched moves through a MountSession (nextcloud-build decision 11): a
 * `WatchEvent.moves` rename keeps the note's guid and history, the session
 * makes no disk operation of its own, and a view holding the note stays bound
 * to the same doc at the new path — its next edit flushes THERE.
 *
 * Built directly on `MountSession.create` (the boot-machine shape) rather than
 * `bootVault`, whose root adapter is the `ignoringAdapter` view.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { MemStoreDir, MemVaultAdapter, type WatchEvent } from '@ohhi/vault'
import { SimClock } from '@ohhi/testkit'
import { MountSession } from '../src/mount-session.js'
import { createMountStores } from '../src/mount-stores.js'
import { dec, enc, freshRecord, yieldMacro } from './fixture.js'
import type { SyncRecordFields } from '../src/types.js'

const ROOM = 'room-1'

class MovingMemAdapter extends MemVaultAdapter {
  private cbs = new Set<(ev: WatchEvent) => void>()
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
  /** The external move (a sync client, a WebDAV MOVE): bytes move, then ONE event. */
  async externalMove(from: string, to: string): Promise<void> {
    this.autoEmit = false
    try {
      await super.rename(from, to)
    } finally {
      this.autoEmit = true
    }
    for (const cb of this.cbs) cb({ paths: [from, to], moves: [{ from, to }] })
  }
}

async function boot(files: Record<string, string>) {
  const adapter = new MovingMemAdapter()
  for (const [p, t] of Object.entries(files)) await adapter.writeAtomic(p, enc.encode(t))
  const engine = createYjsEngine()
  const clock = new SimClock()
  const stores = createMountStores(engine, new MemStoreDir(), ROOM, clock)
  const errors: unknown[] = []
  const renamed: { from: string; to: string }[] = []
  const records = new Map<string, SyncRecordFields>()
  const session = await MountSession.create({
    engine,
    adapter,
    user: { name: 'Test', color: '#000' },
    room: ROOM,
    clock,
    lcaStore: stores.lcaStore,
    journal: stores.journal,
    docStore: stores.docStore,
    recordFor: (key) => {
      let rec = records.get(key)
      if (!rec) records.set(key, (rec = freshRecord()))
      return rec
    },
    makeShareLink: (relay, room) => `link:${relay.url}:${room}`,
    events: {
      onError: (err) => errors.push(err),
      onPathsRenamed: (moves) => renamed.push(...moves),
    },
  })
  const tick = async (ms: number): Promise<void> => {
    clock.advance(ms)
    for (let i = 0; i < 6; i++) await yieldMacro()
  }
  return { adapter, session, stores, errors, renamed, tick }
}

describe('MountSession — watched moves (decision 11)', () => {
  it('a rename via moves keeps the guid and the history, with no disk op', async () => {
    const { adapter, session, stores, errors, renamed, tick } = await boot({ 'a.md': 'alpha\n', 'b.md': 'beta\n' })
    try {
      const guid = session.files().find((r) => r.path === 'a.md')!.guid
      await stores.journal.record('a.md', enc.encode('older alpha\n'))
      adapter.ops.length = 0

      await adapter.externalMove('a.md', 'archive/a.md')
      await tick(500)

      const moved = session.files().find((r) => r.path === 'archive/a.md')
      expect(moved?.guid).toBe(guid)
      expect(session.files().some((r) => r.path === 'a.md')).toBe(false)
      expect((await session.fileHistory('archive/a.md')).length).toBe(1)
      expect(await session.fileHistory('a.md')).toEqual([])
      expect((await stores.lcaStore.get(guid))?.path).toBe('archive/a.md')
      expect(renamed).toEqual([{ from: 'a.md', to: 'archive/a.md' }])
      expect(adapter.ops).toEqual([])
      expect(errors).toEqual([])
    } finally {
      session.dispose()
    }
  })

  it('an open doc stays bound across the move and flushes to the new path', async () => {
    const { adapter, session, errors, tick } = await boot({ 'a.md': 'alpha\n' })
    try {
      session.setOpenPaths(new Set(['a.md']))
      const doc = session.docForPath('a.md')!

      await adapter.externalMove('a.md', 'b.md')
      await tick(100)
      expect(session.docForPath('b.md')).toBe(doc)
      // The shell's onPathsRenamed hook re-derives the held set.
      session.setOpenPaths(new Set(['b.md']))

      doc.transact((t) => t.insert(0, 'mine '), 'local')
      await tick(1000)
      expect(dec.decode((await adapter.read('b.md'))!)).toBe('mine alpha\n')
      expect(await adapter.read('a.md')).toBeNull()
      expect(session.files().map((r) => r.path)).toEqual(['b.md'])
      expect(errors).toEqual([])
    } finally {
      session.dispose()
    }
  })
})
