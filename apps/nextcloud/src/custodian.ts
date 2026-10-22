/**
 * One headless custodian per enrolled vault (nextcloud-build decisions 6, 7,
 * 8, 13): a MountSession over the vault's folder in Files, joined to the
 * in-process relay with the container's own device token, writing what the
 * room says into Files and ingesting what Files says into the room.
 *
 * Boot policy (decision 6) — the custodian is never a plain 'local' boot:
 *   - `enrol` (POST /api/vaults, the ONLY path that enrols disk): stores must
 *     be absent; the lease is taken with If-None-Match, then disk is enrolled
 *     once (`firstJoin: false`, provenance 'local'). The store's epoch file is
 *     written BEFORE any store, here and on a first join.
 *   - `boot` (process start, resume): the store's epoch, the row's and the
 *     marker's must agree, else `needs-operator`. Stores present → reopen;
 *     stores absent → `firstJoin` (pull the room), never enrol. A first join
 *     whose pull reports problems (diverged bytes on disk) → `needs-operator`.
 *   A durable reopen awaits the room (`awaitRoomOnReopen`, 15 s) before the
 *   boot scan classifies disk; the session falls through on a timeout and
 *   reports it (`RoomWaitError`), and the custodian then goes
 *   `needs-operator` and stops.
 *
 * Breakers and reviews are HELD (holds.ts) and never confirmed here. Files
 * status (files-status.ts) is published on the folder awareness.
 */
import { createYjsEngine, type SyncEngine } from '@ohhi/sync'
import {
  docBlobName,
  FOLDER_DOC_KEY,
  MountsFile,
  VaultUnavailableError,
  type Clock,
  type ReconcileThresholds,
  type StoreDir,
  type VaultAdapter,
} from '@ohhi/vault'
import { createMountStores, MountSession, RoomWaitError, type RelayConfig } from '@ohhi/workspace'
import { FilesStatus } from './files-status.js'
import { HoldBook, HoldError, type HoldAction } from './holds.js'
import { MarkerLease, readMarker } from './marker.js'
import { reportedCustodian, type Hold, type VaultRow, type VaultStatus } from './types.js'

export type CustodianMode = 'enrol' | 'boot'
/** The custodian's lifecycle; `@ohhi/workspace`'s `CustodianState` is the awareness payload it publishes. */
export type CustodianPhase = 'starting' | 'running' | 'idle' | 'needs-operator' | 'lease-lost' | 'paused' | 'stopped'

/** How long a durable reopen waits for the in-process room before its boot scan. */
export const AWAIT_ROOM_MS = 15_000

/**
 * Consecutive watch walks that found the vault root gone (`VaultUnavailableError`:
 * the folder deleted, moved or unshared) before the custodian stops as
 * `needs-operator` with reason `folder-gone` (compose.ts re-probes it).
 */
export const FOLDER_GONE_WALKS = 3

/** The store's own record of which vault generation it holds (decision 6: row, store and marker all carry `epoch`). */
export const EPOCH_FILE = 'custodian.json'

export interface CustodianDeps {
  row: VaultRow
  mode: CustodianMode
  clock: Clock
  /** The lease holder: this installation's id plus a per-process nonce (the marker's `instance`). */
  instance: string
  /** The vault's own store directory (`<persist>/vaults/<vaultId>`). */
  storeDir: StoreDir
  /** The vault folder, as the owner (a WebDavVaultAdapter in production). */
  adapter: VaultAdapter
  /** The in-process relay and the container's device token. */
  relay: RelayConfig
  webSocketPolyfill?: unknown
  /** Persist a row status change, with its machine reason (`folder-gone`) when it has one. */
  setStatus: (status: VaultRow['status'], reason?: string) => void
  /** One line, no paths, tokens or headers. */
  log: (msg: string) => void
  engine?: SyncEngine
  thresholds?: Partial<ReconcileThresholds>
  heartbeatMs?: number
  /** How long a durable reopen waits for the room (`AWAIT_ROOM_MS` when absent). */
  awaitRoomMs?: number
  /** Backoff ladder for a refused write's retry (files-status.ts default when absent). */
  retryBackoffMs?: readonly number[]
  /** Presence colour on the folder awareness; a design-token name, not a palette value. */
  color?: string
}

