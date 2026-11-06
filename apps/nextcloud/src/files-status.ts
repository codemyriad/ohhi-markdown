/**
 * Files status is honest (nextcloud-build decision 8).
 *
 * The custodian hands its MountSession a `recordFor(key)` factory from here;
 * the session mutates those records in place (`diskMatchesCrdt` above all).
 * ANY failed write of a doc (caught from `onError`, naming the file — a
 * parent MKCOL names the file too) keeps that doc off `match` and is retried
 * on the injected clock with backoff, until the record says disk matches
 * again (nextcloud-build R1 #8). A refusal (`WriteRefusedError` 423/403/507/400) shows
 * as `blocked` with its HTTP status; anything else — a 5xx, Nextcloud
 * unreachable, a compare-and-swap that never settled — as `behind`. The
 * resulting `CustodianState` — with the custodian's hold count, so the shell
 * fetches the vault status the moment a hold appears — is published on the
 * folder awareness, throttled to once per `throttleMs`.
 */
import { WebDavError, WriteConflictError, WriteRefusedError, type Clock } from '@ohhi/vault'
import { FOLDER_RECORD_KEY, type CustodianState, type SyncRecordFields } from '@ohhi/workspace'

export interface FilesStatusOptions {
  clock: Clock
  instance: string
  publish: (state: CustodianState) => void
  /** Re-attempt the refused writes (the custodian rescans); resolves when the attempt is over. */
  retry: () => Promise<void>
  /** Vault-relative path → doc guid, for an error that names a path. */
  guidForPath: (path: string) => string | null
  /** How many holds the custodian has (`CustodianState.holds`); `changed()` publishes a move. */
  holds?: () => number
  throttleMs?: number
  /** Backoff ladder for a blocked write, in ms; the last step repeats. */
  backoffMs?: readonly number[]
}

const DEFAULT_BACKOFF = [5_000, 15_000, 60_000, 300_000] as const

export class FilesStatus {
  private readonly records = new Map<string, SyncRecordFields>()
  /** Docs whose last write failed → the refusal's HTTP status, or null for a transient failure. */
  private readonly failed = new Map<string, number | null>()
  private dirty = false
  private lastPublishAt = Number.NEGATIVE_INFINITY
  private cancelPublish: (() => void) | null = null
  private cancelRetry: (() => void) | null = null
  private attempt = 0
  private stopped = false
  private readonly throttleMs: number
  private readonly backoff: readonly number[]

  constructor(private readonly opts: FilesStatusOptions) {
    this.throttleMs = opts.throttleMs ?? 500
    this.backoff = opts.backoffMs ?? DEFAULT_BACKOFF
  }

  /** The stable record factory MountSession is configured with. */
  readonly recordFor = (key: string): SyncRecordFields => {
    const existing = this.records.get(key)
    if (existing) return existing
    const target: SyncRecordFields = {
      connected: false,
      synced: false,
      pendingLocal: false,
      diskMatchesCrdt: true,
      diverged: false,
    }
    const proxied = new Proxy(target, {
      set: (t, prop, value): boolean => {
        const before = Reflect.get(t, prop)
        const ok = Reflect.set(t, prop, value)
        if (prop === 'diskMatchesCrdt' && value === true && this.failed.has(key)) {
          // The bytes behind the room caught up: the failure has cleared.
          this.failed.delete(key)
          if (this.failed.size === 0) this.resetRetry()
        }
        if (before !== value && (prop === 'diskMatchesCrdt' || prop === 'diverged')) this.markDirty()
        return ok
      },
    })
    this.records.set(key, proxied)
    if (key !== FOLDER_RECORD_KEY) this.markDirty()
    return proxied
  }

  /** Feed every `onError` here; returns true when it was a failed write of a doc it now tracks. */
  noteError(err: unknown): boolean {
    if (!(err instanceof WebDavError) && !(err instanceof WriteConflictError)) return false
    const guid = this.opts.guidForPath(err.path)
    if (guid === null) return false
    // A refusal's status sticks until the doc matches; a transient failure never hides one.
    const status = err instanceof WriteRefusedError ? err.status : (this.failed.get(guid) ?? null)
    this.failed.set(guid, status)
    const rec = this.records.get(guid)
    if (rec) Reflect.set(rec, 'diskMatchesCrdt', false)
    this.markDirty()
    this.scheduleRetry()
    return true
  }

  /** Forget a doc that left the room (deleted or moved out). */
  forget(guid: string): void {
    this.records.delete(guid)
    this.failed.delete(guid)
    this.markDirty()
  }

  snapshot(): CustodianState {
    const disk: CustodianState['disk'] = {}
    for (const [key, rec] of this.records) {
      if (key === FOLDER_RECORD_KEY) continue
      const failure = this.failed.get(key)
      disk[key] = typeof failure === 'number' ? 'blocked' : failure === null || !rec.diskMatchesCrdt ? 'behind' : 'match'
    }
    const blocked: CustodianState['blocked'] = {}
    for (const [guid, status] of this.failed) if (status !== null) blocked[guid] = status
    return { type: 'custodian', instance: this.opts.instance, disk, blocked, holds: this.opts.holds?.() ?? 0 }
  }

  /** Something the snapshot reads besides the records moved (a hold came or went): publish it, throttled. */
  changed(): void {
    this.markDirty()
  }

  /** Publish now (boot), then keep the throttle. */
  publishNow(): void {
    this.cancelPublish?.()
    this.cancelPublish = null
    this.dirty = false
    this.lastPublishAt = this.opts.clock.now()
    this.opts.publish(this.snapshot())
  }

  private markDirty(): void {
    if (this.stopped) return
    this.dirty = true
    if (this.cancelPublish) return
    const wait = Math.max(0, this.lastPublishAt + this.throttleMs - this.opts.clock.now())
    this.cancelPublish = this.opts.clock.schedule(() => {
      this.cancelPublish = null
      if (this.dirty && !this.stopped) this.publishNow()
    }, wait)
  }

  private scheduleRetry(): void {
    if (this.cancelRetry || this.stopped) return
    const ms = this.backoff[Math.min(this.attempt, this.backoff.length - 1)] ?? 60_000
    this.attempt++
    this.cancelRetry = this.opts.clock.schedule(() => {
      void this.opts
        .retry()
        .catch(() => {})
        .finally(() => {
          this.cancelRetry = null
          if (this.failed.size > 0) this.scheduleRetry()
        })
    }, ms)
  }

  private resetRetry(): void {
    this.attempt = 0
    this.cancelRetry?.()
    this.cancelRetry = null
  }

  blockedCount(): number {
    let n = 0
    for (const status of this.failed.values()) if (status !== null) n++
    return n
  }

  stop(): void {
    this.stopped = true
    this.cancelPublish?.()
    this.cancelPublish = null
    this.resetRetry()
  }
}
