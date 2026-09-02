import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@editor/sync'
import { MemJournal, MemLcaStore, MemVaultAdapter } from '@editor/vault'
import { SimClock } from '@editor/testkit'
import { MountSession, type MountSessionConfig } from '../src/mount-session.js'
import type { FileRow, SyncRecordFields } from '../src/types.js'

const enc = new TextEncoder()

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
  const cfg: MountSessionConfig = {
    engine: createYjsEngine(),
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
      onError: (err) => errors.push(err),
    },
  }
  const session = await MountSession.create(cfg)
  /** Record for a path via its (rename-stable) guid — records are guid-keyed (M3). */
  const recordAt = (path: string) => {
    const row = files.find((r) => r.path === path)
    return row ? records.get(row.guid) : undefined
  }
  return { session, adapter, clock, records, errors, files: () => files, recordAt }
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
