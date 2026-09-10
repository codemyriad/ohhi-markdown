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
import type { FileEntry } from '@editor/sync'
import type { StoreIo } from './stores.js'

/**
 * Where a mount came from. 'adopted' (slice N1) is the peer-side mirror of
 * 'carved': someone else carved this subtree out of a room we are a peer of,
 * and this device built the mount's stores from its OWN parent namespace.
 */
export type MountProvenance = 'local' | 'carved' | 'joined' | 'adopted'

export type MountStatus =
  | 'active'
  | 'carving:seeding'
  | 'carving:detaching'
  | 'joining'
  | 'unsharing:absorbing'
  | 'unsharing:disconnecting'
  /** Peer-side adopt (N1): building the mount's stores from our own state. */
  | 'adopting:seeding'
  /** Peer-side adopt (N1): scrubbing the subtree from the parent namespace. */
  | 'adopting:detaching'
  /**
   * Peer-side absorb (N1): the owner unshared, and this device is folding the
   * mount's stores back into the parent namespace. The same surgery as
   * 'unsharing:absorbing', minus the map transaction — on a peer the map is
   * the owner's and only the stores are ours (spike S10 Q1(b)).
   */
  | 'absorbing'
  /**
   * Steady state, NOT a recovery state: the mount's stores exist and its files
   * stay on disk under an ignored prefix, but no token for the room is held on
   * this device, so no providers start. Boot must neither roll it back nor
   * forward — a later paste activates it without re-seeding (device-link
   * shaping A3/A4-C).
   */
  | 'needs-token'

/** Statuses boot leaves alone: a mount sitting in one of these is settled. */
const SETTLED = new Set<MountStatus>(['active', 'needs-token'])

/** A status that boot must recover from (roll back or roll forward). */
export type RecoverableMountStatus = Exclude<MountStatus, 'active' | 'needs-token'>

/** Does this status need crash recovery at boot? */
export function isRecoverable(status: MountStatus): status is RecoverableMountStatus {
  return !SETTLED.has(status)
}

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

/** Spike S8 recovery tables (Q1/Q4/Q6), extended by S10-Q1 (adopting:*). */
const RECOVERY: Record<RecoverableMountStatus, MountRecovery['action']> = {
  'carving:seeding': 'rollback',
  'carving:detaching': 'rollforward',
  joining: 'rollback',
  'unsharing:absorbing': 'rollforward',
  'unsharing:disconnecting': 'rollforward',
  // Mirror of carving:* on the peer — the mount entry is still in the parent
  // map, so a rolled-back adopt simply re-adopts at the next boot.
  'adopting:seeding': 'rollback',
  'adopting:detaching': 'rollforward',
  // Peer-side absorb: the store copy is idempotent, so an interrupted one
  // re-runs and then disconnects — the owner's row with writeMap:false.
  absorbing: 'rollforward',
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

  /**
   * Insert or MERGE the desc for `room`: `make` is handed the stored desc (if
   * any) INSIDE the serialized read-modify-write, so a caller that needs to
   * preserve fields it does not own — a relay URL it has no token for, a
   * `needs-token` status only the host can lift (N1, spike S10 Q2) — never
   * reads a desc that a concurrent transition has since replaced.
   */
  upsertWith(room: string, make: (existing: MountDesc | undefined) => MountDesc): Promise<void> {
    return this.mutate((mounts) => [
      ...mounts.filter((m) => m.room !== room),
      make(mounts.find((m) => m.room === room)),
    ])
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

  /**
   * Classify every interrupted mount into its recovery action (no execution).
   * Settled statuses ('active', 'needs-token') never appear: a mount waiting
   * for a token is a steady state, not a half-made one.
   */
  async recover(): Promise<MountRecovery[]> {
    return (await this.load())
      .filter((m) => isRecoverable(m.status))
      .map((m) => ({ action: RECOVERY[m.status as RecoverableMountStatus], desc: m }))
  }

  private mutate(fn: (mounts: MountDesc[]) => MountDesc[]): Promise<void> {
    const run = this.work.then(async () => {
      await this.save(fn(await this.load()))
    })
    this.work = run.catch(() => {})
    return run
  }
}

/**
 * The live ignore-set seam (device-link-shaping A2, S10-Q6): the mount roots a
 * session's adapter must hide are the union of TWO authorities —
 *
 *   - `mounts.json`: every non-root mount this device has decided to run
 *     (including a 'needs-token' one, whose files stay on disk untouched), and
 *   - the parent map's `kind:'mount'` entries: a carve another peer just made,
 *     which reaches this device BEFORE it has a desc of its own.
 *
 * Deriving from both is what makes "a peer's watcher never re-enrolls under P"
 * true from the instant the map change lands, not from the end of the adopt.
 * Pure: callers decide when to recompute and hand the result to
 * `ignoringAdapter` (which reads the set on every call).
 */
export function mountRootsFrom(
  descs: readonly MountDesc[],
  mapEntries: readonly (readonly [string, FileEntry])[]
): Set<string> {
  const roots = new Set<string>()
  for (const desc of descs) if (desc.path !== '') roots.add(desc.path)
  for (const [path, entry] of mapEntries) {
    if (entry.kind === 'mount' && !entry.deleted && path !== '') roots.add(path)
  }
  return roots
}
