/**
 * Per-doc presence (sharing E1): who is IN a note, not merely connected to
 * it. Every relay-attached doc announces `user` (always-on CRDT), so the
 * session adds `here` to a doc's awareness while a view holds it and reports
 * the peers that say `here: true` through `onDocPresence`.
 *
 * No relay process: the session points at a port nothing listens on, which
 * still builds every provider and its awareness — what is under test is the
 * local state the session writes and how it reads a peer's, and a peer is
 * played by applying another Awareness's encoded update, as the relay would.
 */
import { createServer, type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { createYjsEngine } from '@ohhi/sync'
import { MemJournal, MemLcaStore, MemVaultAdapter } from '@ohhi/vault'
import { SimClock } from '@ohhi/testkit'
import { MountSession } from '../src/mount-session.js'
import type { DocPeer, FileRow, SyncRecordFields } from '../src/types.js'

const enc = new TextEncoder()

async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

const sessions: MountSession[] = []
afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose()
})

async function bootShared() {
  const adapter = new MemVaultAdapter()
  await adapter.writeAtomic('a.md', enc.encode('alpha'))
  await adapter.writeAtomic('b.md', enc.encode('beta'))
  const clock = new SimClock()
  const records = new Map<string, SyncRecordFields>()
  let files: FileRow[] = []
  const presence = new Map<string, DocPeer[]>()
  const session = await MountSession.create({
    engine: createYjsEngine(),
    adapter,
    user: { name: 'Me', color: '#000' },
    room: 'room-1',
    clock,
    lcaStore: new MemLcaStore(),
    journal: new MemJournal(() => clock.now()),
    recordFor: (key) => {
      let rec = records.get(key)
      if (!rec) {
        rec = { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
        records.set(key, rec)
      }
      return rec
    },
    makeShareLink: (relay, room) => `link:${relay.url}:${room}`,
    webSocketPolyfill: WebSocket,
    events: {
      onFiles: (rows) => {
        files = rows
      },
      onDocPresence: (guid, peers) => {
        presence.set(guid, peers)
      },
    },
  })
  sessions.push(session)
  session.enableSharing({ url: `ws://127.0.0.1:${await closedPort()}`, token: 't' })
  const guidOf = (path: string): string => files.find((r) => r.path === path)!.guid
  const hereOf = (path: string): unknown =>
    (session.awarenessForPath(path)!.getLocalState() as { here?: unknown } | null)?.here
  return { session, presence, guidOf, hereOf }
}

/** A peer on `path`'s doc: its own Awareness, delivered as an encoded update. */
function peerOn(target: Awareness, name: string, extra: Record<string, unknown>): Awareness {
  const peer = new Awareness(new Y.Doc())
  peer.setLocalState({ user: { name, color: '#123' }, ...extra })
  applyAwarenessUpdate(target, encodeAwarenessUpdate(peer, [peer.clientID]), 'relay')
  return peer
}

describe('per-doc presence (sharing E1)', () => {
  it('announces here only on the docs a view holds, and clears it when the last view leaves', async () => {
    const { session, hereOf } = await bootShared()
    expect(hereOf('a.md')).not.toBe(true)
    session.setOpenPaths(new Set(['a.md']))
    expect(hereOf('a.md')).toBe(true)
    expect(hereOf('b.md')).not.toBe(true)
    session.setOpenPaths(new Set(['b.md']))
    expect(hereOf('a.md')).toBe(false)
    expect(hereOf('b.md')).toBe(true)
    session.setOpenPaths(new Set())
    expect(hereOf('b.md')).toBe(false)
  })

  it('reports the peers that say here, and only them, ourselves excluded', async () => {
    const { session, presence, guidOf } = await bootShared()
    session.setOpenPaths(new Set(['a.md']))
    const aw = session.awarenessForPath('a.md')!
    // Connected but elsewhere: announces `user`, not `here`.
    peerOn(aw, 'Sam', {})
    expect(presence.get(guidOf('a.md'))).toEqual([])
    const cynthia = peerOn(aw, 'Cynthia', { here: true, cursor: { anchor: 'x', head: 'y' } })
    expect(presence.get(guidOf('a.md'))).toEqual([
      { clientId: cynthia.clientID, name: 'Cynthia', cursor: { anchor: 'x', head: 'y' } },
    ])
    // She closes the note: her `here` goes false.
    cynthia.setLocalStateField('here', false)
    applyAwarenessUpdate(aw, encodeAwarenessUpdate(cynthia, [cynthia.clientID]), 'relay')
    expect(presence.get(guidOf('a.md'))).toEqual([])
  })

  it('reports nobody for every doc when its connections are torn down', async () => {
    const { session, presence, guidOf } = await bootShared()
    peerOn(session.awarenessForPath('b.md')!, 'Cynthia', { here: true })
    expect(presence.get(guidOf('b.md'))?.map((p) => p.name)).toEqual(['Cynthia'])
    sessions.splice(sessions.indexOf(session), 1)
    session.dispose()
    expect(presence.get(guidOf('b.md'))).toEqual([])
  })
})
