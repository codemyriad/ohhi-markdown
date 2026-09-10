/**
 * Shared vault fixture for the mount-lifecycle L1 tests (join/unshare/move/
 * adopt — the carve suite predates it and keeps its local twin). `bootVault`
 * boots a full multi-mount vault from mounts.json exactly the way the web shim
 * does: recoverMounts first, root over ignoringAdapter, mounts over
 * scopedAdapter, per-room store namespaces, guid-keyed records — and, since
 * N1, the derived ignore set plus the peer-side adopt machine on the root's
 * mount-entry hook.
 *
 * `bootDuo` (spike S10 Q5 "Where the fixtures go") is the two-device version:
 * two vaults over two MemVaultAdapters and two MemStoreDirs, wired to one
 * another by a `RoomNet` — a TestNetwork-shaped simulator that connects doc
 * instances BY NAME, which is what a relay room is. No relay process, no
 * sockets: mount rooms appear and disappear as the machines carve and absorb,
 * and the net links them the moment both sides create a doc of that name.
 */
import { createYjsEngine, type EngineDoc, type FileEntry, type SyncEngine } from '@editor/sync'
import {
  BlobDocStore,
  FileJournal,
  ignoringAdapter,
  isRecoverable,
  JsonFileLcaStore,
  lcaGuard,
  MemStoreDir,
  MemVaultAdapter,
  MountsFile,
  mountRootsFrom,
  scopedAdapter,
  scopedStoreDir,
  type MountDesc,
  type StoreDir,
  type StoreIo,
  type VaultAdapter,
} from '@editor/vault'
import { SimClock } from '@editor/testkit'
import { expect } from 'vitest'
import { carveFolder } from '../src/carve.js'
import { MountSession, type MountSessionConfig } from '../src/mount-session.js'
import { recoverMounts } from '../src/vault-boot.js'
import { mountInvariants, reconcileMountEntries, type AdoptContext, type AdoptNotice } from '../src/adopt.js'
import type { RelayConfig, SyncRecordFields } from '../src/types.js'

export const enc = new TextEncoder()
export const dec = new TextDecoder()

export function freshRecord(): SyncRecordFields {
  return { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
}

/** StoreDir that throws 'injected-crash' after `budget` mutating operations. */
export function crashingDir(base: StoreDir, budget: number): StoreDir {
  let left = budget
  const spend = (): void => {
    if (left <= 0) throw new Error('injected-crash')
    left--
  }
  return {
    io: (name): StoreIo => {
      const io = base.io(name)
      return {
        read: () => io.read(),
        writeAtomic: async (bytes) => {
          spend()
          await io.writeAtomic(bytes)
        },
      }
    },
    remove: async (name) => {
      spend()
      await base.remove(name)
    },
    list: (prefix) => base.list(prefix),
  }
}

export async function seedAdapter(files: Record<string, string>): Promise<MemVaultAdapter> {
  const adapter = new MemVaultAdapter()
  for (const [path, text] of Object.entries(files)) {
    await adapter.writeAtomic(path, enc.encode(text))
  }
  return adapter
}

export async function diskSnapshot(adapter: VaultAdapter): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const stat of await adapter.list()) {
    out[stat.path] = dec.decode((await adapter.read(stat.path))!)
  }
  return out
}

/**
 * A WebSocket that never opens. `enableSharing` is how a test makes a mount
 * relay-attached (which is what makes a carve ANNOUNCE), and it builds real
 * providers; handing them this keeps the suite hermetic — no sockets, no
 * retry timers, no reliance on a name failing to resolve. Cross-device
 * delivery is the RoomNet's job, not the providers'.
 */
