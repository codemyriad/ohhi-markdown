/**
 * Provider layer — one socket per room, event-driven waits.
 *
 * Both findings this suite pins are claims about the REAL server
 * (spike S10-Q4 §"Connection model" / §"Timeout"), so it runs against the
 * relay child process the pull bench already spawns (`bench/relay-child.ts`,
 * imported rather than copied: it is plain node:child_process and typechecks
 * under this package's own tsconfig). A mock socket would prove nothing about
 * whether `@hocuspocus/server` still authenticates per DOCUMENT when many
 * documents share one connection — which is the whole question.
 *
 * Bounded to 50 docs: the shape (1 socket, N providers) is what is under
 * test, not the throughput the bench measures.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createYjsEngine, type EngineDoc, type SyncEngine } from '@ohhi/sync'
import { RealClock, SimClock } from '@ohhi/testkit'
import { startRelay, type RelayHandle } from '../bench/relay-child.js'
import {
  connectDoc,
  createRoomSocket,
  ProgressTracker,
  whenSynced,
  type DocConnection,
  type RoomSocket,
} from '../src/providers.js'
import type { SyncRecordFields } from '../src/types.js'

const ROOM = 'sharedroom'
const TOKEN = 'shared-room-token'
/** A second room, so one doc on the shared socket is out of TOKEN's scope. */
const OTHER = 'otherroom'
const OTHER_TOKEN = 'other-room-token'
const USER = { name: 'T', color: '#000' }
const N = 50

/** Counts every WebSocket the provider layer opens. */
let opened = 0
class CountingWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols)
    opened++
  }
}
const POLYFILL = CountingWebSocket as unknown as typeof WebSocket

