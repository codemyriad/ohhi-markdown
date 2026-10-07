/**
 * Remote attribution at arrival (sharing E3, Fork 2-A; spike S22 Q2): a
 * peer's edit is named by the name it announced in that doc's awareness
 * WHILE it is present, and "via <relay>" once it has left — awareness is
 * ephemeral, so the only honest moment to read it is when the update lands.
 */
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { PEER_SETTLE_MS, RELAY_OFFLINE_MS, attributeUpdate, relayHost, type AppEvent } from '../src/index.js'
import { MemStoreDir } from '@ohhi/vault'
import { bootDuo, bootVault, enc, seedAdapter, yieldMacro } from './fixture.js'

describe('attributeUpdate (pure)', () => {
  const states = new Map<number, unknown>([
    [1, { user: { name: 'me', color: '#111' } }],
    [2, { user: { name: 'Cynthia', color: '#c0ffee' } }],
    [3, { user: { name: 'Dmitri' } }],
    [4, { user: { name: 'Cynthia' } }],
  ])
  const base = { self: 1, states, relayHost: 'relay.example' }

  it('names a present peer by the name it announced', () => {
    expect(attributeUpdate({ ...base, clientIds: [2] })).toEqual({ kind: 'peer', name: 'Cynthia', color: '#c0ffee' })
    // Two replicas announcing one name (two devices, one person) are that person.
    expect(attributeUpdate({ ...base, clientIds: [2, 4] })).toMatchObject({ kind: 'peer', name: 'Cynthia' })
  })

  it('falls back to the relay when the client is not in awareness, ops are mixed, or delete-only', () => {
    const relay = { kind: 'relay', name: 'relay.example' }
    expect(attributeUpdate({ ...base, clientIds: [99] })).toEqual(relay)
    expect(attributeUpdate({ ...base, clientIds: [2, 3] })).toEqual(relay)
    expect(attributeUpdate({ ...base, clientIds: [2, 99] })).toEqual(relay)
    // Delete-only with nobody in the note (no `here` state): the relay.
    expect(attributeUpdate({ ...base, clientIds: [] })).toEqual(relay)
    expect(attributeUpdate({ ...base, states: null, clientIds: [2] })).toEqual(relay)
    expect(attributeUpdate({ clientIds: [2], self: 1, states: null })).toEqual({ kind: 'relay' })
  })

  it('an update carrying only our own ops is ours; ours mixed with a peer is the peer', () => {
    expect(attributeUpdate({ ...base, clientIds: [1] })).toEqual({ kind: 'me' })
    expect(attributeUpdate({ ...base, clientIds: [1, 3] })).toEqual({ kind: 'peer', name: 'Dmitri' })
  })

  it('a delete-only update is the one person with the note open (the drawer\'s "someone", P6)', () => {
    const relay = { kind: 'relay', name: 'relay.example' }
    const here = (entries: [number, unknown][]) => new Map<number, unknown>(entries)
    const cynthia = { user: { name: 'Cynthia', color: '#c0ffee' }, here: true }
    // Before the fix every Backspace a peer pressed fell to "via the relay".
    expect(attributeUpdate({ ...base, clientIds: [], states: here([[1, { user: { name: 'me' }, here: true }], [2, cynthia]]) })).toEqual({
      kind: 'peer',
      name: 'Cynthia',
      color: '#c0ffee',
    })
    // Two devices of one person are one person.
    expect(
      attributeUpdate({ ...base, clientIds: [], states: here([[2, cynthia], [4, { user: { name: 'Cynthia' }, here: true }]]) })
    ).toMatchObject({ kind: 'peer', name: 'Cynthia' })
    // Present but not IN the note: not a candidate.
    expect(attributeUpdate({ ...base, clientIds: [], states: here([[2, { ...cynthia, here: false }]]) })).toEqual(relay)
    // Several in the note: the one whose edit here was attributed last, if still here…
    const two = here([[2, cynthia], [3, { user: { name: 'Dmitri' }, here: true }]])
    expect(attributeUpdate({ ...base, clientIds: [], states: two, recent: { kind: 'peer', name: 'Dmitri' } })).toEqual({
      kind: 'peer',
      name: 'Dmitri',
    })
    // …else nobody can say: the relay.
    expect(attributeUpdate({ ...base, clientIds: [], states: two })).toEqual(relay)
    expect(attributeUpdate({ ...base, clientIds: [], states: two, recent: { kind: 'peer', name: 'Sam' } })).toEqual(relay)
  })

  it('relayHost reads the host out of a relay URL', () => {
    expect(relayHost('wss://relay.example:8443/sync')).toBe('relay.example:8443')
    expect(relayHost('ws://relay.test')).toBe('relay.test')
    expect(relayHost(undefined)).toBeUndefined()
  })
})