export class DeadSocket {
  static readonly CONNECTING = 0
  readyState = 0
  binaryType = 'arraybuffer'
  onopen: unknown = null
  onmessage: unknown = null
  onclose: unknown = null
  onerror: unknown = null
  constructor(readonly url: string) {}
  send(): void {}
  close(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

// ------------------------------------------------------------------ the net

interface Frame {
  to: string
  name: string
  update: Uint8Array
}

/**
 * A relay room, simulated: doc instances that share a NAME exchange updates.
 * Frames are queued, never dropped (a partition delays delivery, exactly like
 * a relay holding updates for an offline peer), and a doc joining late is
 * handed the other side's full state — the sync handshake, in one frame.
 */
export class RoomNet {
  private byName = new Map<string, Map<string, EngineDoc>>()
  private queue: Frame[] = []
  private offline = new Set<string>()

  constructor(private engine: SyncEngine) {}

  /** Attach `doc` as `id`'s instance of the room doc called `name`. */
  join(id: string, name: string, doc: EngineDoc): void {
    const peers = this.byName.get(name) ?? new Map<string, EngineDoc>()
    for (const [otherId, other] of peers) {
      if (otherId === id) continue
      this.queue.push({ to: id, name, update: this.engine.encodeUpdateSince(other, null) })
      this.queue.push({ to: otherId, name, update: this.engine.encodeUpdateSince(doc, null) })
    }
    peers.set(id, doc) // replaces this device's previous instance (a rebuild)
    this.byName.set(name, peers)
    this.engine.onUpdate(doc, (update, origin) => {
      if (origin === 'remote') return
      if (this.byName.get(name)?.get(id) !== doc) return // a stale instance
      for (const otherId of this.byName.get(name)?.keys() ?? []) {
        if (otherId !== id) this.queue.push({ to: otherId, name, update })
      }
    })
  }

  /** Hold every frame for `id` until `online` (an offline device). */
  setOffline(id: string, off: boolean): void {
    if (off) this.offline.add(id)
    else this.offline.delete(id)
  }

  /** Deliver every deliverable frame, including ones they cause. */
  deliverAll(): void {
    for (let guard = 0; guard < 10_000; guard++) {
      const idx = this.queue.findIndex((f) => !this.offline.has(f.to))
      if (idx === -1) return
      const frame = this.queue.splice(idx, 1)[0]!
      const doc = this.byName.get(frame.name)?.get(frame.to)
      if (!doc) continue
      try {
        this.engine.applyUpdate(doc, frame.update, 'remote')
      } catch {
        // A doc destroyed between queueing and delivery (a shutdown mid-flight)
        // is not an error: its successor gets the state on join.
      }
    }
    throw new Error('RoomNet.deliverAll did not quiesce')
  }
}

/** Wrap an engine so every doc it creates is announced (for the RoomNet). */
function tapEngine(base: SyncEngine, onDoc: (name: string, doc: EngineDoc) => void): SyncEngine {
  return {
    ...base,
    createDoc: (name: string) => {
      const doc = base.createDoc(name)
      // Throwaway temp docs (carve-tmp:, absorb-*, recover-*) carry a ':' and
      // are never room docs — they must not be wired to anything.
      if (!name.includes(':')) onDoc(name, doc)
      return doc
    },
  }
}

// --------------------------------------------------------------- the device

export interface BootedVault {
  engine: SyncEngine
  clock: SimClock
  root: MountSession
  mounts: Map<string, MountSession>
  mountsFile: MountsFile
  vaultDir: StoreDir
  adapter: VaultAdapter
  /** The live ignore set the root's adapter reads on every call. */
  ignore: Set<string>
  /** mounts.json as this vault last read it (refreshed by every machine). */
  descs: () => readonly MountDesc[]
  /** Root ('') + every mount, the shape MountRegistry.all() returns. */
  registry: () => { mountPath: string; session: MountSession }[]
  /** The boot pass: the second of the adopt machine's two entry points. */
  reconcile: () => Promise<void>
  /** Re-read mounts.json into the mirror and recompute the ignore set. */
  refreshDescs: () => Promise<void>
  /** The live instance of a room doc by name (`<room>/folder`, or a guid). */
  docFor: (name: string) => EngineDoc | null
  events: {
    reviews: { guid: string; path: string; reason: string }[]
    notices: AdoptNotice[]
    /** Every mount the adopt machine asked for, and whether it wanted a pull. */
    builds: { room: string; path: string; firstJoin: boolean }[]
  }
  makeSession: (
    room: string,
    adapter: VaultAdapter,
    mountPath: string,
    extra?: Partial<MountSessionConfig>
  ) => Promise<MountSession>
  dispose: () => void
}

export interface BootOptions {
  /** Share the root room with the other device (and announce carves). */
  net?: RoomNet
  /** This device's id on the net. */
  deviceId?: string
  /** Engine to build on (bootDuo hands both devices taps of one engine). */
  engine?: SyncEngine
  /** Relay the ROOT mount is attached to — what makes `isShared()` true. */
  rootRelay?: RelayConfig
  /** Tokens this device holds, by room. Absent ⇒ the mount is needs-token. */
  tokens?: Map<string, RelayConfig>
  /**
   * Run the adopt machine from the root's live mount-entry hook (default
   * true — the shim's behaviour). Tests that drive `reconcileMountEntries`
   * by hand turn it off so the two passes cannot race.
   */
  autoAdopt?: boolean
}

/** Boot every mount from mounts.json — the web shim's multi-mount wiring. */
export async function bootVault(
  base: VaultAdapter,
  vaultDir: StoreDir,
  rootRoom: string,
  opts: BootOptions = {}
): Promise<BootedVault> {
  const deviceId = opts.deviceId ?? 'A'
  const clock = new SimClock()
  /** Latest instance of every room doc this device created (tests reach for
   *  the root folder doc to replay another peer's transaction). */
  const docsByName = new Map<string, EngineDoc>()
  const engine = tapEngine(opts.engine ?? createYjsEngine(), (name, doc) => {
    docsByName.set(name, doc)
    opts.net?.join(deviceId, name, doc)
  })
  const mountsFile = new MountsFile(vaultDir.io('mounts.json'))
  await recoverMounts(vaultDir, mountsFile, engine)

  let descs = await mountsFile.load()
  const ignore = new Set<string>()
  const records = new Map<string, SyncRecordFields>()
  const recordFor = (key: string): SyncRecordFields => {
    let rec = records.get(key)
    if (!rec) {
      rec = freshRecord()
      records.set(key, rec)
    }
    return rec
  }
  const events: BootedVault['events'] = { reviews: [], notices: [], builds: [] }
  const mounts = new Map<string, MountSession>()
  let root: MountSession | null = null

  /** The shim's refreshIgnore: mounts.json ∪ the root map's mount entries,
   *  mutated IN PLACE (ignoringAdapter closes over this object). */
  const refreshIgnore = (): void => {
    const next = mountRootsFrom(descs, root?.mapEntries() ?? [])
    ignore.clear()
    for (const p of next) ignore.add(p)
  }
  const reloadDescs = async (): Promise<void> => {
    descs = await mountsFile.load()
    refreshIgnore()
  }

  const makeSession = (
    room: string,
    adapter: VaultAdapter,
    mountPath: string,
    extra?: Partial<MountSessionConfig>
  ): Promise<MountSession> => {
    const dir = scopedStoreDir(vaultDir, `${room}/`)
    const docStore = new BlobDocStore(engine, dir, clock)
    return MountSession.create({
      engine,
      adapter,
      user: { name: deviceId, color: '#000' },
      room,
      clock,
      lcaStore: lcaGuard(docStore, new JsonFileLcaStore(dir.io('lca.json'))),
      journal: new FileJournal(dir, { now: () => clock.now() }),
      docStore,
      mountsFile,
      mountPath,
      recordFor,
      webSocketPolyfill: DeadSocket,
      makeShareLink: (relay, room_) => `link:${relay.url}:${room_}`,
      ...extra,
      events: {
        onReview: (r) => events.reviews.push({ guid: r.guid, path: r.path, reason: r.reason }),
        ...(mountPath === ''
          ? {
              onMapChanged: () => refreshIgnore(),
              // Defined even when auto-adopt is off: the session only keeps
              // the map snapshot (and therefore the adopt's membership
              // pre-image) when a host is listening for mount entries.
              onMountEntries: () => (opts.autoAdopt === false ? undefined : reconcile()),
            }
          : {}),
        ...extra?.events,
      },
    })
  }

  /**
   * Credential lookup, the fixture's stand-in for the shim's config. A suite
   * that does not pass `tokens` is not modelling credentials at all: every
   * mount boots exactly as it did pre-N1 (no relay, status untouched), so the
   * needs-token path is opt-in rather than something every old test inherits.
   */
  const tokenAware = opts.tokens !== undefined
  const relayFor = (m: { room: string; relay?: string }): RelayConfig | null =>
    opts.tokens?.get(m.room) ?? null

  /**
   * Build a mount the way the shim does — except for `firstJoin`, which is
   * RECORDED rather than obeyed: a first join is an awaited provider pull, and
   * this fixture's providers never connect (DeadSocket). Tests assert the
   * DECISION through `events.builds`; the pull itself is the join suite's.
   */
  const buildMount = async (o: {
    room: string
    path: string
    provenance: MountDesc['provenance']
    relay?: RelayConfig
    firstJoin?: boolean
  }): Promise<MountSession> => {
    events.builds.push({ room: o.room, path: o.path, firstJoin: o.firstJoin === true })
    return makeSession(o.room, scopedAdapter(base, o.path), o.path, {
      provenance: o.provenance,
      ...(o.relay ? { relay: o.relay } : {}),
    })
  }

  const ctx: AdoptContext = {
    vaultDir,
    mountsFile,
    engine,
    root: () => root!,
    rootRoom,
    mounts: () => mounts,
    relayFor,
    buildSession: buildMount,
    attachMount: (path, session) => {
      mounts.set(path, session)
    },
    detachMount: (path) => {
      const session = mounts.get(path) ?? null
      mounts.delete(path)
      return session
    },
    withRootDown: async (fn) => {
      await root!.shutdown()
      await fn()
      root = await makeSession(rootRoom, ignoringAdapter(base, ignore), '')
    },
    refreshIgnore: reloadDescs,
    notify: (n) => events.notices.push(n),
  }

  /** Serialized so the live hook and an explicit boot pass never overlap. */
  let work: Promise<void> = Promise.resolve()
  const reconcile = (): Promise<void> => {
    work = work
      .then(() => reloadDescs())
      .then(() => reconcileMountEntries(ctx))
      .then(() => reloadDescs())
      .catch((err) => {
        throw err
      })
    return work
  }

  refreshIgnore()
  root = await makeSession(rootRoom, ignoringAdapter(base, ignore), '')
  if (opts.rootRelay) root.enableSharing(opts.rootRelay)
  for (const desc of descs) {
    if (desc.path === '' || isRecoverable(desc.status)) continue
    const relay = relayFor({ room: desc.room, relay: desc.relay?.url })
    if (tokenAware && desc.relay && !relay) await mountsFile.setStatus(desc.room, 'needs-token')
    mounts.set(
      desc.path,
      await buildMount({
        room: desc.room,
        path: desc.path,
        provenance: desc.provenance,
        ...(relay ? { relay } : {}),
      })
    )
  }
  await reloadDescs()

  return {
    engine,
    clock,
    get root(): MountSession {
      return root!
    },
    mounts,
    mountsFile,
    vaultDir,
    adapter: base,
    ignore,
    descs: () => descs,
    registry: () => [
      { mountPath: '', session: root! },
      ...[...mounts.entries()].map(([mountPath, session]) => ({ mountPath, session })),
    ],
    reconcile,
    refreshDescs: reloadDescs,
    docFor: (name) => docsByName.get(name) ?? null,
    events,
    makeSession,
    dispose: () => {
      root?.dispose()
      for (const m of mounts.values()) m.dispose()
    },
  }
}

// ------------------------------------------------------------------ the duo

export interface Duo {
  a: BootedVault
  b: BootedVault
  net: RoomNet
  engine: SyncEngine
  /** Deliver every queued frame, settle both devices' async work. */
  deliver: () => Promise<void>
  /** Reboot one device from its durable stores (a restart, not a wipe). */
  reboot: (which: 'a' | 'b') => Promise<BootedVault>
  dispose: () => void
}

export interface DuoOptions {
  /** Files both devices start with (they are peers of one seeded room). */
  files: Record<string, string>
  rootRoom?: string
  relay?: string
  /** Rooms each device holds a token for (the root's is added for both). */
  tokensA?: Map<string, RelayConfig>
  tokensB?: Map<string, RelayConfig>
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/**
 * Two devices, one shared root room. A seeds the vault; B joins it as a peer
 * holding the same files (the two-device bootstrap the L1 fuzz already
 * models), so a carve on A reaches B as a foreign map change and B's adopt
 * machine runs for real.
 */
export async function bootDuo(opts: DuoOptions): Promise<Duo> {
  const rootRoom = opts.rootRoom ?? 'root-room'
  const relayUrl = opts.relay ?? 'ws://relay.test'
  const rootRelay: RelayConfig = { url: relayUrl, token: 'root-token' }
  const engine = createYjsEngine()
  const net = new RoomNet(engine)

  const tokensA = opts.tokensA ?? new Map<string, RelayConfig>()
  const tokensB = opts.tokensB ?? new Map<string, RelayConfig>()
  tokensA.set(rootRoom, rootRelay)
  tokensB.set(rootRoom, rootRelay)

  const adapterA = await seedAdapter(opts.files)
  const adapterB = await seedAdapter(opts.files)
  const dirA = new MemStoreDir()
  const dirB = new MemStoreDir()

  // The two-device bootstrap, done honestly: A enrolls the vault ONCE and B
  // starts from A's durable state, so both devices hold the same guids and the
  // same doc histories — a device that has already synced. Booting B with its
  // own enrollment instead would mint a second guid per file and merge two
  // independent histories over one path, which reads as every note's text
  // twice: the double-ingestion hazard, not something to model as normal.
  const seeder = await bootVault(adapterA, dirA, rootRoom, { deviceId: 'seed' })
  seeder.dispose()
  await settle()
  for (const name of await dirA.list()) {
    const bytes = await dirA.io(name).read()
    if (bytes) await dirB.io(name).writeAtomic(bytes)
  }

  const a = await bootVault(adapterA, dirA, rootRoom, {
    net,
    deviceId: 'A',
    engine,
    rootRelay,
    tokens: tokensA,
  })
  const b = await bootVault(adapterB, dirB, rootRoom, {
    net,
    deviceId: 'B',
    engine,
    rootRelay,
    tokens: tokensB,
  })

  let devA = a
  let devB = b
  const deliver = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
      net.deliverAll()
      await settle()
      devA.clock.advance(100)
      devB.clock.advance(100)
      await settle()
      await devA.reconcile()
      await devB.reconcile()
      await settle()
    }
  }
  return {
    get a(): BootedVault {
      return devA
    },
    get b(): BootedVault {
      return devB
    },
    net,
    engine,
    deliver,
    reboot: async (which) => {
      const old = which === 'a' ? devA : devB
      old.dispose()
      const next = await bootVault(
        which === 'a' ? adapterA : adapterB,
        which === 'a' ? dirA : dirB,
        rootRoom,
        {
          net,
          deviceId: which === 'a' ? 'A' : 'B',
          engine,
          rootRelay,
          tokens: which === 'a' ? tokensA : tokensB,
        }
      )
      await next.reconcile()
      if (which === 'a') devA = next
      else devB = next
      return next
    },
    dispose: () => {
      devA.dispose()
      devB.dispose()
    },
  }
}

/**
 * Replay ANOTHER peer's carve against a device's root map: the exact
 * transaction `MountSession.detachSubtree` writes — hard-delete every key at
 * or under the prefix, set the `kind:'mount'` entry at its root — delivered
 * as a foreign-origin update, the way a relay provider would. This is the
 * adopt machine's trigger, without a second device.
 */
export function applyForeignCarve(
  dev: BootedVault,
  prefix: string,
  mount: { room: string; relay?: string },
  rootRoom = 'root-room'
): void {
  applyForeignMap(
    dev,
    (m) => {
      for (const [p] of m.entries()) {
        if (p === prefix || p.startsWith(`${prefix}/`)) m.delete(p)
      }
      m.set(prefix, {
        guid: mount.room,
        kind: 'mount',
        ...(mount.relay ? { relay: mount.relay } : {}),
      })
    },
    rootRoom
  )
}

/**
 * Run `fn` against a scratch copy of a device's root map and deliver the
 * result back as a FOREIGN update — i.e. "another peer did this". Foreign is
 * the whole point: a local transaction is the device's own doing and neither
 * captures an adopt pre-image nor triggers the adopt machine.
 */
export function applyForeignMap(
  dev: BootedVault,
  fn: (m: {
    entries(): [string, FileEntry][]
    get(k: string): FileEntry | undefined
    set(k: string, v: FileEntry): void
    delete(k: string): void
  }) => void,
  rootRoom = 'root-room'
): void {
  const folder = dev.docFor(`${rootRoom}/folder`)
  if (!folder) throw new Error(`no folder doc for ${rootRoom}`)
  // ':' keeps this doc off the RoomNet — it is a scratch peer, not a device.
  const peer = dev.engine.createDoc(`peer-map:${crypto.randomUUID()}`)
  dev.engine.applyUpdate(peer, dev.engine.encodeUpdateSince(folder, null), 'remote')
  peer.transactMap(fn, 'local')
  dev.engine.applyUpdate(folder, dev.engine.encodeUpdateSince(peer, null), 'remote')
  peer.destroy()
}

/**
 * Carve `path` out of a device's root and mount the result — the shim's
 * doCarve minus the minting: the state machine, then the live session, then
 * the desc mirror. Inside a relay-attached root the detach announces the
 * mount, which is what every peer's adopt keys off.
 */
export async function carveOn(
  dev: BootedVault,
  opts: { path: string; room: string; relayUrl?: string; token?: string }
): Promise<MountSession> {
  const relayUrl = opts.relayUrl ?? 'ws://relay.test'
  await carveFolder({
    root: dev.root,
    vaultDir: dev.vaultDir,
    mountsFile: dev.mountsFile,
    mountPath: opts.path,
    room: opts.room,
    relayUrl,
    addIgnore: (p) => dev.ignore.add(p),
  })
  const session = await dev.makeSession(
    opts.room,
    scopedAdapter(dev.adapter, opts.path),
    opts.path,
    {
      provenance: 'carved',
      ...(opts.token ? { relay: { url: relayUrl, token: opts.token } } : {}),
    }
  )
  dev.mounts.set(opts.path, session)
  await dev.reconcile()
  return session
}

/**
 * A6's invariant, executable (spike S10 Q5): every guid in exactly one mount
 * namespace, every path in exactly one map, nothing under a mount boundary,
 * mounts.json ⟷ registry ⟷ ignore set naming the same roots, and every
 * surviving desc settled. Run it after every command, not only at the end —
 * the interesting failures are transient.
 */
export function checkInvariants(device: BootedVault): void {
  const problems = mountInvariants({
    descs: device.descs(),
    ignore: device.ignore,
    mounts: device.registry(),
  })
  expect(problems).toEqual([])
  for (const desc of device.descs()) expect(isRecoverable(desc.status)).toBe(false)
}
