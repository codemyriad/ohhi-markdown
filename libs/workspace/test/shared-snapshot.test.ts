import { describe, expect, it } from 'vitest'
import { nothingShared, sharedSnapshot, type AppEvent, type SharedSnapshotInput } from '../src/index.js'

const rec = (connected: boolean) => ({ connected, synced: connected, pendingLocal: false, diskMatchesCrdt: true, diverged: false })

let seq = 0
const ev = (partial: Partial<AppEvent> & Pick<AppEvent, 'kind' | 'at'>): AppEvent =>
  ({ id: `e:${++seq}`, level: 'info', scope: {}, actor: { kind: 'app' }, count: 1, payload: {}, ...partial }) as AppEvent

const base = (over: Partial<SharedSnapshotInput> = {}): SharedSnapshotInput => ({
  rootRoom: 'root',
  rootLinked: false,
  rootRelay: 'wss://relay.ohhi.md',
  self: 'Chris',
  mounts: [
    { path: 'CS', room: 'cs', provenance: 'carved', status: 'active', foreign: false, relay: 'wss://relay.ohhi.md' },
    { path: 'Myriad', room: 'my', provenance: 'joined', status: 'active', foreign: true, relay: 'wss://other.example' },
  ],
  files: [
    { path: 'CS', kind: 'mount' },
    { path: 'CS/Raft.md', kind: 'text' },
    { path: 'CS/Paxos.md', kind: 'text' },
    { path: 'CS/img.png', kind: 'binary' },
    { path: 'Myriad/a.md', kind: 'text' },
    { path: 'Inbox.md', kind: 'text' },
  ],
  records: { '//folder:cs': rec(true), '//folder:my': rec(true), '//folder:root': rec(true) },
  presenceByRoom: { cs: ['Chris', 'Cynthia', 'Sam'], my: ['Chris'] },
  ...over,
})

