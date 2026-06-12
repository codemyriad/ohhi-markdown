/**
 * Per-doc reactive sync record. The pure status logic lives in
 * pill-status.ts (unit-tested without the Svelte compiler); this module just
 * adds the $state flavour the UI binds to.
 */
import type { SyncRecordSnapshot } from './pill-status.js'

export {
  pillStatus,
  worstStatus,
  PILL_TITLES,
  type PillStatus,
  type SyncRecordSnapshot,
} from './pill-status.js'

export type SyncRecord = SyncRecordSnapshot

export function createSyncRecord(): SyncRecord {
  const record = $state<SyncRecordSnapshot>({
    connected: false,
    synced: false,
    pendingLocal: false,
    diskMatchesCrdt: true,
    diverged: false,
  })
  return record
}