export class Custodian {
  state: CustodianPhase = 'starting'
  readonly holds: HoldBook
  readonly files: FilesStatus
  session: MountSession | null = null
  private lease: MarkerLease | null = null
  private joinProblems = false
  /** The durable reopen's wait for the room failed (`RoomWaitError`). */
  private roomStalled = false
  private booting = false
  private stopping = false
  /** Why the custodian is not running, when it is a known machine reason (`folder-gone`). */
  reason: string | null = null
  /** Watch walks in a row that found the vault root gone. */
  private goneWalks = 0
  /** Resolves once the session is up (or the start has settled into a non-running state). */
  ready: Promise<void> = Promise.resolve()
  /** The `start()` in flight, if any (settled, never rejecting). */
  private startRun: Promise<void> = Promise.resolve()

  constructor(private readonly deps: CustodianDeps) {
    // A hold coming or going is published at once (the shell fetches the status on it).
    this.holds = new HoldBook(
      () => deps.clock.now(),
      () => this.files.changed()
    )
    this.files = new FilesStatus({
      holds: () => this.holds.list().length,
      clock: deps.clock,
      instance: deps.instance,
      publish: (s) => this.session?.publishCustodianState(s),
      retry: async () => {
        await this.session?.rescan()
      },
      guidForPath: (path) => this.session?.files().find((r) => r.path === path)?.guid ?? null,
      ...(deps.retryBackoffMs ? { backoffMs: deps.retryBackoffMs } : {}),
    })
  }

  get row(): VaultRow {
    return this.deps.row
  }

  private async storesPresent(): Promise<boolean> {
    const io = this.deps.storeDir.io(`${this.deps.row.room}/${docBlobName(FOLDER_DOC_KEY)}`)
    return (await io.read()) !== null
  }

  private async readEpochFile(): Promise<{ epoch: number; room: string } | null> {
    const bytes = await this.deps.storeDir.io(EPOCH_FILE).read()
    if (!bytes) return null
    try {
      const v = JSON.parse(new TextDecoder().decode(bytes)) as { epoch?: unknown; room?: unknown }
      return typeof v.epoch === 'number' && typeof v.room === 'string' ? { epoch: v.epoch, room: v.room } : null
    } catch {
      return null
    }
  }

  private async writeEpochFile(): Promise<void> {
    const { epoch, room } = this.deps.row
    await this.deps.storeDir.io(EPOCH_FILE).writeAtomic(new TextEncoder().encode(JSON.stringify({ epoch, room })))
  }

  private settle(state: CustodianPhase, why?: string, reason?: string): void {
    this.state = state
    this.reason = reason ?? null
    if (state === 'needs-operator' || state === 'lease-lost' || state === 'paused') this.deps.setStatus(state, reason)
    else if (state === 'running') this.deps.setStatus('active')
    if (why) this.deps.log(`custodian ${this.deps.row.id}: ${state} (${why})`)
  }

