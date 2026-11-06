/**
 * The vault marker as a lease (nextcloud-build decision 13): `ohhi-host.md` at
 * the vault root, a reserved name every adapter hides from `list`/`watch`; its
 * format is `@ohhi/vault`'s `formatHostMarker` / `parseHostMarker`, which the
 * desktop manager reads too. Written through the vault adapter with
 * compare-and-swap — over WebDAV that is `If-Match` (`If-None-Match: *` for
 * the first write) — and re-written every 30 s as a heartbeat. A swap that loses to a marker naming
 * ANOTHER instance means a second container is holding this folder: this
 * custodian stops (`lease-lost`) and says so once.
 */
import {
  formatHostMarker,
  hashBytes,
  OHHI_HOST_MARKER,
  parseHostMarker,
  WriteConflictError,
  type Clock,
  type HostMarker,
  type VaultAdapter,
} from '@ohhi/vault'
import { every } from './every.js'

export async function readMarker(adapter: Pick<VaultAdapter, 'read'>): Promise<HostMarker | null | 'unreadable'> {
  const bytes = await adapter.read(OHHI_HOST_MARKER)
  if (bytes === null) return null
  return parseHostMarker(bytes) ?? 'unreadable'
}

/** Why `acquire` would not take the lease. */
export type AcquireRefusal = 'other-room' | 'epoch-mismatch' | 'held-elsewhere' | 'unreadable'

export interface LeaseOptions {
  adapter: Pick<VaultAdapter, 'read' | 'writeAtomic' | 'writeReserved'>
  clock: Clock
  instance: string
  room: string
  vault: string
  epoch: number
  heartbeatMs?: number
  /** A marker heartbeat older than this from another instance is stale and may be taken over. */
  staleMs?: number
  /** Another instance holds the folder now; the lease has stopped itself. */
  onLost: (holder: string) => void
  onError?: (err: unknown) => void
}

export class MarkerLease {
  private lastHash: string | null = null
  private stopBeat: (() => void) | null = null
  private stopped = false
  private lost = false
  private readonly heartbeatMs: number
  private readonly staleMs: number

  constructor(private readonly opts: LeaseOptions) {
    this.heartbeatMs = opts.heartbeatMs ?? 30_000
    this.staleMs = opts.staleMs ?? 3 * this.heartbeatMs
  }

  /** The marker is a reserved name: an adapter that refuses those in `writeAtomic` has `writeReserved`. */
  private write(bytes: Uint8Array, opts: { expectHash: string }): Promise<void> {
    const a = this.opts.adapter
    return a.writeReserved ? a.writeReserved(OHHI_HOST_MARKER, bytes, opts) : a.writeAtomic(OHHI_HOST_MARKER, bytes, opts)
  }

  private body(): Uint8Array {
    return formatHostMarker({
      room: this.opts.room,
      vault: this.opts.vault,
      epoch: this.opts.epoch,
      instance: this.opts.instance,
      heartbeat: new Date(this.opts.clock.now()).toISOString(),
    })
  }

  /**
   * Take the lease. `create` (enrolment) writes a marker where there is none;
   * a reopen expects this vault's marker — same room and epoch — and takes it
   * over from a stale holder, never from a live one.
   */
  async acquire(mode: 'create' | 'reopen'): Promise<{ ok: true } | { ok: false; reason: AcquireRefusal }> {
    const current = await this.opts.adapter.read(OHHI_HOST_MARKER)
    let expectHash = ''
    if (current !== null) {
      const m = parseHostMarker(current)
      if (!m) return { ok: false, reason: 'unreadable' }
      // A new vault has a new room: any marker already there is someone else's.
      if (mode === 'create') return { ok: false, reason: 'other-room' }
      if (m.room !== this.opts.room || m.vault !== this.opts.vault) return { ok: false, reason: 'other-room' }
      if (m.epoch !== this.opts.epoch) return { ok: false, reason: 'epoch-mismatch' }
      if (m.instance !== this.opts.instance) {
        const beat = Date.parse(m.heartbeat)
        const fresh = Number.isFinite(beat) && this.opts.clock.now() - beat < this.staleMs
        if (fresh) return { ok: false, reason: 'held-elsewhere' }
      }
      expectHash = hashBytes(current)
    } else if (mode === 'reopen') {
      // The marker went missing (deleted in Files): the row, the store and the
      // room still agree, so the custodian re-asserts it with If-None-Match.
      expectHash = ''
    }
    const bytes = this.body()
    try {
      await this.write(bytes, { expectHash })
    } catch (err) {
      if (err instanceof WriteConflictError) return { ok: false, reason: 'held-elsewhere' }
      throw err
    }
    this.lastHash = hashBytes(bytes)
    if (!this.stopped) this.stopBeat = every(this.opts.clock, this.heartbeatMs, () => this.beat(), this.opts.onError)
    return { ok: true }
  }

  /** One heartbeat: rewrite the marker only if it is still the one we wrote. */
  async beat(): Promise<void> {
    if (this.stopped || this.lastHash === null) return
    const bytes = this.body()
    try {
      await this.write(bytes, { expectHash: this.lastHash })
      this.lastHash = hashBytes(bytes)
    } catch (err) {
      if (!(err instanceof WriteConflictError)) {
        // Nextcloud down or the write refused: the lease is not lost, it is late.
        this.opts.onError?.(err)
        return
      }
      const now = await this.opts.adapter.read(OHHI_HOST_MARKER).catch(() => null)
      const m = now ? parseHostMarker(now) : null
      if (m && m.instance !== this.opts.instance) {
        this.lose(m.instance)
        return
      }
      if (now && m && m.instance === this.opts.instance && m.room === this.opts.room && m.epoch === this.opts.epoch) {
        // Ours, but the bytes moved under us (an echo, a version restore): adopt them.
        this.lastHash = hashBytes(now)
        return
      }
      if (!now) {
        // Deleted in Files: put it back, without clobbering a racing creator.
        try {
          await this.write(bytes, { expectHash: '' })
          this.lastHash = hashBytes(bytes)
        } catch (e) {
          this.opts.onError?.(e)
        }
        return
      }
      // Rewritten by someone into something that is not our marker: not a
      // lease another custodian holds, but not ours to overwrite either.
      this.opts.onError?.(new Error('the vault marker was replaced'))
    }
  }

  private lose(holder: string): void {
    if (this.lost) return
    this.lost = true
    this.stop()
    this.opts.onLost(holder)
  }

  stop(): void {
    this.stopped = true
    this.stopBeat?.()
    this.stopBeat = null
  }

  /**
   * Stop, and if the lease is still ours, rewrite the marker with a stale
   * heartbeat (the epoch of time) under the same compare-and-swap: a clean
   * shutdown hands the folder to the next process at once. A marker someone
   * else rewrote meanwhile is left alone.
   */
  async release(): Promise<void> {
    const held = !this.stopped && !this.lost && this.lastHash !== null
    this.stop()
    if (!held) return
    const bytes = formatHostMarker({
      room: this.opts.room,
      vault: this.opts.vault,
      epoch: this.opts.epoch,
      instance: this.opts.instance,
      heartbeat: new Date(0).toISOString(),
    })
    try {
      await this.write(bytes, { expectHash: this.lastHash! })
    } catch (err) {
      if (!(err instanceof WriteConflictError)) this.opts.onError?.(err)
    }
  }
}
