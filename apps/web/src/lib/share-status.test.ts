import { describe, expect, it } from 'vitest'
import type { SyncRecordSnapshot } from './pill-status.js'
import {
  inQuietMount,
  mountHasRelay,
  mountTone,
  onlineIn,
  quietMountRoots,
  relayHost,
  scopedRollup,
  shareStateFor,
  type MountLike,
} from './share-status.js'

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
      status: 'active',
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
      status: 'active',
    })
  })
})

describe('mount state — what a mount with no key is, and is not', () => {
  const needsToken: MountLike = {
    path: 'design',
    room: 'r-design',
    provenance: 'adopted',
    link: null,
    status: 'needs-token',
  }

  it('says whose a share is: an adopted carve reads like your own, a join like theirs', () => {
    expect(mountTone('carved')).toBe('yours')
    expect(mountTone('adopted')).toBe('yours')
    expect(mountTone('root')).toBe('yours')
    expect(mountTone('joined')).toBe('theirs')
  })

  it('gives only an ACTIVE mount a relay to be in sync with', () => {
    expect(mountHasRelay({ provenance: 'carved' })).toBe(true)
    expect(mountHasRelay({ provenance: 'carved', status: 'active' })).toBe(true)
    expect(mountHasRelay({ provenance: 'adopted', status: 'needs-token' })).toBe(false)
    expect(mountHasRelay({ provenance: 'adopted', status: 'adopting' })).toBe(false)
    expect(mountHasRelay({ provenance: 'adopted', status: 'absorbing' })).toBe(false)
    expect(mountHasRelay({ provenance: 'local' })).toBe(false)
  })

  it('keeps every row of a keyless mount out of the pills', () => {
    const all = [...mounts, needsToken]
    expect(quietMountRoots(all)).toEqual(['design'])
    expect(inQuietMount('design', all)).toBe(true)
    expect(inQuietMount('design/deep/a.md', all)).toBe(true)
    expect(inQuietMount('designs/a.md', all)).toBe(false)
    expect(inQuietMount('team/a.md', all)).toBe(false)
  })

  it('reports the mount status on the share state, so the rail can say "link needed"', () => {
    expect(shareStateFor('design/a.md', [needsToken], true, 'root')).toMatchObject({
      kind: 'shared',
      provenance: 'adopted',
      status: 'needs-token',
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

  it('never lets a keyless mount drag the rollup offline — not even in a root-shared vault', () => {
    // spike S10 Q2 + golden rule 4: a needs-token mount's records are
    // {connected:false} forever because this device has no key, which is not
    // the same fact as a relay that went away. They are not an input at all.
    const keyless: MountLike[] = [
      { path: 'design', room: 'r-design', provenance: 'adopted', link: null, status: 'needs-token' },
    ]
    const withDesign = [...files, { path: 'design/x.md', kind: 'text', guid: 'd' }]
    const records = {
      a: rec(),
      b: rec(),
      d: rec({ connected: false }),
      '//folder:r-design': rec({ connected: false }),
    }
    expect(scopedRollup(withDesign, records, keyless, true)).toBe('green')
    // And with nothing else shared, the header still says "nothing shared" in
    // words rather than showing a pill for a folder that cannot sync.
    expect(scopedRollup(withDesign, records, keyless, false)).toBeNull()
  })

  it('counts an adopted mount exactly like a carved one once it is active', () => {
    const adopted: MountLike[] = [
      { path: 'team', room: 'r-team', provenance: 'adopted', link: null, status: 'active' },
    ]
    expect(scopedRollup(files, { a: rec({ pendingLocal: true }), b: rec() }, adopted, false)).toBe(
      'yellow'
    )
  })
})