  /**
   * Decide the boot and take the lease. Resolves `false` when the custodian
   * will not run (the state says why); otherwise the session is being created
   * and `ready` settles when it is up.
   */
  start(): Promise<boolean> {
    const run = this.startNow()
    this.startRun = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /** A `stop()` landed while `start()` was awaiting: settle as stopped, hold nothing. */
  private abandoned(): boolean {
    if (!this.stopping) return false
    this.lease?.stop()
    this.lease = null
    return true
  }

  private async startNow(): Promise<boolean> {
    const { row } = this.deps
    let present: boolean
    try {
      // `stop()` may land during any await below (nextcloud-build R1 #15): each one is
      // followed by a check, so a stopped custodian never arms a heartbeat.
      present = await this.storesPresent()
      if (this.abandoned()) return false
      if (this.deps.mode === 'enrol') {
        if (present) {
          this.settle('needs-operator', 'enrolment found an existing store')
          return false
        }
      } else {
        const stored = await this.readEpochFile()
        if (this.abandoned()) return false
        if (present && (!stored || stored.epoch !== row.epoch || stored.room !== row.room)) {
          this.settle('needs-operator', 'the store is from another vault generation')
          return false
        }
        const marker = await readMarker(this.deps.adapter)
        if (this.abandoned()) return false
        if (marker === 'unreadable') {
          this.settle('needs-operator', 'the vault marker is unreadable')
          return false
        }
        if (marker && (marker.room !== row.room || marker.vault !== row.id || marker.epoch !== row.epoch)) {
          this.settle('needs-operator', 'the vault marker names another room or epoch')
          return false
        }
      }
      this.lease = new MarkerLease({
        adapter: this.deps.adapter,
        clock: this.deps.clock,
        instance: this.deps.instance,
        room: row.room,
        vault: row.id,
        epoch: row.epoch,
        ...(this.deps.heartbeatMs !== undefined ? { heartbeatMs: this.deps.heartbeatMs } : {}),
        onLost: () => {
          this.settle('lease-lost', 'another instance holds the vault marker')
          void this.teardown()
        },
        onError: (err) => {
          // The folder itself gone is the walk's to count (`noteWalk`), once — not a line per heartbeat.
          if (err instanceof VaultUnavailableError) return
          this.deps.log(`custodian ${row.id}: marker heartbeat failed (${errName(err)})`)
        },
      })
      const took = await this.lease.acquire(this.deps.mode === 'enrol' ? 'create' : 'reopen')
      if (took.ok && this.stopping) {
        // Taken just as we were stopped: hand it straight back.
        const lease = this.lease
        this.lease = null
        await lease.release().catch(() => {})
        return false
      }
      if (this.abandoned()) return false
      if (!took.ok) {
        this.lease = null
        this.settle(took.reason === 'held-elsewhere' ? 'lease-lost' : 'needs-operator', `lease refused: ${took.reason}`)
        return false
      }
    } catch (err) {
      this.lease?.stop()
      this.lease = null
      this.settle(err instanceof VaultUnavailableError ? 'needs-operator' : 'idle', `boot failed (${errName(err)})`)
      return false
    }

    const firstJoin = this.deps.mode === 'boot' && !present
    this.ready = this.openSession(firstJoin)
    return true
  }

  private async openSession(firstJoin: boolean): Promise<void> {
    const { row, clock } = this.deps
    const engine = this.deps.engine ?? createYjsEngine()
    this.booting = true
    this.joinProblems = false
    this.roomStalled = false
    try {
      // A session that will CREATE stores (enrolment, a first join) writes
      // the epoch file FIRST (nextcloud-build R1 #10): a crash while the stores are
      // being written then leaves stores WITH their epoch (the next boot
      // reopens them) or no stores at all (it first-joins) — never stores
      // without an epoch, which no boot can tell from another vault's.
      if (this.deps.mode === 'enrol' || firstJoin) await this.writeEpochFile()
      const stores = createMountStores(engine, this.deps.storeDir, row.room, clock)
      const session = await MountSession.create({
        engine,
        adapter: this.deps.adapter,
        user: { name: 'Oh Hi', color: this.deps.color ?? 'var(--ohhi-peer-custodian)' },
        room: row.room,
        firstJoin,
        relay: this.deps.relay,
        clock,
        lcaStore: stores.lcaStore,
        journal: stores.journal,
        docStore: stores.docStore,
        mountsFile: new MountsFile(this.deps.storeDir.io('mounts.json')),
        mountPath: '',
        ...(this.deps.mode === 'enrol' ? { provenance: 'local' as const } : {}),
        ...(this.deps.thresholds ? { thresholds: this.deps.thresholds } : {}),
        recordFor: this.files.recordFor,
        makeShareLink: () => '',
        webSocketPolyfill: this.deps.webSocketPolyfill,
        enrollOnCreate: true,
        // A durable reopen (boot with stores present) waits for the room first (decision 6).
        ...(this.deps.mode === 'boot' && !firstJoin ? { awaitRoomOnReopen: { timeoutMs: this.deps.awaitRoomMs ?? AWAIT_ROOM_MS } } : {}),
        eventsIo: stores.mountDir.io('events.json'),
        events: {
          onBreaker: (paths) => {
            this.holds.addBreaker(paths)
            this.deps.log(`custodian ${row.id}: held a batch of ${paths.length} changes`)
          },
          onReview: (review) => {
            this.holds.addReview(review)
          },
          onReviewCleared: (guid) => this.holds.clearReview(guid),
          onError: (err) => {
            if (this.booting && err instanceof RoomWaitError) {
              // The in-process room did not answer before the boot scan: the
              // session falls through, but a custodian does not classify
              // Files against a room it has not heard (decision 6).
              this.roomStalled = true
            }
            if (this.files.noteError(err)) return
            if (this.booting && firstJoin && err instanceof Error && err.message.startsWith('join problems:')) {
              this.joinProblems = true
            }
            this.deps.log(`custodian ${row.id}: ${errName(err)}`)
          },
        },
      })
      this.booting = false
      if (this.stopping) {
        await session.shutdown()
        return
      }
      this.session = session
      if (this.roomStalled) {
        this.settle('needs-operator', 'the room did not answer before the boot scan')
        await this.teardown()
        return
      }
      if (firstJoin && this.joinProblems) {
        // A first join that found different bytes on disk: the room and the
        // folder disagree about content, and the custodian must not pick.
        this.settle('needs-operator', 'the first join found diverged files')
        await this.teardown()
        return
      }
      this.files.publishNow()
      this.settle('running')
    } catch (err) {
      this.booting = false
      this.settle(firstJoin ? 'needs-operator' : 'idle', `session failed (${errName(err)})`)
      await this.teardown()
    }
  }

  /**
   * Stop everything this custodian runs. The marker stays (it names the
   * vault), but a lease this process still holds is released — its heartbeat
   * marked stale — so the next process takes it at once instead of waiting
   * out the staleness window.
   */
  private async teardown(): Promise<void> {
    const lease = this.lease
    this.lease = null
    await lease?.release().catch(() => {})
    this.files.stop()
    const s = this.session
    this.session = null
    if (s) {
      s.publishCustodianState(null)
      await s.shutdown().catch(() => {})
    }
  }

  async stop(state: 'stopped' | 'paused' = 'stopped'): Promise<void> {
    this.stopping = true
    await this.startRun
    await this.ready.catch(() => {})
    await this.teardown()
    if (this.state === 'running' || this.state === 'starting' || this.state === 'idle') this.settle(state)
  }

  /**
   * One watch walk's outcome (compose.ts wires the adapter's `onWalk` /
   * `onWalkError` here): `null` for a walk that answered. After
   * `FOLDER_GONE_WALKS` walks in a row that found the vault root gone, the
   * custodian stops — no more walks, no more heartbeats — as `needs-operator`
   * with reason `folder-gone`, and says so in one line. Returns true when the
   * error was the folder being gone (counted, not worth a line of its own).
   */
  noteWalk(err: unknown): boolean {
    const gone = err instanceof VaultUnavailableError
    if (!gone) {
      this.goneWalks = 0
      return false
    }
    if (this.state !== 'running') return true
    this.goneWalks++
    if (this.goneWalks >= FOLDER_GONE_WALKS) {
      this.goneWalks = 0
      this.settle('needs-operator', `the folder is gone from Files (${FOLDER_GONE_WALKS} walks)`, 'folder-gone')
      void this.teardown()
    }
    return true
  }

  async applyHold(holdId: string, action: HoldAction): Promise<void> {
    if (this.state !== 'running' && this.state !== 'starting') throw new HoldError(409, 'the custodian is not running')
    await this.holds.apply(holdId, action, this.session)
  }

  /** The vault's status as `GET /api/vaults/:id/status` reports it (peers filled by the caller). */
  status(peers: number): VaultStatus {
    const holds: Hold[] = this.holds.list()
    // An enrolment in flight is `enrolling` (the shell counts its `files`), not `idle`.
    const custodian = this.state === 'starting' && this.deps.mode === 'enrol' ? 'enrolling' : reportedCustodian(this.state)
    return {
      vault: this.deps.row,
      custodian,
      ...(this.reason !== null ? { reason: this.reason } : {}),
      holds,
      files: this.files.snapshot().disk,
      peers,
    }
  }
}

/** An error's class name only — messages can carry paths (decision 15). */
export function errName(err: unknown): string {
  if (err instanceof Error) {
    const status = (err as { status?: unknown }).status
    return typeof status === 'number' ? `${err.name} ${status}` : err.name
  }
  return 'error'
}
