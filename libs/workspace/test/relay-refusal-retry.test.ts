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
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { RealClock } from '@ohhi/testkit'
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
import { MountSession } from '../src/mount-session.js'
import { connectDoc, whenSynced } from '../src/providers.js'
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

async function bootLocal(room: string, files: Record<string, string>): Promise<Booted> {
  const engine = createYjsEngine()
  const clock = new RealClock()
  const storeRoot = new MemStoreDir()
  const dir = scopedStoreDir(storeRoot, `${room}/`)
  const docStore = new BlobDocStore(engine, dir, clock)
  const records = new Map<string, SyncRecordFields>()
  const events: AppEvent[] = []
  const errors: unknown[] = []
  const session = await MountSession.create({
    engine,
    adapter: await seedAdapter(files),
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
  })
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

      // The relay can open it again. Nobody relaunches, nothing drops the socket.
      putRelayDocState(relay, `${room}/${a}`, null)

      await until('a.md synced after the retry', () => dev.records.get(a)?.synced === true, 30_000)
      await until('the room reads connected', () => dev.relayStates().at(-1) === 'connected', 30_000)
      expect(dev.records.get(FOLDER_RECORD_KEY)?.synced).toBe(true)
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
