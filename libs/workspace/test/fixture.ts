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
 * another by a `RoomNet` — a TestNetwork-shaped simulator of a relay, routing
 * by `${room}/${docName}` exactly as the providers do and keeping its own
 * durable copy of every doc. No relay process, no sockets: mount rooms appear
 * and disappear as the machines carve and absorb, and the net links them the
 * moment both sides create a doc of that name. `Cut` adds the kill -9.
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
import {
  bootFlagsFor,
  mountInvariants,
  mountStoreInvariants,
  reconcileMountEntries,
  type AdoptContext,
  type AdoptedMountOptions,
  type AdoptNotice,
} from '../src/adopt.js'
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
  // The binding names THIS dir, not `base` (see StoreIo.binding): a wrapper
  // that drops it hands the LCA store the pre-S10 whole-file layout and routes
  // its per-record writes past the crash injection, so the matrix would sweep
  // a write sequence the product never performs.
  const dir: StoreDir = {
    io: (name): StoreIo => {
      const io = base.io(name)
      return {
        read: () => io.read(),
        writeAtomic: async (bytes) => {
          spend()
          await io.writeAtomic(bytes)
        },
        binding: { dir, name },
      }
    },
    remove: async (name) => {
      spend()
      await base.remove(name)
    },
    list: (prefix) => base.list(prefix),
  }
  return dir
}

/**
 * The kill -9, armed at a write. `crashingDir` is the same idea with a fixed
 * budget; a `Cut` is shared by a device's stores AND its disk so both stop at
 * the same instant, and it THROWS rather than dropping quietly — a device that
 * keeps computing over a dead disk reaches states no crash can produce, so the
 * throw is what makes the model honest. Its network does not stop: an update
 * already handed to the relay is durable there, which is exactly what makes
 * crash recovery interesting.
 */
export interface Cut {
  /** Let `budget` more mutating ops land, then kill the next one. */
  cutAfter: (budget: number) => void
  /** Restore durability (the reboot). */
  restore: () => void
  /**
   * Stop throwing and just swallow writes. The dying process still has to be
   * TORN DOWN in this harness (`dispose` ends with a best-effort `flushAll`),
   * and that teardown must neither reach the disk nor raise.
   */
  silence: () => void
  /** True when the write should land; throws `injected-crash` at the kill. */
  spend: () => boolean
  /** Mutating ops seen since the last `restore()` — the crash budget's range. */
  writes: () => number
}

/** Is this the injected kill, or a real failure to re-raise? */
export function isInjectedCrash(err: unknown): boolean {
  return err instanceof Error && err.message === 'injected-crash'
}

export function makeCut(): Cut {
  let left = Number.POSITIVE_INFINITY
  let seen = 0
  let loud = true
  return {
    spend: () => {
      seen++
      if (left > 0) {
        left--
        return true
      }
      if (loud) throw new Error('injected-crash')
      return false
    },
    cutAfter: (budget) => {
      left = budget
      loud = true
    },
    silence: () => {
      loud = false
    },
    restore: () => {
      left = Number.POSITIVE_INFINITY
      loud = true
      seen = 0
    },
    writes: () => seen,
  }
}

/** A device's stores behind a `Cut`. */
export function cuttableDir(base: StoreDir, cut: Cut = makeCut()): StoreDir {
  const dir: StoreDir = {
    io: (name): StoreIo => {
      const io = base.io(name)
      return {
        read: () => io.read(),
        writeAtomic: async (bytes) => {
          if (cut.spend()) await io.writeAtomic(bytes)
        },
        binding: { dir, name },
      }
    },
    remove: async (name) => {
      if (cut.spend()) await base.remove(name)
    },
    list: (prefix) => base.list(prefix),
  }
  return dir
}

