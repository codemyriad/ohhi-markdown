/**
 * First-join progress (device-link N2; spike S10-Q4 §"Where the progress
 * signal comes from"). A linked device sits for the whole pull *and* the
 * whole materialize; the second of those is ~92% of the wait and used to
 * report nothing at all. This pins both phases as the host sees them.
 *
 * Against the REAL relay (the child process the pull bench spawns), for the
 * same reason `providers.test.ts` is: the numerator is `provider.synced`
 * flipping and the denominator is the folder map arriving over a socket —
 * neither is a claim a mock could settle. Three files, not a corpus: the
 * shape of the report is under test, not the throughput.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import {
  BlobDocStore,
  FileJournal,
  JsonFileLcaStore,
  lcaGuard,
  MemStoreDir,
  MemVaultAdapter,
  MountsFile,
  scopedStoreDir,
  type StoreDir,
} from '@ohhi/vault'
import { RealClock } from '@ohhi/testkit'
import { startRelay, type RelayHandle } from '../bench/relay-child.js'
import { MountSession } from '../src/mount-session.js'
import { FOLDER_RECORD_KEY, type PullProgress, type SyncRecordFields } from '../src/types.js'

const ROOM = 'pullroom'
const TOKEN = 'pull-token'
const SEED = {
  'notes/welcome.md': '# Welcome\n\nthe first note\n',
  'notes/ideas.md': '# Ideas\n\n- one\n- two\n',
  'journal/2026-09-10.md': 'today\n',
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function freshRecord(): SyncRecordFields {
  return { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
}

interface Peer {
  session: MountSession
  records: Map<string, SyncRecordFields>
  adapter: MemVaultAdapter
  progress: PullProgress[]
}

async function boot(opts: {
  adapter: MemVaultAdapter
  relay: { url: string; token: string }
  firstJoin?: boolean
}): Promise<Peer> {
  const engine = createYjsEngine()
  const clock = new RealClock()
  const root: StoreDir = new MemStoreDir()
  const dir = scopedStoreDir(root, `${ROOM}/`)
  const docStore = new BlobDocStore(engine, dir, clock)
  const records = new Map<string, SyncRecordFields>()
  const progress: PullProgress[] = []
  const session = await MountSession.create({
    engine,
    adapter: opts.adapter,
    user: { name: 'Chris', color: '#000000' },
    room: ROOM,
    relay: opts.relay,
    ...(opts.firstJoin ? { firstJoin: true } : {}),
    clock,
    lcaStore: lcaGuard(docStore, new JsonFileLcaStore(dir.io('lca.json'))),
    journal: new FileJournal(dir, { now: () => clock.now() }),
    docStore,
    mountsFile: new MountsFile(root.io('mounts.json')),
    mountPath: '',
    recordFor: (key) => {
      let rec = records.get(key)
      if (!rec) {
        rec = freshRecord()
        records.set(key, rec)
      }
      return rec
    },
    makeShareLink: (relay, room) => `test:${relay.url}#${room}`,
    events: {
      onPullProgress: (p) => progress.push(p),
    },
  })
  return { session, records, adapter: opts.adapter, progress }
}

/** Poll a predicate — a real relay is involved, so this is genuine I/O. */
async function until(label: string, ok: () => boolean, timeoutMs = 20_000): Promise<void> {
  const started = Date.now()
  for (;;) {
    if (ok()) return
    if (Date.now() - started > timeoutMs) throw new Error(`${label}: timed out`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('first-join progress', () => {
  let dataDir: string
  let relay: RelayHandle

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'editor-pull-progress-'))
    relay = await startRelay({ dataDir, seedShare: `${ROOM}:${TOKEN}` })
  }, 60_000)

  afterAll(async () => {
    await relay?.stop()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it(
    'reports pull then write, both against the map\'s own denominator',
    async () => {
      // Arrange: a seeded room, durably acked, then the seeder goes away — a
      // linked device pulls from the relay, not from a live peer.
      const seedAdapter = new MemVaultAdapter()
      for (const [path, text] of Object.entries(SEED)) {
        await seedAdapter.writeAtomic(path, enc.encode(text))
      }
      const seeder = await boot({ adapter: seedAdapter, relay: { url: relay.url, token: TOKEN } })
      await until('seed acked', () => {
        if (!seeder.records.get(FOLDER_RECORD_KEY)?.synced) return false
        const docs = [...seeder.records].filter(([k]) => k !== FOLDER_RECORD_KEY)
        return docs.length === 3 && docs.every(([, r]) => r.synced && !r.pendingLocal)
      })
      await seeder.session.shutdown()

      // Act: a fresh device over an EMPTY vault.
      const joiner = await boot({
        adapter: new MemVaultAdapter(),
        relay: { url: relay.url, token: TOKEN },
        firstJoin: true,
      })

      // Assert — the denominator arrives with the map, before any doc syncs.
      const pulls = joiner.progress.filter((p) => p.phase === 'pull')
      const writes = joiner.progress.filter((p) => p.phase === 'write')
      expect(pulls[0]).toEqual({ phase: 'pull', done: 0, total: 3 })
      expect(pulls.at(-1)).toEqual({ phase: 'pull', done: 3, total: 3 })
      // …and the write phase counts the same three files onto disk.
      expect(writes[0]).toEqual({ phase: 'write', done: 0, total: 3 })
      expect(writes.at(-1)).toEqual({ phase: 'write', done: 3, total: 3 })
      // Monotonic within a phase: a progress line that goes backwards is worse
      // than none.
      for (const phase of [pulls, writes]) {
        for (let i = 1; i < phase.length; i++) {
          expect(phase[i]!.done).toBeGreaterThanOrEqual(phase[i - 1]!.done)
        }
      }
      // The pull phase is fully reported before the write phase starts.
      expect(joiner.progress.findIndex((p) => p.phase === 'write')).toBe(pulls.length)

      // The files really landed (the count is not a fiction).
      for (const [path, text] of Object.entries(SEED)) {
        expect(dec.decode((await joiner.adapter.read(path))!)).toBe(text)
      }

      // Every doc rides the mount's ONE socket, and every record says so.
      // Regression: a doc that attaches to an already-open shared socket is
      // handed `onOpen` but never a `status` event, so its record read
      // connected:false — a pill saying "offline" about a doc that had just
      // synced (golden rule 4). The pull attaches every doc AFTER the folder
      // doc opened the socket, so this is exactly that case.
      for (const [key, rec] of joiner.records) {
        expect({ key, ...rec }).toMatchObject({ connected: true, synced: true })
      }

      await joiner.session.shutdown()
    },
    60_000
  )
})
