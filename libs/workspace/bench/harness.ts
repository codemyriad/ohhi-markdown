/**
 * Spike S10-Q4 — headless MountSession over a real filesystem and a real
 * relay, instrumented.
 *
 * Timing note (golden rule 5): this is a BENCH, not Editor-owned sync code —
 * it measures wall-clock, so it uses `performance.now()`/`Date.now()`
 * directly. Nothing here schedules work inside the library; the session still
 * gets an injected `RealClock`, and no ambient timer is added to any
 * `libs/*` source.
 *
 * What is instrumented, and why it is what a host could instrument too:
 * - the `recordFor` records the session mutates (`synced` per doc + folder) —
 *   the transitions a progress line would count;
 * - the VaultAdapter's `writeAtomic` — the materialize phase, which has no
 *   per-file host event today;
 * - the StoreDir's `writeAtomic` — durable-store write amplification (the
 *   LCA store rewrites the whole shadow file on every put);
 * - the WebSocket constructor — one socket per provider (concurrency).
 */
import { RealClock, type Clock } from '@ohhi/testkit'
import {
  BlobDocStore,
  FileJournal,
  JsonFileLcaStore,
  lcaGuard,
  MountsFile,
  scopedStoreDir,
  type FileStat,
  type StoreDir,
  type StoreIo,
  type VaultAdapter,
  type WatchEvent,
} from '@ohhi/vault'
import { NodeStoreDir, NodeVaultAdapter } from '@ohhi/vault/node'
import { createYjsEngine } from '@ohhi/sync'
import { MountSession } from '../src/mount-session.js'
import { FOLDER_RECORD_KEY, type SyncRecordFields } from '../src/types.js'

export const now = (): number => performance.now()

export interface Probe {
  /** First `synced = true` per record key (doc guid, or FOLDER_RECORD_KEY). */
  syncedAt: Map<string, number>
  /** Every record the session asked for (key → live record object). */
  records: Map<string, SyncRecordFields>
  /** Materialize phase: one entry per file written to the joiner's disk. */
  writes: { path: string; at: number }[]
  /** Durable-store writes by store-file name: how often, how many bytes. */
  storeWrites: Map<string, { count: number; bytes: number }>
  sockets: { opened: number; peak: number; open: number }
  /** Set by the caller: everything is measured relative to this. */
  t0: number
}

export function newProbe(): Probe {
  return {
    syncedAt: new Map(),
    records: new Map(),
    writes: [],
    storeWrites: new Map(),
    sockets: { opened: 0, peak: 0, open: 0 },
    t0: now(),
  }
}

/**
 * A WebSocket subclass that counts concurrent connections. Handed to the
 * session as `webSocketPolyfill` — the sanctioned non-browser path in
 * `providers.ts` (which builds one HocuspocusProviderWebsocket per doc).
 */
export function countingWebSocket(probe: Probe): typeof WebSocket {
  return class CountingWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols)
      probe.sockets.opened++
      probe.sockets.open++
      probe.sockets.peak = Math.max(probe.sockets.peak, probe.sockets.open)
      const drop = (): void => {
        probe.sockets.open = Math.max(0, probe.sockets.open - 1)
      }
      this.addEventListener('close', drop)
      this.addEventListener('error', drop)
    }
  } as unknown as typeof WebSocket
}

/** VaultAdapter wrapper that timestamps every file materialized to disk. */
function countingAdapter(inner: VaultAdapter, probe: Probe): VaultAdapter {
  return {
    list: (): Promise<FileStat[]> => inner.list(),
    listDirs: () => inner.listDirs(),
    read: (p) => inner.read(p),
    writeAtomic: async (p, bytes, opts) => {
      await inner.writeAtomic(p, bytes, opts)
      probe.writes.push({ path: p, at: now() })
    },
    rename: (a, b) => inner.rename(a, b),
    remove: (p) => inner.remove(p),
    mkdir: (p) => inner.mkdir(p),
    removeDir: (p) => inner.removeDir(p),
    renameDir: (a, b) => inner.renameDir(a, b),
    // `onError` is forwarded: a wrapper that drops it hides a dead watcher.
    watch: (cb: (ev: WatchEvent) => void, onError?: (err: unknown) => void) => inner.watch(cb, onError),
  }
}