describe('MountSession attribution, two devices (L0-style over the RoomNet)', () => {
  it("B's edit is B's while B is online at arrival, and via the relay once B has left", async () => {
    const duo = await bootDuo({ files: { 'note.md': 'hello\n' } })
    try {
      const awA = duo.a.root.awarenessForPath('note.md')!
      const awB = duo.b.root.awarenessForPath('note.md')!
      expect(awA).toBeTruthy()
      expect(awB).toBeTruthy()
      // B announces itself on this doc (what the relay's awareness channel
      // carries): A now holds B's state under B's client id.
      applyAwarenessUpdate(awA, encodeAwarenessUpdate(awB, [awB.clientID]), 'test-relay')
      expect((awA.getStates().get(awB.clientID) as { user: { name: string } }).user.name).toBe('B')

      // 1. B types while present.
      duo.b.root.docForPath('note.md')!.transact((t) => t.insert(0, 'Bee '), 'local')
      await duo.deliver()
      expect(duo.a.root.docForPath('note.md')!.getText()).toBe('Bee hello\n')
      const online = changes(duo.a.root.roomEvents())
      expect(online).toHaveLength(1)
      expect(online[0]).toMatchObject({
        kind: 'doc.changed',
        actor: { kind: 'peer', name: 'B' },
        scope: { room: duo.a.root.room, mount: '', path: 'note.md' },
        payload: { added: 4, removed: 0 },
      })

      // 2. B leaves (its awareness state is gone), then an edit of B's
      //    arrives — late, offline, relayed: attributed to the relay.
      removeAwarenessStates(awA, [awB.clientID], 'test-relay')
      duo.b.root.docForPath('note.md')!.transact((t) => t.insert(0, 'late '), 'local')
      await duo.deliver()
      const after = changes(duo.a.root.roomEvents())
      expect(after[0]).toMatchObject({ kind: 'doc.changed', actor: { kind: 'relay', name: 'relay.test' }, payload: { added: 5 } })
      // B's earlier line is untouched: attribution was decided at arrival.
      expect(after[1]).toMatchObject({ actor: { kind: 'peer', name: 'B' }, count: 1 })

      // 3. A's own edits are never logged as changes on A.
      duo.a.root.docForPath('note.md')!.transact((t) => t.insert(0, 'mine '), 'local')
      await duo.deliver()
      expect(changes(duo.a.root.roomEvents())).toHaveLength(2)
      // …and arrive on B attributed to A's room-relay path (B never saw A's awareness).
      expect(changes(duo.b.root.roomEvents())[0]).toMatchObject({ actor: { kind: 'relay', name: 'relay.test' } })
    } finally {
      duo.dispose()
    }
  })

  it('a local delete-only edit (any non-provider origin) logs nothing; a remote delete-only one is the person with the note open, else via the relay', async () => {
    const duo = await bootDuo({ files: { 'note.md': 'hello world\n' } })
    try {
      const awA = duo.a.root.awarenessForPath('note.md')!
      const awB = duo.b.root.awarenessForPath('note.md')!
      applyAwarenessUpdate(awA, encodeAwarenessUpdate(awB, [awB.clientID]), 'test-relay')
      // A deletes the way the editor binding / undo manager does: an origin
      // object that is neither 'local' nor the doc's provider.
      const ydocA = duo.a.root.docForPath('note.md')!.raw() as Y.Doc
      const binding = { name: 'y-codemirror-like' }
      ydocA.transact(() => ydocA.getText('content').delete(0, 6), binding)
      await duo.deliver()
      expect(duo.a.root.docForPath('note.md')!.getText()).toBe('world\n')
      expect(changes(duo.a.root.roomEvents())).toEqual([])
      // …and it arrives on B as a remote delete-only update: logged, and —
      // a delete set names the deleted text's author, not the deleter —
      // attributed to the relay even though A's awareness is unknown to B.
      expect(duo.b.root.docForPath('note.md')!.getText()).toBe('world\n')
      expect(changes(duo.b.root.roomEvents())).toEqual([
        expect.objectContaining({ actor: { kind: 'relay', name: 'relay.test' }, payload: expect.objectContaining({ added: 0, removed: 6 }) }),
      ])
      // B's delete-only edit reaches A while B is PRESENT in A's awareness
      // but has the note closed: still the relay (rule 4), never A's own.
      duo.b.root.docForPath('note.md')!.transact((t) => t.delete(0, 1), 'local')
      await duo.deliver()
      expect(changes(duo.a.root.roomEvents())).toEqual([
        expect.objectContaining({ actor: { kind: 'relay', name: 'relay.test' }, payload: expect.objectContaining({ removed: 1 }) }),
      ])
      // B opens the note (`here`) and presses Backspace: B's, by name (rule
      // 3) — the drawer's "someone" (foundations-plan P6) was this update.
      awB.setLocalStateField('here', true)
      applyAwarenessUpdate(awA, encodeAwarenessUpdate(awB, [awB.clientID]), 'test-relay')
      duo.b.root.docForPath('note.md')!.transact((t) => t.delete(0, 1), 'local')
      await duo.deliver()
      expect(changes(duo.a.root.roomEvents())[0]).toMatchObject({ actor: { kind: 'peer', name: 'B' }, payload: { removed: 1 } })
    } finally {
      duo.dispose()
    }
  })

  it('a reconnect logs no false peer.left / peer.joined: peers are diffed only after PEER_SETTLE_MS', async () => {
    const duo = await bootDuo({ files: { 'note.md': 'hello\n' } })
    try {
      // The folder provider's socket status and awareness, as the provider
      // reports them (this harness's providers never connect on their own).
      const a = duo.a.root as unknown as { folderConn: { awareness: Awareness }; noteRelayStatus(status: string): void }
      const awA = a.folderConn.awareness
      const peer = new Awareness(new Y.Doc())
      peer.setLocalState({ user: { name: 'Cynthia', color: '#123' } })
      const peerEvents = () =>
        duo.a.root
          .roomEvents()
          .filter((e) => e.kind === 'peer.joined' || e.kind === 'peer.left')
          .map((e) => [e.kind, e.actor.name])
          .reverse()

      a.noteRelayStatus('connected')
      applyAwarenessUpdate(awA, encodeAwarenessUpdate(peer, [peer.clientID]), 'relay')
      expect(peerEvents()).toEqual([]) // still settling
      await duo.tick(PEER_SETTLE_MS)
      expect(peerEvents()).toEqual([['peer.joined', 'Cynthia']])

      // We drop: awareness ages Cynthia out — not believed while we are down.
      a.noteRelayStatus('disconnected')
      removeAwarenessStates(awA, [peer.clientID], 'timeout')
      // We are back; her state arrives a moment AFTER the connect.
      a.noteRelayStatus('connected')
      await duo.tick(PEER_SETTLE_MS / 2)
      peer.setLocalState({ user: { name: 'Cynthia', color: '#123' } }) // her periodic renew
      applyAwarenessUpdate(awA, encodeAwarenessUpdate(peer, [peer.clientID]), 'relay')
      await duo.tick(PEER_SETTLE_MS)
      expect(peerEvents()).toEqual([['peer.joined', 'Cynthia']])

      // A real departure, while connected and settled, is still logged.
      removeAwarenessStates(awA, [peer.clientID], 'relay')
      expect(peerEvents()).toEqual([
        ['peer.joined', 'Cynthia'],
        ['peer.left', 'Cynthia'],
      ])
    } finally {
      duo.dispose()
    }
  })

  it('a relay that never connects is logged offline once, after RELAY_OFFLINE_MS on the injected clock', async () => {
    const duo = await bootDuo({ files: { 'note.md': 'hello\n' } })
    try {
      const relayEvents = () => duo.a.root.roomEvents().filter((e) => e.kind === 'relay.state')
      expect(relayEvents()).toEqual([])
      await duo.tick(RELAY_OFFLINE_MS - 1)
      expect(relayEvents()).toEqual([])
      await duo.tick(1)
      await duo.tick(RELAY_OFFLINE_MS * 3)
      expect(relayEvents().map((e) => [e.payload, e.actor])).toEqual([
        [{ to: 'offline' }, { kind: 'relay', name: 'relay.test' }],
      ])
    } finally {
      duo.dispose()
    }
  })

  it('a peer creating, moving and deleting files is logged as file.* (children of a dir fold into it)', async () => {
    const duo = await bootDuo({ files: { 'a.md': 'a\n', 'dir/x.md': 'x\n', 'dir/y.md': 'y\n' } })
    try {
      const before = duo.a.root.roomEvents().length
      await duo.b.root.createFile('', 'new.md', 'fresh\n')
      await duo.deliver()
      await duo.b.root.renamePath('dir', 'moved')
      await duo.deliver()
      await duo.b.root.deletePath('a.md')
      await duo.deliver()
      const files = duo.a.root
        .roomEvents()
        .slice(0, duo.a.root.roomEvents().length - before)
        .filter((e) => e.kind.startsWith('file.'))
        .reverse()
        .map((e) => [e.kind, e.scope.path, (e.payload as { from?: string }).from])
      expect(files).toEqual([
        ['file.created', 'new.md', undefined],
        ['file.moved', 'moved', 'dir'],
        ['file.deleted', 'a.md', undefined],
      ])
    } finally {
      duo.dispose()
    }
  })

  it('a disk edit ingested by the reconciler is logged as actor disk (never agent)', async () => {
    const base = await seedAdapter({ 'note.md': 'hello\n' })
    const vault = await bootVault(base, new MemStoreDir(), 'root-room')
    try {
      base.externalWrite('note.md', enc.encode('hello\nfrom obsidian\n'))
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 4; j++) await yieldMacro()
        vault.clock.advance(30)
      }
      for (let j = 0; j < 12; j++) await yieldMacro()
      expect(vault.root.docForPath('note.md')!.getText()).toBe('hello\nfrom obsidian\n')
      const disk = changes(vault.root.roomEvents())
      expect(disk).toHaveLength(1)
      expect(disk[0]).toMatchObject({ kind: 'doc.changed', actor: { kind: 'disk' }, scope: { path: 'note.md' }, payload: { added: 14 } })
    } finally {
      vault.dispose()
    }
  })
})

function changes(events: AppEvent[]): AppEvent[] {
  return events.filter((e) => e.kind === 'doc.changed')
}
