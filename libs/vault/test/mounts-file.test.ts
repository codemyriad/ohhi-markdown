import { describe, expect, it } from 'vitest'
import { MemStoreDir } from '../src/store-dir.js'
import { MountsFile, type MountDesc } from '../src/mounts-file.js'

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
})
