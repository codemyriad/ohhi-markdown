import { describe, expect, it } from 'vitest'
import { MemStoreDir } from '../src/store-dir.js'
import {
  isRecoverable,
  MountsFile,
  mountRootsFrom,
  type MountDesc,
} from '../src/mounts-file.js'
import type { FileEntry } from '@editor/sync'

const desc = (over: Partial<MountDesc>): MountDesc => ({
  room: 'room-1',
  path: '',
  provenance: 'local',
  status: 'active',
  ...over,
})

describe('MountsFile', () => {
  it('starts empty and round-trips upserts through the underlying io', async () => {
    const dir = new MemStoreDir()
    const mounts = new MountsFile(dir.io('mounts.json'))
    expect(await mounts.load()).toEqual([])

    await mounts.upsert(desc({}))
    await mounts.upsert(desc({ room: 'room-2', path: 'shared/bd', provenance: 'carved' }))
    // Re-read through a FRESH instance over the same bytes — durability, not cache.
    const reread = new MountsFile(dir.io('mounts.json'))
    const loaded = await reread.load()
    expect(loaded).toHaveLength(2)
    expect(loaded.map((m) => m.room).sort()).toEqual(['room-1', 'room-2'])
  })

  it('upsert replaces by room; setStatus transitions one mount', async () => {
    const dir = new MemStoreDir()
    const mounts = new MountsFile(dir.io('mounts.json'))
    await mounts.upsert(desc({ room: 'r', status: 'carving:seeding', provenance: 'carved' }))
    await mounts.setStatus('r', 'carving:detaching')
    await mounts.setStatus('r', 'active')
    const [only] = await mounts.load()
    expect(only!.status).toBe('active')
    await mounts.upsert(desc({ room: 'r', path: 'moved' }))
    const after = await mounts.load()
    expect(after).toHaveLength(1)
    expect(after[0]!.path).toBe('moved')
  })

  it('setStatus on an unknown room rejects', async () => {
    const mounts = new MountsFile(new MemStoreDir().io('mounts.json'))
    await expect(mounts.setStatus('ghost', 'active')).rejects.toThrow(/unknown mount/)
  })

  it('removeMount drops the entry', async () => {
    const mounts = new MountsFile(new MemStoreDir().io('mounts.json'))
    await mounts.upsert(desc({ room: 'a' }))
    await mounts.upsert(desc({ room: 'b', path: 'x' }))
    await mounts.removeMount('a')
    expect((await mounts.load()).map((m) => m.room)).toEqual(['b'])
  })

  it('recover() classifies interrupted statuses per the spike S8 tables', async () => {
    const mounts = new MountsFile(new MemStoreDir().io('mounts.json'))
    await mounts.upsert(desc({ room: 'ok', status: 'active' }))
    await mounts.upsert(desc({ room: 'cs', status: 'carving:seeding', provenance: 'carved' }))
    await mounts.upsert(desc({ room: 'cd', status: 'carving:detaching', provenance: 'carved' }))
    await mounts.upsert(desc({ room: 'j', status: 'joining', provenance: 'joined' }))
    await mounts.upsert(desc({ room: 'ua', status: 'unsharing:absorbing', provenance: 'carved' }))
    await mounts.upsert(desc({ room: 'ud', status: 'unsharing:disconnecting', provenance: 'carved' }))

    const byRoom = Object.fromEntries((await mounts.recover()).map((r) => [r.desc.room, r.action]))
    expect(byRoom).toEqual({
      cs: 'rollback', // carve crashed before detach: parent untouched, derived store rolls back
      cd: 'rollforward', // detach began: finish removing the parent copy
      j: 'rollback', // nothing under the destination yet
      ua: 'rollforward', // absorb set-ops are idempotent
      ud: 'rollforward',
    })
    // Active mounts never appear in recovery.
    expect(byRoom['ok']).toBeUndefined()
  })

  it('classifies the peer-side adopt statuses, and never recovers needs-token (N1)', async () => {
    const mounts = new MountsFile(new MemStoreDir().io('mounts.json'))
    await mounts.upsert(desc({ room: 'as', status: 'adopting:seeding', provenance: 'adopted' }))
    await mounts.upsert(desc({ room: 'ad', status: 'adopting:detaching', provenance: 'adopted' }))
    await mounts.upsert(desc({ room: 'nt', status: 'needs-token', provenance: 'adopted' }))

    const byRoom = Object.fromEntries((await mounts.recover()).map((r) => [r.desc.room, r.action]))
    expect(byRoom).toEqual({
      // Mirror of carving:* — the mount entry is still in the parent map, so a
      // rolled-back adopt simply re-adopts at the next boot.
      as: 'rollback',
      ad: 'rollforward',
    })
    // needs-token is a STEADY state, not a half-made one: its stores exist and
    // its files sit on disk under an ignored prefix. Boot must not roll it
    // back (that would drop the stores a later paste activates without
    // re-seeding) nor forward.
    expect(byRoom['nt']).toBeUndefined()
    expect(isRecoverable('needs-token')).toBe(false)
    expect(isRecoverable('active')).toBe(false)
    expect(isRecoverable('adopting:seeding')).toBe(true)
  })
})

describe('mountRootsFrom (the live ignore-set seam, N1/S10-Q6)', () => {
  const entry = (kind: FileEntry['kind'], guid = 'g'): FileEntry => ({ guid, kind })

  it('unions mounts.json paths with the map\'s mount entries', () => {
    const descs: MountDesc[] = [
      desc({ room: 'root', path: '' }), // the root mount is never an ignore root
      desc({ room: 'joined', path: 'inbox', provenance: 'joined' }),
      desc({ room: 'waiting', path: 'legal', provenance: 'adopted', status: 'needs-token' }),
    ]
    const map: [string, FileEntry][] = [
      ['keep.md', entry('text')],
      ['notes', entry('dir')],
      // A peer's carve that has reached this device BEFORE it has a desc: it
      // must already be ignored, or the delta scan re-enrolls the subtree.
      ['team', entry('mount', 'team-room')],
    ]
    expect(mountRootsFrom(descs, map)).toEqual(new Set(['inbox', 'legal', 'team']))
  })

  it('ignores tombstoned mount entries and dedupes the two authorities', () => {
    const descs: MountDesc[] = [desc({ room: 'team-room', path: 'team', provenance: 'carved' })]
    const map: [string, FileEntry][] = [
      ['team', entry('mount', 'team-room')],
      ['old', { guid: 'gone-room', kind: 'mount', deleted: true }],
    ]
    expect(mountRootsFrom(descs, map)).toEqual(new Set(['team']))
    expect(mountRootsFrom([], [])).toEqual(new Set())
  })
})
