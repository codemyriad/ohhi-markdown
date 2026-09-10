import { describe, expect, it } from 'vitest'
import type { SyncRecordSnapshot } from './pill-status.js'
import {
  inQuietMount,
  isForeignMount,
  mountHasRelay,
  mountTone,
  sameRelay,
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
      foreign: false,
    })
    expect(shareStateFor('inbox/shared/x.md', mounts, false, 'root')).toMatchObject({
      provenance: 'joined',
      room: 'r-inbox',
    })
    expect(shareStateFor('teamwork/a.md', mounts, false, 'root')).toEqual({ kind: 'local' })
    expect(shareStateFor('notes/a.md', mounts, false, 'root')).toEqual({ kind: 'local' })
  })

  it('reports a LINKED vault as the root mount — never foreign, it is yours', () => {
    expect(shareStateFor('notes/a.md', [], true, 'root', 'editor1:root')).toEqual({
      kind: 'shared',
      provenance: 'root',
      room: 'root',
      mountPath: '',
      link: 'editor1:root',
      status: 'active',
      foreign: false,
    })
  })

  it('carries a mount’s foreign flag through, so the tone can use it', () => {
    const theirs = [{ ...mounts[0]!, foreign: true }]
    expect(shareStateFor('team/a.md', theirs, false, 'root')).toMatchObject({ foreign: true })
  })
})

describe('whose share is this — isForeignMount (device-link N2)', () => {
  const OURS = 'wss://relay.example'

  it('a joined mount is always somebody else’s: this device pasted their link', () => {
    expect(isForeignMount({ provenance: 'joined', relay: OURS }, OURS)).toBe(true)
    expect(isForeignMount({ provenance: 'joined' }, OURS)).toBe(true)
  })

  it('a carved mount is always ours: this vault carved it', () => {
    expect(isForeignMount({ provenance: 'carved', relay: 'wss://elsewhere' }, OURS)).toBe(false)
  })

  it('a local mount is not shared at all', () => {
    expect(isForeignMount({ provenance: 'local' }, OURS)).toBe(false)
  })

  it('an adopted mount is told apart by the relay its room lives on', () => {
    // A carve of yours from another device: minted on this vault's relay.
    expect(isForeignMount({ provenance: 'adopted', relay: OURS }, OURS)).toBe(false)
    // Cynthia's share, joined on your other device and announced with HER
    // relay (spike S10 Q7) — the discriminator the N1 gap was missing.
    expect(isForeignMount({ provenance: 'adopted', relay: 'wss://cynthia.example' }, OURS)).toBe(true)
    // Nothing recorded: nothing says it is foreign, so it is not claimed to be.
    expect(isForeignMount({ provenance: 'adopted' }, OURS)).toBe(false)
  })

  it('the same relay written differently is still the same relay', () => {
    expect(sameRelay('wss://relay.example', 'wss://relay.example/')).toBe(true)
    expect(sameRelay('wss://Relay.Example', 'wss://relay.example')).toBe(true)
    expect(sameRelay('ws://localhost:8787', 'ws://localhost:8788')).toBe(false)
    expect(sameRelay('', 'wss://relay.example')).toBe(false)
    // Not a URL at all: compared as text rather than thrown on.
    expect(sameRelay('not a url', 'not a url')).toBe(true)
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

  it('an adopted mount that is FOREIGN reads as theirs (device-link N2)', () => {
    // The N1 gap, closed: both arrive as `adopted` on the second device, and
    // only the flag tells the two apart.
    expect(mountTone('adopted', false)).toBe('yours')
    expect(mountTone('adopted', true)).toBe('theirs')
    // The flag never promotes: your own carve stays yours.
    expect(mountTone('carved', false)).toBe('yours')
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