describe('sharedSnapshot (sharing E2)', () => {
  it('lists carved and joined rooms with counts and stacks, you excluded', () => {
    const s = sharedSnapshot(base())
    expect(s.rooms.map((r) => [r.path, r.provenance, r.noteCount, r.host])).toEqual([
      ['CS', 'carved', 2, 'relay.ohhi.md'],
      ['Myriad', 'joined', 1, 'other.example'],
    ])
    expect(s.rooms[0]!.peers.map((p) => p.name)).toEqual(['Cynthia', 'Sam'])
    expect(s.rooms[1]!.peers).toEqual([])
  })

  it('never lists the root-linked vault as a room: it is a device fact', () => {
    const s = sharedSnapshot(base({ rootLinked: true, mounts: [], tokensByRoom: { root: [{ label: 'laptop', readOnly: false, kind: 'device' }] } }))
    expect(s.rooms).toEqual([])
    expect(s.devices).toEqual([
      { label: '', thisDevice: true },
      { label: 'laptop', thisDevice: false },
    ])
    // …but its relay is still a relay this vault syncs to.
    expect(s.relays).toMatchObject([{ host: 'relay.ohhi.md', state: 'connected', rooms: 1 }])
  })

  it('resolves adopted mounts by `foreign`, and shows links only for carved rooms (never device links)', () => {
    const tokens = [
      { label: 'Team', readOnly: false, createdAt: '2026-10-01' },
      { label: 'Sam', readOnly: true },
      { label: 'desk', readOnly: false, kind: 'device' as const },
    ]
    const s = sharedSnapshot(
      base({
        mounts: [
          { path: 'A', room: 'a', provenance: 'adopted', status: 'active', foreign: false, relay: null },
          { path: 'B', room: 'b', provenance: 'adopted', status: 'active', foreign: true, relay: null },
        ],
        tokensByRoom: { a: tokens, b: tokens },
      })
    )
    expect(s.rooms.map((r) => r.provenance)).toEqual(['carved', 'joined'])
    expect(s.rooms[0]!.links).toEqual([
      { label: 'Team', readOnly: false, created: '2026-10-01' },
      { label: 'Sam', readOnly: true },
    ])
    expect(s.rooms[1]!.links).toBeUndefined()
  })

  it('rolls relays up by host from the folder records; a down room drags its host down', () => {
    const s = sharedSnapshot(base({ records: { '//folder:cs': rec(false), '//folder:my': rec(true) } }))
    expect(s.relays).toEqual([
      { host: 'relay.ohhi.md', state: 'reconnecting', rooms: 1, people: 2 },
      { host: 'other.example', state: 'connected', rooms: 1, people: 0 },
    ])
  })

  it('reads offline and refused (with the reason) from the log only while the record is down', () => {
    const events = [
      ev({ kind: 'relay.state', at: 1, scope: { room: 'cs' }, payload: { to: 'reconnecting' } }),
      ev({ kind: 'relay.state', at: 2, scope: { room: 'cs' }, payload: { to: 'offline' } }),
      ev({ kind: 'relay.state', at: 3, scope: { room: 'my' }, level: 'error', payload: { to: 'refused', reason: 'no such share' } }),
    ]
    const down = sharedSnapshot(base({ events, records: {} }))
    expect(down.relays.map((r) => [r.state, r.reason])).toEqual([
      ['offline', undefined],
      ['refused', 'no such share'],
    ])
    // The record is the truth: a connected room is connected, whatever the log last said.
    const up = sharedSnapshot(base({ events }))
    expect(up.relays.every((r) => r.state === 'connected')).toBe(true)
  })

  it('claims "in sync since" only when every room on the relay is green, from the latest entry', () => {
    const host = (s: ReturnType<typeof sharedSnapshot>) => s.relays.find((r) => r.host === 'relay.ohhi.md')!
    // cs and root share relay.ohhi.md: both green, root got there last.
    const all = sharedSnapshot(base({ rootLinked: true, inSyncByRoom: { cs: { since: 10 }, root: { since: 30 }, my: { since: 5 } } }))
    expect(host(all)).toMatchObject({ inSyncSince: 30 })
    expect(host(all).lastInSyncAt).toBeUndefined()
    // root left green at 40: the last moment BOTH were green is 40, not root's entry.
    const left = sharedSnapshot(base({ rootLinked: true, inSyncByRoom: { cs: { since: 10 }, root: { since: 30, until: 40 } } }))
    expect(host(left).inSyncSince).toBeUndefined()
    expect(host(left).lastInSyncAt).toBe(40)
    // cs only turned green after root had left: they were never all green together.
    const never = sharedSnapshot(base({ rootLinked: true, inSyncByRoom: { cs: { since: 50 }, root: { since: 30, until: 40 } } }))
    expect(host(never)).not.toHaveProperty('inSyncSince')
    expect(host(never)).not.toHaveProperty('lastInSyncAt')
    // A room never seen green: no claim at all.
    const unseen = sharedSnapshot(base({ rootLinked: true, inSyncByRoom: { cs: { since: 10 } } }))
    expect(host(unseen)).not.toHaveProperty('inSyncSince')
  })

  it('ignores a relay refusal logged before this session started (events.json survives reloads)', () => {
    const records = { ...base().records, '//folder:cs': rec(false) }
    const events = [ev({ kind: 'relay.state', at: 5, scope: { room: 'cs' }, payload: { to: 'refused', reason: 'old' } })]
    const host = (s: ReturnType<typeof sharedSnapshot>) => s.relays.find((r) => r.host === 'relay.ohhi.md')!
    expect(host(sharedSnapshot(base({ records, events }))).state).toBe('refused')
    expect(host(sharedSnapshot(base({ records, events, sessionStartedAt: 10 }))).state).toBe('reconnecting')
    const fresh = [...events, ev({ kind: 'relay.state', at: 12, scope: { room: 'cs' }, payload: { to: 'refused', reason: 'new' } })]
    expect(host(sharedSnapshot(base({ records, events: fresh, sessionStartedAt: 10 })))).toMatchObject({ state: 'refused', reason: 'new' })
  })

  it('gives each person ONE fact: the note their caret is in, else the room', () => {
    const s = sharedSnapshot(
      base({
        presenceByPath: {
          'CS/Raft.md': [{ name: 'Cynthia', color: '#c33' }, { name: 'Chris' }],
          'CS/Paxos.md': [{ name: 'Cynthia' }],
        },
      })
    )
    expect(s.people).toEqual([
      { name: 'Cynthia', color: '#c33', room: 'cs', path: 'CS/Paxos.md' },
      { name: 'Sam', room: 'cs', path: null },
    ])
  })

  it('remembers the last person to leave, unless they are back', () => {
    const events = [
      ev({ kind: 'peer.left', at: 5, scope: { room: 'cs' }, actor: { kind: 'peer', name: 'Ann' } }),
      ev({ kind: 'peer.left', at: 9, scope: { room: 'cs' }, actor: { kind: 'peer', name: 'Sam' } }),
    ]
    expect(sharedSnapshot(base({ events })).lastSeen).toEqual({ name: 'Ann', at: 5 })
    expect(sharedSnapshot(base({ events, presenceByRoom: {} })).lastSeen).toEqual({ name: 'Sam', at: 9 })
  })

  it('dates a room by the newest change someone else made', () => {
    const events = [
      ev({ kind: 'doc.changed', at: 4, scope: { room: 'cs', path: 'CS/Raft.md' }, actor: { kind: 'peer', name: 'Sam' }, payload: { guid: 'g' } }),
      ev({ kind: 'file.created', at: 8, scope: { room: 'cs', path: 'CS/New.md' }, actor: { kind: 'relay' } }),
      ev({ kind: 'peer.joined', at: 20, scope: { room: 'cs' }, actor: { kind: 'peer', name: 'Sam' } }),
    ]
    expect(sharedSnapshot(base({ events })).rooms[0]!.lastChangeAt).toBe(8)
  })

  it('is "nothing shared" only with no rooms, no link and no other device', () => {
    expect(nothingShared(sharedSnapshot(base({ mounts: [] })), false)).toBe(true)
    expect(nothingShared(sharedSnapshot(base({ mounts: [] })), true)).toBe(false)
    expect(nothingShared(sharedSnapshot(base()), false)).toBe(false)
  })
})
