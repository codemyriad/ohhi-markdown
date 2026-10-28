/**
 * A refusal the relay can take back is retried; one it cannot is not.
 *
 * The relay names the two refusals that are about the credential
 * (`unknown_token`, `out_of_scope`). Anything else reaches the client as a
 * bare `permission-denied`: Hocuspocus answers ANY throw while it sets a
 * document up — loading its stored state included — that way. That says the
 * relay could not open this document right now, not that this device may not
 * have it, and a mount that treated it as final stayed "refused" until the
 * app was relaunched, because nothing ever asked the relay again while the
 * room's socket stayed open (its other documents kept it alive).
 *
 * Real relay (child process), real sockets, `RealClock`. The relay is made
 * to fail one document's load by writing a stored state that is not a Yjs
 * update into its database, and is "repaired" by deleting it.
 *
 * The retry run's own rules (backoff, settle, the cap, a final refusal that
 * stands) are pinned on a `SimClock` against scripted connections: the
 * relay's answers are fired by hand (`fakeRelay`), so a run of ten retries
 * costs nothing and the order of events is exact.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import { createYjsEngine } from '@ohhi/sync'
import { RealClock, SimClock, type Clock } from '@ohhi/testkit'
import {
  BlobDocStore,
  FileJournal,
  JsonFileLcaStore,
  lcaGuard,
  MemStoreDir,
  MountsFile,
  scopedStoreDir,
} from '@ohhi/vault'
import type { AppEvent } from '../src/events.js'
import { MountSession, REFUSAL_RETRY_LIMIT, REFUSAL_SETTLE_MS } from '../src/mount-session.js'
import { connectDoc, whenSynced, type ConnectDocOptions, type DocConnection } from '../src/providers.js'
import { FOLDER_RECORD_KEY, type SyncRecordFields } from '../src/types.js'
import {
  encodeShareLink,
  mintShare,
  putRelayDocState,
  seedAdapter,
  startTestRelay,
  until,
  type TestRelay,
} from './device-link-harness.js'

/**
 * Scripted connections (the `SimClock` cases): while `fakeRelay.on`, every
 * `connectDoc` the mount makes is recorded instead of opening a socket, and
 * the test plays the relay — status changes and refusals — by hand.
 */
interface FakeConn {
  name: string
  opts: ConnectDocOptions
  awareness: Awareness
  destroyed: boolean
}
const fakeRelay = vi.hoisted(() => ({ on: false, conns: [] as FakeConn[] }))

vi.mock('../src/providers.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/providers.js')>()
  return {
    ...real,
    connectDoc: (o: ConnectDocOptions) => (fakeRelay.on ? fakeConnect(o) : real.connectDoc(o)),
    createRoomSocket: (...args: Parameters<typeof real.createRoomSocket>) =>
      fakeRelay.on
        ? { relay: args[0], token: args[1], websocket: {}, attached: 0, destroy: () => {} }
        : real.createRoomSocket(...args),
  }
})

function fakeConnect(o: ConnectDocOptions): DocConnection {
  const raw = o.doc.raw() as ConstructorParameters<typeof Awareness>[0]
  const awareness = o.awareness && o.awareness.doc === raw ? o.awareness : new Awareness(raw)
  awareness.setLocalStateField('user', { name: o.user.name, color: o.user.color })
  const conn: FakeConn = { name: o.name, opts: o, awareness, destroyed: false }
  fakeRelay.conns.push(conn)
  return {
    provider: { configuration: { name: o.name } } as unknown as DocConnection['provider'],
    awareness,
    shared: true,
    destroy: (d = {}) => {
      conn.destroyed = true
      if (!d.keepAwareness) awareness.destroy()
    },
  }
}

/** The live scripted connections. */
const liveConns = (): FakeConn[] => fakeRelay.conns.filter((c) => !c.destroyed)

/** The relay's socket changed state: every live connection hears it. */
function socketStatus(status: 'connected' | 'disconnected'): void {
  for (const c of liveConns()) {
    c.opts.record.connected = status === 'connected'
    if (status !== 'connected') c.opts.record.synced = false
    c.opts.onStatus?.(status)
  }
}

/** The relay refused the live connection of one doc. */
function refuse(name: string, reason: string): void {
  const c = liveConns().find((x) => x.name === name)
  if (!c) throw new Error(`no live connection for ${name}`)
  c.opts.record.connected = false
  c.opts.onAuthFailed?.(reason)
}

