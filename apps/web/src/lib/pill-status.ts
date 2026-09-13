/**
 * Sync-pill status logic — pure functions only, per the ui-development skill:
 * the pill component renders f(syncRecord) and contains no further logic.
 * Status table: docs/architecture/sync.md ("syncRecord and the pill").
 */
import { getLL } from '@ohhi/i18n'

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
 * The pill's copy lives in the dictionary (`web.pill.*`); these read it
 * through `getLL()` because this module is not a component. Green
 * deliberately says "synced (relay)" — relay receipt, not durable ack;
 * durable-ack honesty lands V2 (plans/V1-plan.md, deviations).
 */
/** Short inline label beside the dot (the status bar). Same claims as the titles. */
export function pillLabel(status: PillStatus): string {
  return getLL().web.pill.label[status]()
}

export function pillTitle(status: PillStatus): string {
  return getLL().web.pill.title[status]()
}

/**
 * The VAULT rollup's own copy (P3): Title case beside the vault's name, and a
 * title that says whose state it is. The pill in the navigator answers "what
 * is this?" on its own — the status key never reaches a person.
 */
export function vaultLabel(status: PillStatus): string {
  return getLL().web.pill.vault[status]()
}

export function vaultTitle(status: PillStatus): string {
  return getLL().web.pill.vault_title[status]()
}
