/**
 * Two host-facing guarantees of `createRelay` (nextcloud-build decisions 17
 * and 4/8): the per-room caps, and a read-only connection that writes
 * nothing — tested with RAW frames, not a well-behaved provider, so a
 * hostile client's SyncStep2, Update and Awareness are all covered (review
 * R1 notes; security review #6).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { createRelay, type Relay, type RelayOptions } from '../src/server.ts'

async function until(cond: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- the wire format, by hand (lib0 varUint / varString / varUint8Array) ----
function varUint(n: number): number[] {
  const out: number[] = []
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  out.push(n)
  return out
}
const varBytes = (b: Uint8Array): number[] => [...varUint(b.length), ...b]
const varString = (s: string): number[] => varBytes(new TextEncoder().encode(s))
const frame = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat())

const MSG = { sync: 0, awareness: 1, auth: 2 } as const
const SYNC = { step2: 1, update: 2 } as const

/** A client that speaks the protocol by hand: auth, then whatever frames a test sends. */
async function rawClient(port: number, doc: string, token: string): Promise<{ send: (b: Uint8Array) => void; close: () => void }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  const firstReply = new Promise<void>((resolve) => ws.once('message', () => resolve()))
  ws.send(frame(varString(doc), varUint(MSG.auth), varUint(0), varString(token)))
  await firstReply // Authenticated (or refused)
  return { send: (b) => ws.send(b), close: () => ws.close() }
}

function hostileFrames(doc: string): Uint8Array[] {
  const src = new Y.Doc()
  src.getText('t').insert(0, 'forged')
  const update = Y.encodeStateAsUpdate(src)
  const aw = new Awareness(new Y.Doc())
  aw.setLocalState({ type: 'custodian', instance: 'forged', disk: { g: 'match' }, blocked: {} })
  const awareness = encodeAwarenessUpdate(aw, [aw.clientID])
  return [
    frame(varString(doc), varUint(MSG.sync), varUint(SYNC.step2), varBytes(update)),
    frame(varString(doc), varUint(MSG.sync), varUint(SYNC.update), varBytes(update)),
    frame(varString(doc), varUint(MSG.awareness), varBytes(awareness)),
  ]
}