/** StoreDir wrapper that counts durable-store write volume by file name. */
function countingStoreDir(base: StoreDir, probe: Probe): StoreDir {
  return {
    io: (name: string): StoreIo => {
      const io = base.io(name)
      return {
        read: () => io.read(),
        writeAtomic: async (bytes) => {
          await io.writeAtomic(bytes)
          // one bucket per store-file KIND: the per-doc blobs and the
          // journal's pre-image files would otherwise be thousands of rows.
          const key = name
            .replace(/docs\/.*/, 'docs/*')
            .replace(/journal\/(?!index\.json).*/, 'journal/*.bin')
          const cur = probe.storeWrites.get(key) ?? { count: 0, bytes: 0 }
          cur.count++
          cur.bytes += bytes.length
          probe.storeWrites.set(key, cur)
        },
      }
    },
    remove: (name) => base.remove(name),
    list: (prefix) => base.list(prefix),
  }
}

/** Records the session mutates in place; the Proxy timestamps `synced`. */
function instrumentedRecords(probe: Probe): (key: string) => SyncRecordFields {
  return (key: string): SyncRecordFields => {
    const existing = probe.records.get(key)
    if (existing) return existing
    const target: SyncRecordFields = {
      connected: false,
      synced: false,
      pendingLocal: false,
      diskMatchesCrdt: true,
      diverged: false,
    }
    const proxied = new Proxy(target, {
      set(t, prop, value): boolean {
        if (prop === 'synced' && value === true && !probe.syncedAt.has(key)) {
          probe.syncedAt.set(key, now())
        }
        return Reflect.set(t, prop, value)
      },
    })
    probe.records.set(key, proxied)
    return proxied
  }
}

export interface MountOpts {
  vaultDir: string
  storeRoot: string
  room: string
  relay?: { url: string; token: string }
  firstJoin?: boolean
  probe: Probe
  clock?: Clock
}

export async function createMount(opts: MountOpts): Promise<MountSession> {
  // The mass-change breaker can trip while `MountSession.create` is still
  // awaiting (the firstJoin materialize starts the watcher), so the confirm
  // has to survive the session reference not existing yet.
  let mount: MountSession | null = null
  const confirmBreaker = (): void => {
    if (mount) void mount.confirmBreaker()
    else setTimeout(confirmBreaker, 50)
  }
  const engine = createYjsEngine()
  const clock = opts.clock ?? new RealClock()
  const storeRoot = countingStoreDir(new NodeStoreDir(opts.storeRoot), opts.probe)
  const dir = scopedStoreDir(storeRoot, `${opts.room}/`)
  const docStore = new BlobDocStore(engine, dir, clock)
  mount = await MountSession.create({
    engine,
    adapter: countingAdapter(new NodeVaultAdapter(opts.vaultDir), opts.probe),
    user: { name: 'bench', color: '#000000' },
    room: opts.room,
    firstJoin: opts.firstJoin,
    relay: opts.relay,
    clock,
    lcaStore: lcaGuard(docStore, new JsonFileLcaStore(dir.io('lca.json'))),
    journal: new FileJournal(dir, { now: () => clock.now() }),
    docStore,
    mountsFile: new MountsFile(storeRoot.io('mounts.json')),
    mountPath: '',
    recordFor: instrumentedRecords(opts.probe),
    makeShareLink: (relay, room) => `bench:${relay.url}#${room}`,
    webSocketPolyfill: countingWebSocket(opts.probe),
    events: {
      // A host confirms the mass-change batch; unhandled it auto-confirms with
      // a console warning per batch, which would drown the bench output.
      onBreaker: () => confirmBreaker(),
      onError: (err) => {
        process.stderr.write(`[mount ${opts.room}] ${String(err)}\n`)
      },
    },
  })
  return mount
}

/** Every doc record plus the folder record: durable relay ack, pill-green. */
export function allSynced(probe: Probe, expected: number): boolean {
  if (!probe.records.get(FOLDER_RECORD_KEY)?.synced) return false
  let synced = 0
  for (const [key, rec] of probe.records) {
    if (key === FOLDER_RECORD_KEY) continue
    if (rec.synced && !rec.pendingLocal) synced++
  }
  return synced >= expected
}

export function countSynced(probe: Probe): number {
  let n = 0
  for (const [key, rec] of probe.records) {
    if (key !== FOLDER_RECORD_KEY && rec.synced) n++
  }
  return n
}

/** Poll a predicate; bench-side only (no library timer is involved). */
export async function waitFor(
  label: string,
  ok: () => boolean,
  timeoutMs: number,
  onTick?: () => void
): Promise<number> {
  const started = now()
  for (;;) {
    if (ok()) return now() - started
    if (now() - started > timeoutMs) throw new Error(`${label}: timed out after ${timeoutMs}ms`)
    onTick?.()
    await new Promise((r) => setTimeout(r, 100))
  }
}