/** Not a Yjs update: the relay's load of it throws ("Unexpected end of array"). */
const UNLOADABLE = new Uint8Array([0xff, 0xff, 0xff, 0xff])

interface Booted {
  session: MountSession
  room: string
  records: Map<string, SyncRecordFields>
  events: AppEvent[]
  errors: unknown[]
  relayStates: () => string[]
}

interface BootOptions {
  clock?: Clock
  /** Pull the room from the relay instead of enrolling `files` (a first join). */
  join?: { url: string; token: string }
}

async function bootLocal(room: string, files: Record<string, string>, o: BootOptions = {}): Promise<Booted> {
  const started = startLocal(room, files, o)
  return { ...started, session: await started.session }
}

/** `bootLocal` with the session still booting: its events are readable even if the boot fails. */
function startLocal(
  room: string,
  files: Record<string, string>,
  o: BootOptions = {}
): Omit<Booted, 'session'> & { session: Promise<MountSession> } {
  const engine = createYjsEngine()
  const clock = o.clock ?? new RealClock()
  const storeRoot = new MemStoreDir()
  const dir = scopedStoreDir(storeRoot, `${room}/`)
  const docStore = new BlobDocStore(engine, dir, clock)
  const records = new Map<string, SyncRecordFields>()
  const events: AppEvent[] = []
  const errors: unknown[] = []
  const session = seedAdapter(files).then((adapter) => MountSession.create({
    engine,
    adapter,
    ...(o.join ? { firstJoin: true, relay: o.join } : {}),
    user: { name: 'device', color: '#000000' },
    room,
    clock,
    lcaStore: lcaGuard(docStore, new JsonFileLcaStore(dir.io('lca.json'))),
    journal: new FileJournal(dir, { now: () => clock.now() }),
    docStore,
    mountsFile: new MountsFile(storeRoot.io('mounts.json')),
    mountPath: '',
    recordFor: (key) => {
      let rec = records.get(key)
      if (!rec) {
        rec = { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
        records.set(key, rec)
      }
      return rec
    },
    makeShareLink: (relay, r) => encodeShareLink({ relay: relay.url, room: r, token: relay.token }),
    events: {
      onError: (err) => errors.push(err),
      onEvent: (e) => events.push(e),
    },
  }))
  const relayStates = (): string[] =>
    events
      .filter((e) => e.kind === 'relay.state')
      .map((e) => {
        const p = (e as AppEvent<'relay.state'>).payload
        return p.reason ? `${p.to}:${p.reason}` : p.to
      })
  return { session, room, records, events, errors, relayStates }
}

const guidOf = (session: MountSession, path: string): string =>
  session.files().find((r) => r.path === path)!.guid

/** What the relay holds for one text doc, read by a fresh client. */
async function relayText(relay: TestRelay, token: string, name: string): Promise<string> {
  const doc = createYjsEngine().createDoc(name.split('/')[1]!)
  const record: SyncRecordFields = {
    connected: false,
    synced: false,
    pendingLocal: false,
    diskMatchesCrdt: true,
    diverged: false,
  }
  const conn = connectDoc({ relay: relay.url, name, token, doc, user: { name: 'probe', color: '#000' }, record })
  try {
    await whenSynced(conn.provider, undefined, 10_000)
    return doc.getText()
  } finally {
    conn.destroy()
    doc.destroy()
  }
}

/** Whether a fresh peer on `name` sees `who` in the doc's awareness. */
async function peerSees(relay: TestRelay, token: string, name: string, who: string): Promise<void> {
  const doc = createYjsEngine().createDoc(name.split('/')[1]!)
  const record: SyncRecordFields = {
    connected: false,
    synced: false,
    pendingLocal: false,
    diskMatchesCrdt: true,
    diverged: false,
  }
  const conn = connectDoc({ relay: relay.url, name, token, doc, user: { name: 'probe', color: '#000' }, record })
  try {
    await until(`the peer sees ${who} on ${name}`, () =>
      [...conn.awareness.getStates()].some(
        ([id, st]) => id !== conn.awareness.clientID && (st as { user?: { name?: string } }).user?.name === who
      )
    )
  } finally {
    conn.destroy()
    doc.destroy()
  }
}

describe('a refusal the relay can take back is retried, without a relaunch', () => {
  let relay: TestRelay
  const sessions: MountSession[] = []

  beforeAll(async () => {
    relay = await startTestRelay('refusal-retry')
  }, 60_000)

  afterAll(async () => {
    await relay?.stop()
  }, 30_000)

  afterEach(async () => {
    for (const s of sessions.splice(0)) await s.shutdown()
  })

  it(
    'a document the relay fails to set up refuses the room, and the room recovers once the relay can',
    async () => {
      const room = crypto.randomUUID()
      const { token } = await mintShare(relay, { folderGuid: room, kind: 'device' })
      const dev = await bootLocal(room, { 'a.md': 'alpha\n', 'b.md': 'beta\n' })
      sessions.push(dev.session)
      const a = guidOf(dev.session, 'a.md')
      const b = guidOf(dev.session, 'b.md')

      // The relay cannot load a.md (its stored state is not an update); b.md
      // and the folder doc are fine and keep the room's socket alive.
      putRelayDocState(relay, `${room}/${a}`, UNLOADABLE)
      dev.session.enableSharing({ url: relay.url, token })

      await until('a.md refused', () => dev.relayStates().some((s) => s === 'refused:permission-denied'))
      await until('b.md synced', () => dev.records.get(b)?.synced === true)
      // Not a credential problem: nothing tells the host the token is dead.
      expect(dev.errors.filter((e) => (e as { code?: string }).code === 'relay.refused')).toEqual([])
      // An editor open on b.md is bound to this awareness.
      const awarenessB = dev.session.awarenessForPath('b.md')
      expect(awarenessB).not.toBeNull()

      // The relay can open it again. Nobody relaunches, nothing drops the socket.
      putRelayDocState(relay, `${room}/${a}`, null)

      await until('a.md synced after the retry', () => dev.records.get(a)?.synced === true, 30_000)
      await until('the room reads connected', () => dev.relayStates().at(-1) === 'connected', 30_000)
      expect(dev.records.get(FOLDER_RECORD_KEY)?.synced).toBe(true)
      // The retry rebuilt every connection of the room, and the awareness the
      // editor holds is still the doc's: alive, with this device in it, and
      // carried by the new connection — a peer sees this device on b.md.
      expect(dev.session.awarenessForPath('b.md')).toBe(awarenessB)
      expect((awarenessB!.getLocalState() as { user?: { name?: string } } | null)?.user?.name).toBe('device')
      await peerSees(relay, token, `${room}/${b}`, 'device')
      // The history says what happened, in order, once each: refused, a retry
      // in progress, back.
      expect(dev.relayStates()).toEqual([
        'connected',
        'refused:permission-denied',
        'reconnecting',
        'connected',
      ])
      // And an edit made now reaches the relay.
      dev.session.docForPath('a.md')!.transact((t) => t.insert(0, 'edited '), 'local')
      await until('the edit is acked', () => {
        const rec = dev.records.get(a)
        return rec?.synced === true && rec.pendingLocal === false
      })
      expect(await relayText(relay, token, `${room}/${a}`)).toBe('edited alpha\n')
    },
    60_000
  )

  it(
    'a retry that is refused again stays one retry in progress, backing off, until the relay can',
    async () => {
      const room = crypto.randomUUID()
      const { token } = await mintShare(relay, { folderGuid: room, kind: 'device' })
      const dev = await bootLocal(room, { 'a.md': 'alpha\n', 'b.md': 'beta\n' })
      sessions.push(dev.session)
      const a = guidOf(dev.session, 'a.md')
      putRelayDocState(relay, `${room}/${a}`, UNLOADABLE)
      dev.session.enableSharing({ url: relay.url, token })

      await until('refused', () => dev.relayStates().includes('refused:permission-denied'))
      // Through the first retry (1 s) and into the second (2 s more): each is
      // refused again by the same unloadable document.
      await until('first retry', () => dev.relayStates().includes('reconnecting'))
      await new Promise((r) => setTimeout(r, 2_500))
      expect(dev.records.get(a)?.synced).not.toBe(true)
      putRelayDocState(relay, `${room}/${a}`, null)

      await until('a.md synced', () => dev.records.get(a)?.synced === true, 30_000)
      await until('connected', () => dev.relayStates().at(-1) === 'connected', 30_000)
      // No connected/refused flapping while it retried: one refusal, one
      // retry in progress, back.
      expect(dev.relayStates()).toEqual(['connected', 'refused:permission-denied', 'reconnecting', 'connected'])
    },
    60_000
  )

  it(
    'a first join refused mid-pull fails at once, and the failed session is shut down',
    async () => {
      const room = crypto.randomUUID()
      const { token } = await mintShare(relay, { folderGuid: room, kind: 'device' })
      const owner = await bootLocal(room, { 'a.md': 'alpha\n', 'b.md': 'beta\n' })
      sessions.push(owner.session)
      const a = guidOf(owner.session, 'a.md')
      const b = guidOf(owner.session, 'b.md')
      putRelayDocState(relay, `${room}/${a}`, UNLOADABLE)
      owner.session.enableSharing({ url: relay.url, token })
      await until('the owner pushed b.md', () => owner.records.get(b)?.synced === true)
      await until('the owner pushed the map', () => owner.records.get(FOLDER_RECORD_KEY)?.synced === true)

      // A second device pulls the room. The relay cannot open a.md for it
      // either: the pull fails now, with the relay's refusal — not after the
      // pull's 20 s watchdog, waiting on connections a retry tore down.
      const joiner = startLocal(room, {}, { join: { url: relay.url, token } })
      const started = Date.now()
      await expect(joiner.session).rejects.toThrow(/permission-denied/)
      expect(Date.now() - started).toBeLessThan(10_000)

      // Nothing of the failed session goes on: no retry rebuilds its room.
      const after = joiner.relayStates().length
      await new Promise((r) => setTimeout(r, 2_500))
      expect(joiner.relayStates().length).toBe(after)
      expect(joiner.relayStates()).not.toContain('reconnecting')
    },
    60_000
  )

  it(
    'a credential refusal stays refused: retrying cannot change it',
    async () => {
      const room = crypto.randomUUID()
      const dev = await bootLocal(room, { 'a.md': 'alpha\n' })
      sessions.push(dev.session)
      dev.session.enableSharing({ url: relay.url, token: 'not-a-token-the-relay-knows' })

      await until('refused', () => dev.relayStates().includes('refused:unknown_token'))
      // Long enough for several retries had it been treated as transient.
      await new Promise((r) => setTimeout(r, 4_000))
      expect(dev.relayStates().filter((s) => s === 'reconnecting')).toEqual([])
      expect(dev.errors.some((e) => (e as { code?: string }).code === 'relay.refused')).toBe(true)
    },
    30_000
  )
})

describe('the retry run, step by step (scripted relay, SimClock)', () => {
  const sessions: MountSession[] = []
  const RELAY = { url: 'ws://relay.invalid', token: 'device-token' }

  beforeAll(() => {
    fakeRelay.on = true
  })

  afterAll(() => {
    fakeRelay.on = false
  })

  afterEach(async () => {
    for (const s of sessions.splice(0)) await s.shutdown()
    fakeRelay.conns.length = 0
  })

  /** A shared room of two notes on a scripted relay, its socket up. */
  async function sharedRoom() {
    const clock = new SimClock()
    const room = crypto.randomUUID()
    const dev = await bootLocal(room, { 'a.md': 'alpha\n', 'b.md': 'beta\n' }, { clock })
    sessions.push(dev.session)
    dev.session.enableSharing(RELAY)
    socketStatus('connected')
    const docName = (path: string): string => `${room}/${guidOf(dev.session, path)}`
    return { ...dev, clock, docName }
  }

  /** One retry: its wait runs out, the rebuilt socket comes up. */
  function retryRuns(clock: SimClock, wait: number): void {
    clock.advance(wait)
    socketStatus('connected')
  }

  const refusedEvents = (events: AppEvent[]): AppEvent<'relay.state'>[] =>
    events.filter(
      (e): e is AppEvent<'relay.state'> =>
        e.kind === 'relay.state' && (e as AppEvent<'relay.state'>).payload.to === 'refused'
    )

  it('a retryable refusal is logged as a retry in progress, not as an error', async () => {
    const dev = await sharedRoom()
    refuse(dev.docName('a.md'), 'permission-denied')

    const [refused] = refusedEvents(dev.events)
    expect(refused?.level).toBe('info')
    expect(refused?.payload).toMatchObject({ reason: 'permission-denied', retrying: true })
    expect(dev.errors).toEqual([])
  })

  it('keeps every awareness across a retry: the editor’s instance is the new connection’s', async () => {
    const dev = await sharedRoom()
    const before = dev.session.awarenessForPath('b.md')!
    const folderBefore = liveConns().find((c) => c.name.endsWith('/folder'))!.awareness
    refuse(dev.docName('a.md'), 'permission-denied')
    retryRuns(dev.clock, 1_000)

    expect(dev.session.awarenessForPath('b.md')).toBe(before)
    expect(liveConns().find((c) => c.name === dev.docName('b.md'))!.awareness).toBe(before)
    expect(liveConns().find((c) => c.name.endsWith('/folder'))!.awareness).toBe(folderBefore)
    // Alive, with this device's state still in it.
    expect((before.getLocalState() as { user?: { name?: string } } | null)?.user?.name).toBe('device')
  })

  it('keeps every awareness across a re-key (`enableSharing` on a shared room)', async () => {
    const dev = await sharedRoom()
    const before = dev.session.awarenessForPath('a.md')!
    dev.session.enableSharing({ url: RELAY.url, token: 'a-new-token' })

    expect(dev.session.awarenessForPath('a.md')).toBe(before)
    expect((before.getLocalState() as { user?: { name?: string } } | null)?.user?.name).toBe('device')
  })

  it('a final refusal stands: a retryable one after it starts no retry run', async () => {
    const dev = await sharedRoom()
    refuse(dev.docName('a.md'), 'out_of_scope')
    const conns = fakeRelay.conns.length
    const logged = dev.relayStates().length

    // Another doc of the room fails to load on the relay.
    refuse(dev.docName('b.md'), 'permission-denied')
    dev.clock.advance(10 * 60_000)

    // No rebuild, nothing new in the history: the credential refusal holds.
    expect(fakeRelay.conns.length).toBe(conns)
    expect(dev.relayStates().length).toBe(logged)
    expect(dev.relayStates().at(-1)).toBe('refused:out_of_scope')
  })

  it('a network blip while a retry waits settles nothing and resets no backoff', async () => {
    const dev = await sharedRoom()
    const a = dev.docName('a.md')
    refuse(a, 'permission-denied')
    // Two retries, each refused again: the next wait is 4 s, longer than the
    // settle window.
    retryRuns(dev.clock, 1_000)
    refuse(a, 'permission-denied')
    retryRuns(dev.clock, 2_000)
    refuse(a, 'permission-denied')

    // The old socket drops and comes back during the wait.
    socketStatus('disconnected')
    socketStatus('connected')
    dev.clock.advance(REFUSAL_SETTLE_MS + 500)
    // Nothing settled: the room is still the same retry in progress.
    expect(dev.relayStates()).toEqual(['connected', 'refused:permission-denied', 'reconnecting'])

    // The retry runs when it was due, the relay can open a.md now, and only
    // a retry that holds for the settle window reads `connected`.
    const conns = fakeRelay.conns.length
    retryRuns(dev.clock, 4_000 - REFUSAL_SETTLE_MS - 500)
    expect(fakeRelay.conns.length).toBeGreaterThan(conns)
    expect(dev.relayStates().at(-1)).toBe('reconnecting')
    dev.clock.advance(REFUSAL_SETTLE_MS)
    expect(dev.relayStates()).toEqual(['connected', 'refused:permission-denied', 'reconnecting', 'connected'])
  })

  it(`gives up after ${REFUSAL_RETRY_LIMIT} retries: the refusal is then final, and said so`, async () => {
    const dev = await sharedRoom()
    const a = dev.docName('a.md')
    refuse(a, 'permission-denied')
    for (let i = 0; i < REFUSAL_RETRY_LIMIT; i++) {
      retryRuns(dev.clock, 60_000)
      refuse(a, 'permission-denied')
    }

    // The last refusal is an error, raised as a refusal, with no retry left.
    const refused = refusedEvents(dev.events)
    expect(refused.map((e) => [e.level, e.payload.retrying ?? false])).toEqual([
      ['info', true],
      ['error', false],
    ])
    expect(dev.errors.some((e) => (e as { code?: string }).code === 'relay.refused')).toBe(true)
    const conns = fakeRelay.conns.length
    dev.clock.advance(10 * 60_000)
    expect(fakeRelay.conns.length).toBe(conns)
  })
})
