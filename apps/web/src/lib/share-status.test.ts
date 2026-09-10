import { describe, expect, it } from 'vitest'
import type { SyncRecordSnapshot } from './pill-status.js'
import { onlineIn, relayHost, scopedRollup, shareStateFor, type MountLike } from './share-status.js'

const rec = (over: Partial<SyncRecordSnapshot> = {}): SyncRecordSnapshot => ({
  connected: true,
  synced: true,
  pendingLocal: false,
  diskMatchesCrdt: true,
  diverged: false,
  ...over,
})

const mounts: MountLike[] = [
  { path: 'team', room: 'r-team', provenance: 'carved', link: 'editor1:abc' },
  { path: 'inbox/shared', room: 'r-inbox', provenance: 'joined', link: null },
]

describe('shareStateFor', () => {
  it('finds the mount a path lives in, and says whose it is', () => {
    expect(shareStateFor('team/a.md', mounts, false, 'root')).toEqual({
      kind: 'shared',
      provenance: 'carved',
      room: 'r-team',
      mountPath: 'team',
      link: 'editor1:abc',
    })
    expect(shareStateFor('inbox/shared/x.md', mounts, false, 'root')).toMatchObject({
      provenance: 'joined',
      room: 'r-inbox',
    })
    expect(shareStateFor('teamwork/a.md', mounts, false, 'root')).toEqual({ kind: 'local' })
    expect(shareStateFor('notes/a.md', mounts, false, 'root')).toEqual({ kind: 'local' })
  })

  it('reports a root-shared vault as shared as a whole', () => {
    expect(shareStateFor('notes/a.md', [], true, 'root', 'editor1:root')).toEqual({
      kind: 'shared',
      provenance: 'root',
      room: 'root',
      mountPath: '',
      link: 'editor1:root',
    })
  })
})

describe('relayHost', () => {
  it('shows the host of a relay URL and tolerates garbage', () => {
    expect(relayHost('wss://relay.example.com:443/')).toBe('relay.example.com')
    expect(relayHost('ws://localhost:8787')).toBe('localhost:8787')
    expect(relayHost('not a url')).toBe('not a url')
    expect(relayHost(null)).toBeNull()
  })
})

describe('onlineIn', () => {
  it('is the room’s own list, empty when nobody is there', () => {
    expect(onlineIn({ 'r-team': ['Chris', 'Sam'] }, 'r-team')).toEqual(['Chris', 'Sam'])
    expect(onlineIn({ 'r-team': ['Chris'] }, 'r-inbox')).toEqual([])
  })
})

describe('scopedRollup — the header pill only claims what has a relay', () => {
  const files = [
    { path: 'team/a.md', kind: 'text', guid: 'a' },
    { path: 'notes/b.md', kind: 'text', guid: 'b' },
  ]

  it('is null when nothing is shared: the header says so in words', () => {
    expect(scopedRollup(files, { a: rec({ connected: false }), b: rec({ connected: false }) }, [], false)).toBeNull()
  })

  it('ignores local docs, counts shared docs and the shared folder docs', () => {
    const records = {
      a: rec(),
      b: rec({ connected: false }), // local — must not drag the rollup offline
      '//folder:r-team': rec(),
      '//folder:r-other': rec({ connected: false }), // not one of ours
    }
    expect(scopedRollup(files, records, mounts, false)).toBe('green')
    expect(scopedRollup(files, { ...records, a: rec({ pendingLocal: true }) }, mounts, false)).toBe('yellow')
  })

  it('counts everything in a root-shared vault', () => {
    expect(scopedRollup(files, { a: rec(), b: rec({ connected: false }) }, [], true)).toBe('offline')
  })
})