/** A device's DISK behind the same `Cut` as its stores. */
export function cuttableAdapter(base: VaultAdapter, cut: Cut): VaultAdapter {
  const kill = async <T,>(fn: () => Promise<T>): Promise<T | void> => {
    if (cut.spend()) return fn()
  }
  return {
    list: () => base.list(),
    listDirs: () => base.listDirs(),
    read: (path) => base.read(path),
    watch: (cb) => base.watch(cb),
    writeAtomic: (path, bytes) => kill(() => base.writeAtomic(path, bytes)),
    rename: (from, to) => kill(() => base.rename(from, to)),
    remove: (path) => kill(() => base.remove(path)),
    mkdir: (path) => kill(() => base.mkdir(path)),
    removeDir: (path) => kill(() => base.removeDir(path)),
    renameDir: (from, to) => kill(() => base.renameDir(from, to)),
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
 * A relay room, simulated: doc instances that share a NAME exchange updates
 * through a HUB — the relay's own copy of the document.
 *
 * The hub is what makes this a relay rather than a mesh, and it is load-bearing
 * for crash tests: an update a device sent while online is durable at the relay
 * the moment it lands there, so when that device is killed before its own store
 * write and reboots, the hub hands its work straight back. A peer-to-peer
 * queue would instead lose it unless some other device happened to have
 * received it first, which is not how any of this works in production.
 *
 * Frames are queued, never dropped (a partition delays delivery, exactly like a
 * relay holding updates for an offline peer), and a doc joining is handed the
 * hub's full state — the sync handshake, in one frame. A device that is offline
 * cannot reach the hub either: its updates wait in an outbox and flush on heal.
 */
export class RoomNet {
  private byName = new Map<string, Map<string, EngineDoc>>()
  private queue: Frame[] = []
  private offline = new Set<string>()
  /** Which devices have actually RECEIVED a frame for each doc name. */
  private delivered = new Map<string, Set<string>>()
  /** The relay's durable copy of each doc. */
  private hub = new Map<string, EngineDoc>()
  /** Updates a device made while offline, waiting to reach the hub. */
  private outbox = new Map<string, { name: string; update: Uint8Array }[]>()

  constructor(private engine: SyncEngine) {}

  /** Attach `doc` as `id`'s instance of the room doc called `name`. */
  join(id: string, name: string, doc: EngineDoc): void {
    // ':' keeps the hub off any device's own naming — it is the relay, not a peer.
    let hub = this.hub.get(name)
    if (!hub) {
      hub = this.engine.createDoc(`hub:${name}`)
      this.hub.set(name, hub)
    }
    const peers = this.byName.get(name) ?? new Map<string, EngineDoc>()
    this.queue.push({ to: id, name, update: this.engine.encodeUpdateSince(hub, null) })
    peers.set(id, doc) // replaces this device's previous instance (a rebuild)
    this.byName.set(name, peers)
    this.send(id, name, this.engine.encodeUpdateSince(doc, null))
    this.engine.onUpdate(doc, (update, origin) => {
      if (origin === 'remote') return
      if (this.byName.get(name)?.get(id) !== doc) return // a stale instance
      this.send(id, name, update)
    })
  }

  /** One device's update: durable at the hub (if reachable), then fanned out. */
  private send(id: string, name: string, update: Uint8Array): void {
    if (this.offline.has(id)) {
      const box = this.outbox.get(id) ?? []
      box.push({ name, update })
      this.outbox.set(id, box)
      return
    }
    const hub = this.hub.get(name)
    if (hub) this.engine.applyUpdate(hub, update, 'remote')
    for (const otherId of this.byName.get(name)?.keys() ?? []) {
      if (otherId !== id) this.queue.push({ to: otherId, name, update })
    }
  }

  /** Hold every frame for `id` until `online` (an offline device). */
  setOffline(id: string, off: boolean): void {
    if (off) {
      this.offline.add(id)
      return
    }
    this.offline.delete(id)
    const box = this.outbox.get(id) ?? []
    this.outbox.delete(id)
    for (const { name, update } of box) this.send(id, name, update)
  }

  /** Deliver every deliverable frame, including ones they cause. */
  deliverAll(): void {
    for (let guard = 0; guard < 10_000; guard++) {
      if (!this.deliverOne()) return
    }
    throw new Error('RoomNet.deliverAll did not quiesce')
  }

  /**
   * Deliver the OLDEST deliverable frame. Partial delivery is where the
   * interesting interleavings live: a peer that has seen the carve's
   * transaction but not the edit that raced it, and vice versa.
   */
  deliverOne(): boolean {
    const idx = this.queue.findIndex((f) => !this.offline.has(f.to))
    if (idx === -1) return false
    const frame = this.queue.splice(idx, 1)[0]!
    const doc = this.byName.get(frame.name)?.get(frame.to)
    if (!doc) return true
    const seen = this.delivered.get(frame.name) ?? new Set<string>()
    seen.add(frame.to)
    this.delivered.set(frame.name, seen)
    try {
      this.engine.applyUpdate(doc, frame.update, 'remote')
    } catch {
      // A doc destroyed between queueing and delivery (a shutdown mid-flight)
      // is not an error: its successor gets the state on join.
    }
    return true
  }

  /** Deliver at most `count` frames (the fuzz's `deliver(n)` command). */
  deliverSome(count: number): void {
    for (let i = 0; i < count; i++) if (!this.deliverOne()) return
  }

  /** Frames still in flight (deliverable or held for an offline device). */
  pending(): number {
    return this.queue.length
  }

  /** Is this device cut off from the relay right now? */
  isOffline(id: string): boolean {
    return this.offline.has(id)
  }

  /** Doc names with frames still in flight. */
  pendingNames(): string[] {
    return [...new Set(this.queue.map((f) => f.name))]
  }

  /**
   * Devices that have received at least one frame for `name`. Two docs holding
   * the same VALUE is not the same as two docs sharing a HISTORY: an adopt
   * seeds the mount's folder doc locally, so until the room's copies have
   * actually exchanged updates, a hard delete on one side is invisible to the
   * other's independent ops. Callers that need "these two have merged" ask
   * here, not by comparing entries.
   */
  deliveredTo(name: string): ReadonlySet<string> {
    return this.delivered.get(name) ?? new Set<string>()
  }
}

/** Wrap an engine so every doc it creates is announced (for the RoomNet). */
function tapEngine(base: SyncEngine, onDoc: (name: string, doc: EngineDoc) => void): SyncEngine {
  return {
    ...base,
    createDoc: (name: string) => {
      const doc = base.createDoc(name)
      // Throwaway temp docs (carve-tmp:, absorb-*, recover-*) carry a ':' and
      // are never room docs — they must not be wired to anything. Neither is
      // VaultSession's `empty-baseline`, which is read for its heads and
      // destroyed inside one function.
      if (!name.includes(':') && name !== 'empty-baseline') onDoc(name, doc)
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
  /**
   * The shim's `rebuildRoot`: build a fresh root session over the (already
   * shut down) root namespace. `unshareMount` shuts the root down and leaves
   * the caller to rebuild it — that is the seam.
   */
  rebuildRoot: () => Promise<void>
  /** The live instance of a room doc by name (`<room>/folder`, or a guid). */
  docFor: (name: string) => EngineDoc | null
  events: {
    reviews: { guid: string; path: string; reason: string; mine: string; theirs: string }[]
    notices: AdoptNotice[]
    /** Every mount the adopt machine asked for, and whether it wanted a pull. */
    builds: { room: string; path: string; firstJoin: boolean }[]
    /**
     * Anything a session pushed through `onError`. Swallowing these was
     * invisible: `MountSession` reports every failed tree op that way, and a
     * fuzz run that quietly ate them would call a broken rename a pass.
     */
    errors: unknown[]
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
  /**
   * Config merged into every session this device builds, by mount root ('' is
   * the root mount) — the seam a test needs to lower `thresholds` or listen
   * for `onBreaker` on a mount the ADOPT machine built (S10 Q5 row 9), which
   * no caller ever gets a chance to configure.
   */
  sessionDefaults?: (mountPath: string) => Partial<MountSessionConfig>
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
  const baseEngine = opts.engine ?? createYjsEngine()
  /**
   * A relay routes by `${room}/${docName}` (`attachProvider`), so the net must
   * too: a file doc is created under its bare guid, and keying the channel on
   * that alone would wire two DIFFERENT rooms that hold the same guid into one
   * — which is exactly the premise of the double-carve race (S10 Q5 row 10)
   * and would hide a namespace that failed to move. Folder docs already carry
   * their room in the name.
   */
  const engineFor = (room: string | null): SyncEngine =>
    tapEngine(baseEngine, (name, doc) => {
      docsByName.set(name, doc)
      opts.net?.join(deviceId, room !== null && !name.includes('/') ? `${room}/${name}` : name, doc)
    })
  const engine = engineFor(null)
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
  const events: BootedVault['events'] = { reviews: [], notices: [], builds: [], errors: [] }
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
    const roomEngine = engineFor(room)
    const docStore = new BlobDocStore(roomEngine, dir, clock)
    return MountSession.create({
      engine: roomEngine,
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
      ...opts.sessionDefaults?.(mountPath),
      ...extra,
      events: {
        onError: (err) => events.errors.push(err),
        onReview: (r) =>
          events.reviews.push({
            guid: r.guid,
            path: r.path,
            reason: r.reason,
            mine: r.mine,
            theirs: r.theirs,
          }),
        ...(mountPath === ''
          ? {
              onMapChanged: () => refreshIgnore(),
              // Defined even when auto-adopt is off: the session only keeps
              // the map snapshot (and therefore the adopt's membership
              // pre-image) when a host is listening for mount entries.
              onMountEntries: () => (opts.autoAdopt === false ? undefined : reconcile()),
            }
          : {}),
        ...opts.sessionDefaults?.(mountPath).events,
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
  const buildMount = async (o: AdoptedMountOptions): Promise<MountSession> => {
    events.builds.push({ room: o.room, path: o.path, firstJoin: o.firstJoin === true })
    return makeSession(o.room, scopedAdapter(base, o.path), o.path, {
      provenance: o.provenance,
      ...(o.relay ? { relay: o.relay } : {}),
      // `firstJoin` is passed THROUGH — it decides boot ordering, and a mount
      // told to pull must skip `tryDurableReopen` here exactly as it does in
      // the product — but the pull itself cannot run (this fixture's sockets
      // never open), so `neverHeld` stands in for it: boot empty, enrol
      // nothing. Tests assert the DECISION through `events.builds`.
      ...(o.firstJoin ? { firstJoin: true } : {}),
      ...(o.neverHeld || o.firstJoin ? { neverHeld: true } : {}),
      ...(o.onPullProgress ? { events: { onPullProgress: o.onPullProgress } } : {}),
    })
  }

  /**
   * The shim's rebuildRoot. Re-attaches the relay: a rebuilt root that forgot
   * it was shared would stop announcing carves and stop repairing mount
   * entries (`reconcileMountEntries`'s `shared` gate) — the absorb path goes
   * through here, and a mount is often carved again afterwards.
   */
  const rebuildRoot = async (): Promise<void> => {
    root = await makeSession(rootRoom, ignoringAdapter(base, ignore), '')
    if (opts.rootRelay) root.enableSharing(opts.rootRelay)
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
      await rebuildRoot()
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
  await rebuildRoot()
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
        // Derived together, exactly as the shim does: PULL with a credential,
        // wait empty without one. Neither flag on a `neverHeld` desc drops an
        // adopted mount into the fresh-vault enrol (N3).
        ...bootFlagsFor(desc, relay),
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
    rebuildRoot,
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
  /**
   * Deliver at most `count` frames and let both devices act on them —
   * partial delivery, the fuzz's `deliver(n)`. Unlike `deliver()` this does
   * NOT loop to quiescence: what a device has not been told, it does not know.
   */
  deliverSome: (count: number) => Promise<void>
  /** Advance both clocks and let debounced work run. */
  tick: (ms: number) => Promise<void>
  /** Reboot one device from its durable stores (a restart, not a wipe). */
  reboot: (which: 'a' | 'b') => Promise<BootedVault>
  /**
   * Cut one device's durability after `budget` more store writes, let it run
   * (so the crash lands mid-machine), then reboot it. The in-memory half is
   * discarded exactly as a kill -9 discards it; the durable half is a prefix.
   */
  crash: (which: 'a' | 'b', budget: number) => Promise<BootedVault>
  /** The device handle by key, whichever generation is current. */
  dev: (which: 'a' | 'b') => BootedVault
  /**
   * Link a THIRD device: an empty folder and empty stores joining the same
   * root room (S10 Q5 rows 14-16). It boots with nothing durable, the room's
   * map arrives over the net, and `scanMap` materializes the vault — which is
   * what a device link is once the token is in hand. It joins `deliver()`.
   */
  link: (id: string, tokens?: Map<string, RelayConfig>) => Promise<BootedVault>
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
  /** Session config by mount root, for each device (see `sessionDefaults`). */
  defaultsA?: (mountPath: string) => Partial<MountSessionConfig>
  defaultsB?: (mountPath: string) => Partial<MountSessionConfig>
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

  const rawAdapterA = await seedAdapter(opts.files)
  const rawAdapterB = await seedAdapter(opts.files)
  const rawA = new MemStoreDir()
  const rawB = new MemStoreDir()
  // Every device's stores AND disk sit behind one Cut; durability is only ever
  // cut by an explicit `crash()`, so a run that never crashes is unchanged.
  const cutA = makeCut()
  const cutB = makeCut()
  const dirA = cuttableDir(rawA, cutA)
  const dirB = cuttableDir(rawB, cutB)
  const adapterA = cuttableAdapter(rawAdapterA, cutA)
  const adapterB = cuttableAdapter(rawAdapterB, cutB)

  // The two-device bootstrap, done honestly: A enrolls the vault ONCE and B
  // starts from A's durable state, so both devices hold the same guids and the
  // same doc histories — a device that has already synced. Booting B with its
  // own enrollment instead would mint a second guid per file and merge two
  // independent histories over one path, which reads as every note's text
  // twice: the double-ingestion hazard, not something to model as normal.
  const seeder = await bootVault(rawAdapterA, rawA, rootRoom, { deviceId: 'seed' })
  seeder.dispose()
  await settle()
  for (const name of await rawA.list()) {
    const bytes = await rawA.io(name).read()
    if (bytes) await rawB.io(name).writeAtomic(bytes)
  }

  const boot = async (which: 'a' | 'b'): Promise<BootedVault> => {
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
        ...((which === 'a' ? opts.defaultsA : opts.defaultsB)
          ? { sessionDefaults: (which === 'a' ? opts.defaultsA : opts.defaultsB)! }
          : {}),
      }
    )
    if (which === 'a') devA = next
    else devB = next
    return next
  }

  let devA!: BootedVault
  let devB!: BootedVault
  await boot('a')
  await boot('b')

  /** Devices linked into this room after the duo booted (rows 14-16). */
  const linked: BootedVault[] = []
  const all = (): BootedVault[] => [devA, devB, ...linked]

  const deliver = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
      net.deliverAll()
      await settle()
      for (const dev of all()) dev.clock.advance(100)
      await settle()
      for (const dev of all()) await dev.reconcile()
      await settle()
    }
  }
  const reboot = async (which: 'a' | 'b'): Promise<BootedVault> => {
    ;(which === 'a' ? devA : devB).dispose()
    const next = await boot(which)
    await next.reconcile()
    return next
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
    deliverSome: async (count) => {
      net.deliverSome(count)
      await settle()
      for (const dev of all()) await dev.reconcile()
      await settle()
    },
    tick: async (ms) => {
      for (const dev of all()) dev.clock.advance(ms)
      await settle()
    },
    dev: (which) => (which === 'a' ? devA : devB),
    reboot,
    crash: async (which, budget) => {
      const cut = which === 'a' ? cutA : cutB
      const dev = which === 'a' ? devA : devB
      cut.cutAfter(budget)
      try {
        // Let the kill land wherever the device's own work reaches it, then
        // stop: the throw unwinds whatever machine was running, which is the
        // point. Anything that is NOT the injected crash is a real failure and
        // is re-raised once the reboot has restored a sane world.
        net.deliverAll()
        await settle()
        dev.clock.advance(100)
        await settle()
        await dev.reconcile()
        await settle()
      } catch (err) {
        if (!isInjectedCrash(err)) {
          cut.restore()
          dev.dispose()
          await boot(which)
          throw err
        }
      }
      // Dispose while STILL cut. `MountSession.dispose` ends with a best-effort
      // `flushAll`, and letting that land would hand the "crashed" device a
      // graceful shutdown: its folder blob and every doc blob would reach the
      // disk after the kill, which is the opposite of what is being tested.
      cut.silence()
      dev.dispose()
      await settle()
      cut.restore()
      const next = await boot(which)
      await next.reconcile()
      return next
    },
    link: async (id, tokens) => {
      const linkTokens = tokens ?? new Map<string, RelayConfig>()
      linkTokens.set(rootRoom, rootRelay)
      const dev = await bootVault(new MemVaultAdapter(), cuttableDir(new MemStoreDir()), rootRoom, {
        net,
        deviceId: id,
        engine,
        rootRelay,
        tokens: linkTokens,
      })
      linked.push(dev)
      return dev
    },
    dispose: () => {
      for (const dev of all()) dev.dispose()
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
  mount: { room: string; relay?: string; seed?: boolean; omit?: readonly string[] },
  rootRoom = 'root-room'
): void {
  const pre = `${prefix}/`
  applyForeignMap(
    dev,
    (m) => {
      // The SEED the carver would have announced: its own copy of the new
      // room's folder doc, built from the entries it is about to delete
      // (`seedCarveStores`). Every peer applies this one update instead of
      // re-`set`ting the keys itself, which is what makes the two histories
      // one — see `fuzz-crashers/0003`. `seed: false` models the over-cap
      // announcement, which carries none.
      // `omit` is what the CARVER never saw: a file this device enrolled on
      // its own while the carver was elsewhere. It is in our map and not in
      // their seed, which is exactly what makes it a ghost.
      const subtree = m
        .entries()
        .filter(
          ([p, e]) =>
            !e.deleted &&
            e.kind !== 'mount' &&
            p.startsWith(pre) &&
            !(mount.omit ?? []).includes(p)
        )
      const tmp = dev.engine.createDoc(`carve-seed:${crypto.randomUUID()}`)
      tmp.transactMap((t) => {
        for (const [p, e] of subtree) t.set(p.slice(pre.length), e)
      }, 'seed')
      const seed = mount.seed === false ? undefined : encodeSeed(dev.engine.encodeUpdateSince(tmp, null))
      tmp.destroy()
      for (const [p] of m.entries()) {
        if (p === prefix || p.startsWith(pre)) m.delete(p)
      }
      m.set(prefix, {
        guid: mount.room,
        kind: 'mount',
        ...(mount.relay ? { relay: mount.relay } : {}),
        ...(seed ? { seed } : {}),
      })
    },
    rootRoom
  )
}

/**
 * A session's mount entries WITHOUT their seeds — the shape assertions about
 * "where the nested share is" want. The seed is a whole folder-doc state and
 * belongs in its own assertion (`carve.test.ts` pins that it is there and that
 * a peer builds the identical history from it).
 */
export function announcedMounts(session: MountSession): { path: string; room: string; relay?: string }[] {
  return session.mountEntries().map(({ path, room, relay }) => ({
    path,
    room,
    ...(relay ? { relay } : {}),
  }))
}

/** base64 of a Yjs update — the wire form of `FileEntry.seed`. */
export function encodeSeed(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
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
export async function checkInvariants(device: BootedVault): Promise<void> {
  const problems = mountInvariants({
    descs: device.descs(),
    ignore: device.ignore,
    mounts: device.registry(),
  })
  expect(problems).toEqual([])
  // The STORE half (M5): a map-only invariant cannot see a guid whose blob and
  // LCA record are still in the parent's namespace after its key moved.
  const rooms = device.registry().map((h) => h.session.room)
  expect(await mountStoreInvariants(device.vaultDir, rooms)).toEqual([])
  for (const desc of device.descs()) expect(isRecoverable(desc.status)).toBe(false)
}
