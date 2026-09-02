/**
 * mounts.json: the per-vault mount table and lifecycle status machine
 * (spike S8). Every carve/join/unshare transition writes its status here
 * FIRST (atomic replace), so boot can classify an interrupted flow into the
 * spike's roll-back / roll-forward recovery actions. This module only
 * classifies — executing a recovery is the boot machine's job.
 *
 * MountDesc never carries a token (parent D4: descs/maps are advisory,
 * never an auth source) — tokens live in app config, keyed by room.
 */
import type { StoreIo } from './stores.js'

export type MountProvenance = 'local' | 'carved' | 'joined'

export type MountStatus =
  | 'active'
  | 'carving:seeding'
  | 'carving:detaching'
  | 'joining'
  | 'unsharing:absorbing'
  | 'unsharing:disconnecting'

export interface MountDesc {
  /** Room GUID: relay doc-name prefix and store namespace. */
  room: string
  /** Workspace-relative mount root ('' = the root mount). */
  path: string
  provenance: MountProvenance
  relay?: { url: string }
  status: MountStatus
}

export interface MountRecovery {
  action: 'rollback' | 'rollforward'
  desc: MountDesc
}

/** Spike S8 recovery tables (Q1/Q4/Q6). */
const RECOVERY: Record<Exclude<MountStatus, 'active'>, MountRecovery['action']> = {
  'carving:seeding': 'rollback',
  'carving:detaching': 'rollforward',
  joining: 'rollback',
  'unsharing:absorbing': 'rollforward',
  'unsharing:disconnecting': 'rollforward',
}

export class MountsFile {
  /** Serializes mutations so read-modify-write cycles never interleave. */
  private work: Promise<void> = Promise.resolve()

  constructor(private io: StoreIo) {}

  async load(): Promise<MountDesc[]> {
    const bytes = await this.io.read()
    if (!bytes) return []
    return JSON.parse(new TextDecoder().decode(bytes)) as MountDesc[]
  }

  async save(mounts: MountDesc[]): Promise<void> {
    await this.io.writeAtomic(new TextEncoder().encode(JSON.stringify(mounts)))
  }

  /** Insert or replace the desc for `desc.room`. */
  upsert(desc: MountDesc): Promise<void> {
    return this.mutate((mounts) => [...mounts.filter((m) => m.room !== desc.room), desc])
  }

  removeMount(room: string): Promise<void> {
    return this.mutate((mounts) => mounts.filter((m) => m.room !== room))
  }

  setStatus(room: string, status: MountStatus): Promise<void> {
    return this.mutate((mounts) => {
      const target = mounts.find((m) => m.room === room)
      if (!target) throw new Error(`setStatus: unknown mount room ${room}`)
      return mounts.map((m) => (m === target ? { ...m, status } : m))
    })
  }

  /** Classify every interrupted mount into its recovery action (no execution). */
  async recover(): Promise<MountRecovery[]> {
    return (await this.load())
      .filter((m) => m.status !== 'active')
      .map((m) => ({ action: RECOVERY[m.status as Exclude<MountStatus, 'active'>], desc: m }))
  }

  private mutate(fn: (mounts: MountDesc[]) => MountDesc[]): Promise<void> {
    const run = this.work.then(async () => {
      await this.save(fn(await this.load()))
    })
    this.work = run.catch(() => {})
    return run
  }
}