describe('createRelay host guarantees', () => {
  let dir: string
  let relay: Relay | null = null
  const cleanups: (() => void)[] = []

  afterEach(async () => {
    for (const c of cleanups.splice(0)) c()
    await relay?.destroy()
    relay = null
    rmSync(dir, { recursive: true, force: true })
  })

  async function start(extra: Partial<RelayOptions>): Promise<Relay> {
    dir = mkdtempSync(join(tmpdir(), 'relay-guarantees-'))
    relay = createRelay({
      dbPath: join(dir, 'relay.db'),
      authenticate: async ({ token }) => ({ readOnly: token === 'ro', context: {} }),
      ...extra,
    })
    await relay.listen()
    return relay
  }

  function reader(port: number, name: string, token = 'ro') {
    const doc = new Y.Doc()
    const socket = new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${port}`, WebSocketPolyfill: WebSocket })
    let denied = false
    const provider = new HocuspocusProvider({
      name,
      document: doc,
      token,
      websocketProvider: socket,
      onAuthenticationFailed: () => {
        denied = true
      },
    })
    provider.attach()
    cleanups.push(() => {
      provider.destroy()
      socket.destroy()
    })
    return { doc, provider, denied: () => denied }
  }

  it('a read-only socket sending raw SyncStep2, Update and Awareness frames changes nothing anyone sees', async () => {
    const r = await start({ dropReadOnlyAwareness: true })
    const watcher = reader(r.port, 'room/doc')
    await until(() => watcher.provider.synced, 'watcher synced')

    const attacker = await rawClient(r.port, 'room/doc', 'ro')
    cleanups.push(attacker.close)
    for (const f of hostileFrames('room/doc')) attacker.send(f)
    await sleep(300)
    expect(r.hocuspocus.documents.get('room/doc')?.getText('t').toString()).toBe('')
    expect(watcher.doc.getText('t').toString()).toBe('')
    const states = [...watcher.provider.awareness!.getStates().values()]
    expect(states.some((s) => (s as { type?: unknown }).type === 'custodian')).toBe(false)

    // Control: the same frames on a writable socket DO land, so the frames are well-formed.
    const writer = await rawClient(r.port, 'room/doc', 'rw')
    cleanups.push(writer.close)
    for (const f of hostileFrames('room/doc')) writer.send(f)
    await until(() => watcher.doc.getText('t').toString() === 'forged', 'writer update seen')
    await until(
      () => [...watcher.provider.awareness!.getStates().values()].some((s) => (s as { type?: unknown }).type === 'custodian'),
      'writer awareness seen'
    )
  })

  it('caps a room at docsPerRoom docs and bytesPerRoom bytes; other rooms and known docs are unaffected', async () => {
    const caps: string[] = []
    const r = await start({ caps: { docsPerRoom: 2, bytesPerRoom: 1_000 }, onCapExceeded: (room, cap) => caps.push(`${room}:${cap}`) })
    const a = reader(r.port, 'room/a', 'rw')
    const b = reader(r.port, 'room/b', 'rw')
    await until(() => a.provider.synced && b.provider.synced, 'a, b synced')
    const c = reader(r.port, 'room/c', 'rw')
    await until(() => c.denied(), 'room/c refused')
    expect(caps).toEqual(['room:docs'])
    // A doc the room already holds, and another room, still open.
    const a2 = reader(r.port, 'room/a', 'rw')
    const other = reader(r.port, 'other/x', 'rw')
    await until(() => a2.provider.synced && other.provider.synced, 'known doc and other room synced')

    // Bytes: a store that would grow the room past the cap is not written.
    a.doc.getText('t').insert(0, 'x'.repeat(400))
    await until(() => (r.db.docBytes('room/a') ?? 0) > 400, 'a stored', 8000)
    const stored = r.db.docBytes('room/a')!
    b.doc.getText('t').insert(0, 'y'.repeat(800))
    await until(() => caps.includes('room:bytes'), 'b refused by the byte cap', 8000)
    expect(r.db.docBytes('room/b') ?? 0).toBeLessThan(800)
    expect(r.db.roomUsage('room').bytes).toBeLessThanOrEqual(1_000)
    expect(r.db.docBytes('room/a')).toBe(stored)
  })

  it('without caps nothing is limited', async () => {
    const r = await start({})
    const docs = ['room/1', 'room/2', 'room/3'].map((n) => reader(r.port, n, 'rw'))
    await until(() => docs.every((d) => d.provider.synced), 'all synced')
  })

  it('removeRoom forgets one room: its docs, shares and ancestry, its live connections closed, nothing stored back', async () => {
    const r = await start({})
    const a = reader(r.port, 'gone/a', 'rw')
    const keep = reader(r.port, 'kept/a', 'rw')
    await until(() => a.provider.synced && keep.provider.synced, 'both synced')
    a.doc.getText('t').insert(0, 'bye')
    keep.doc.getText('t').insert(0, 'stay')
    await until(() => r.db.docBytes('gone/a') !== null && r.db.docBytes('kept/a') !== null, 'both stored', 8000)
    r.db.addShare({ token: 't-gone', folderGuid: 'gone', kind: 'folder' })
    r.db.addShare({ token: 't-kept', folderGuid: 'kept', kind: 'folder' })
    r.db.setRoomParent('gone', 'kept')

    expect(r.removeRoom('gone')).toBe(1)
    expect(r.hocuspocus.documents.has('gone/a')).toBe(false)
    expect(r.db.docBytes('gone/a')).toBeNull()
    expect(r.db.getShare('t-gone')).toBeNull()
    expect(r.db.getRoomParent('gone')).toBeNull()
    // Another room is untouched.
    expect(r.db.docBytes('kept/a')).not.toBeNull()
    expect(r.db.getShare('t-kept')).not.toBeNull()
    expect(r.hocuspocus.documents.has('kept/a')).toBe(true)
    // A late edit from the closed client is never stored, and nothing reloads the room.
    a.doc.getText('t').insert(0, 'late ')
    await sleep(2_500)
    expect(r.db.docBytes('gone/a')).toBeNull()
    expect(() => r.db.removeRoom('a/b')).toThrow(/not a room/)
  })
})
