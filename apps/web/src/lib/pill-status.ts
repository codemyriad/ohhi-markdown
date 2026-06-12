/**
 * Sync-pill status logic — pure functions only, per the ui-development skill:
 * the pill component renders f(syncRecord) and contains no further logic.
 * Status table: docs/architecture/sync.md ("syncRecord and the pill").
 */

export type PillStatus = 'green' | 'yellow' | 'red' | 'offline'

/** Plain snapshot of a per-doc sync record (the reactive flavour lives in sync-record.svelte.ts). */
export interface SyncRecordSnapshot {
  /** Provider has a live relay connection. */
  connected: boolean
  /** Provider handshake completed (relay received and applied our state). */
  synced: boolean
  /** Local updates emitted but not yet acked by the relay (provider unsyncedChanges > 0). */
  pendingLocal: boolean
  /** Disk content == CRDT content (flush/materialize settled). */
  diskMatchesCrdt: boolean
  /** Reconciler raised a true three-way conflict. */
  diverged: boolean
}

export function pillStatus(r: SyncRecordSnapshot): PillStatus {
  // Divergence dominates everything, including offline (sync.md status table).
  if (r.diverged) return 'red'
  if (!r.connected) return 'offline'
  if (!r.synced || r.pendingLocal || !r.diskMatchesCrdt) return 'yellow'
  return 'green'
}

const SEVERITY: Record<PillStatus, number> = { green: 0, yellow: 1, offline: 2, red: 3 }

/** Global rollup: worst status wins. Empty input claims less, not more. */
export function worstStatus(statuses: PillStatus[]): PillStatus {
  if (statuses.length === 0) return 'offline'
  return statuses.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst))
}

/**
 * Title text per status. Green deliberately says "synced (relay)" — relay
 * receipt, not durable ack; durable-ack honesty lands V2 (plans/V1-plan.md,
 * deviations).
 */
export const PILL_TITLES: Record<PillStatus, string> = {
  green: 'synced (relay)',
  yellow: 'working — ops or disk flush in flight',
  red: 'diverged — review required',
  offline: 'offline — edits safe locally, nothing reaching the relay',
}