function freshRecord(): SyncRecordFields {
  return { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
}

/** A port nothing listens on — bound, read back, released. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** Let queued microtasks (and any settled promise handlers) run. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('provider layer: one socket per room', () => {
  let dir: string
  let relay: RelayHandle
  let engine: SyncEngine
  const docs: EngineDoc[] = []
  const conns: DocConnection[] = []
  const sockets: RoomSocket[] = []

  const makeDoc = (guid: string, text: string): EngineDoc => {
    const doc = engine.createDoc(guid)
    doc.transact((t) => t.insert(0, text), 'local')
    docs.push(doc)
    return doc
  }

  const attach = (
    socket: RoomSocket,
    name: string,
    token: string,
    onAuthFailed?: (reason: string) => void
  ): { conn: DocConnection; record: SyncRecordFields } => {
    const record = freshRecord()
    const conn = connectDoc({
      relay: socket.relay,
      name,
      token,
      doc: makeDoc(name.replace('/', '-'), `note ${name}`),
      user: USER,
      record,
      onAuthFailed,
      socket,
    })
    conns.push(conn)
    return { conn, record }
  }

  const openSocket = (url: string, token: string): RoomSocket => {
    const socket = createRoomSocket(url, token, { webSocketPolyfill: POLYFILL })
    sockets.push(socket)
    return socket
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'editor-providers-test-'))
    relay = await startRelay({
      dataDir: join(dir, 'relay'),
      seedShare: `${ROOM}:${TOKEN},${OTHER}:${OTHER_TOKEN}`,
    })
  }, 60_000)

  afterAll(async () => {
    await relay.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)

  beforeAll(() => {
    engine = createYjsEngine()
  })

  afterEach(() => {
    for (const conn of conns.splice(0)) conn.destroy()
    for (const socket of sockets.splice(0)) socket.destroy()
    for (const doc of docs.splice(0)) doc.destroy()
    opened = 0
  })

  it(
    'syncs 50 docs over ONE socket and feeds the group progress counts',
    async () => {
      const socket = openSocket(relay.url, TOKEN)
      const progress: { synced: number; total: number }[] = []
      // The tracker's clock is a SimClock that this test never advances: the
      // watchdog must not be what makes a healthy pull finish.
      const sim = new SimClock()
      const tracker = new ProgressTracker({
        clock: sim,
        total: N,
        onProgress: (snapshot) => progress.push(snapshot),
      })

      const attached = Array.from({ length: N }, (_, i) => attach(socket, `${ROOM}/d${i}`, TOKEN))
      await Promise.all(
        attached.map(({ conn }) =>
          whenSynced(conn.provider, undefined, 30_000, () => null, {
            clock: new RealClock(),
            progress: tracker,
          })
        )
      )

      // The finding: 1,030 sockets for a 1,029-note vault becomes 1 per room.
      expect(opened).toBe(1)
      expect(socket.attached).toBe(N)
      expect(attached[0]!.conn.shared).toBe(true)
      for (const { record } of attached) {
        expect(record.connected).toBe(true)
        expect(record.synced).toBe(true)
      }

      // The progress signal the joiner panel renders.
      expect(tracker.synced).toBe(N)
      expect(tracker.total).toBe(N)
      expect(progress.at(-1)).toEqual({ synced: N, total: N })
      expect(sim.now()).toBe(0)

      // Detaching every doc leaves the shared socket alive and ours to close.
      for (const { conn } of attached) conn.destroy()
      conns.length = 0
      expect(socket.attached).toBe(0)
      expect(socket.websocket.status).toBe('connected')
      expect(opened).toBe(1)
    },
    60_000
  )

  it('refuses a socket opened for a different relay', () => {
    const socket = openSocket(relay.url, TOKEN)
    expect(() =>
      connectDoc({
        relay: 'ws://127.0.0.1:9',
        name: `${ROOM}/wrong`,
        token: TOKEN,
        doc: makeDoc('wrong', 'x'),
        user: USER,
        record: freshRecord(),
        socket,
      })
    ).toThrow(/socket is for/)
  })

  it(
    'keeps auth per document: one doc is rejected while its neighbours sync',
    async () => {
      const socket = openSocket(relay.url, TOKEN)
      const good = [1, 2, 3].map((i) => attach(socket, `${ROOM}/ok${i}`, TOKEN))

      let reason: string | null = null
      const bad = attach(socket, `${OTHER}/nope`, TOKEN, (r) => {
        reason = r
      })

      // Concurrently, on the SAME socket: the rejection must not take the
      // connection (nor its neighbours) down with it.
      const outcomes = await Promise.allSettled([
        ...good.map(({ conn }) =>
          whenSynced(conn.provider, undefined, 30_000, () => null, { clock: new RealClock() })
        ),
        whenSynced(bad.conn.provider, undefined, 30_000, () => reason, { clock: new RealClock() }),
      ])

      expect(outcomes.slice(0, 3).map((o) => o.status)).toEqual([
        'fulfilled',
        'fulfilled',
        'fulfilled',
      ])
      const rejected = outcomes[3]!
      expect(rejected.status).toBe('rejected')
      expect(String((rejected as PromiseRejectedResult).reason)).toContain('out_of_scope')

      // `reportAuthFailure`'s input still arrives, per doc — and says why: a document outside the share.
      expect(reason).toBe('out_of_scope')
      // …and the sync record for that doc tells the truth (golden rule 4).
      expect(bad.record.synced).toBe(false)
      expect(bad.record.connected).toBe(false)
      for (const { record } of good) expect(record.synced).toBe(true)

      expect(opened).toBe(1)
      expect(socket.attached).toBe(4)
      expect(socket.websocket.status).toBe('connected')
    },
    60_000
  )

  it(
    'whenSynced resolves on events — no periodic timer is ever scheduled',
    async () => {
      const socket = openSocket(relay.url, TOKEN)
      const { conn } = attach(socket, `${ROOM}/nopoll`, TOKEN)

      const sim = new SimClock()
      const pending = whenSynced(conn.provider, undefined, 60_000, () => null, { clock: sim })

      // Exactly one task: the dead-relay backstop. The old 50ms poll would
      // have re-scheduled a task per tick — and would never resolve at all
      // without the test advancing simulated time.
      expect(sim.pendingCount()).toBe(1)
      let maxPending = 0
      const sampler = setInterval(() => {
        maxPending = Math.max(maxPending, sim.pendingCount())
      }, 5)
      await pending
      clearInterval(sampler)

      expect(maxPending).toBeLessThanOrEqual(1)
      expect(sim.now()).toBe(0)
      // The backstop is cancelled on settle — no timer outlives the wait.
      expect(sim.pendingCount()).toBe(0)
    },
    60_000
  )

  it(
    'the group watchdog aborts a stalled pull after stallMs',
    async () => {
      const dead = `ws://127.0.0.1:${await closedPort()}`
      const socket = openSocket(dead, TOKEN)
      const { conn } = attach(socket, `${ROOM}/unreachable`, TOKEN)

      const sim = new SimClock()
      const tracker = new ProgressTracker({ clock: sim, total: 1, stallMs: 20_000 })
      // timeoutMs 0: the backstop is out of the picture, the watchdog is the
      // only thing that can end this wait.
      const pending = whenSynced(conn.provider, undefined, 0, () => null, { progress: tracker })
      let settled = false
      void pending.catch(() => {
        settled = true
      })

      sim.advance(19_999)
      await tick()
      expect(settled).toBe(false)

      sim.advance(1)
      await expect(pending).rejects.toThrow(/relay stalled: no document synced for 20000ms/)
      expect(tracker.waiting).toBe(0)
    },
    60_000
  )

  it(
    'the watchdog does not fire while ANY doc in the group keeps syncing',
    async () => {
      const dead = `ws://127.0.0.1:${await closedPort()}`
      const socket = openSocket(dead, TOKEN)
      const { conn } = attach(socket, `${ROOM}/slow`, TOKEN)

      const sim = new SimClock()
      const tracker = new ProgressTracker({ clock: sim, total: 4, stallMs: 20_000 })
      const pending = whenSynced(conn.provider, undefined, 0, () => null, { progress: tracker })
      let settled = false
      void pending.catch(() => {
        settled = true
      })

      // 45 simulated seconds pass — more than twice the stall budget — but a
      // sibling in the group syncs every 15s, so nothing has gone quiet.
      for (let i = 0; i < 3; i++) {
        sim.advance(15_000)
        await tick()
        expect(settled).toBe(false)
        tracker.noteSynced()
      }
      expect(tracker.synced).toBe(3)

      // Now the group goes quiet: 20s later, and not before, it aborts.
      sim.advance(19_999)
      await tick()
      expect(settled).toBe(false)
      sim.advance(1)
      await expect(pending).rejects.toThrow(/3\/4 synced/)
    },
    60_000
  )
})
