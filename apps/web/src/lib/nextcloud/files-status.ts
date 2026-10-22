/**
 * The `files` readout's logic (nextcloud-build decision 8), pure: a headless
 * custodian announces per doc guid whether the file in Nextcloud matches the
 * note (`match`), is still being written (`behind`) or was refused
 * (`blocked`, with the HTTP status). The shell maps that onto paths through
 * the file rows and sums it into one honest line. No custodian present →
 * nothing at all: the readout never claims Files are kept when nobody is
 * keeping them.
 */
import type { CustodianState } from '@ohhi/workspace'

/** The rows' identity map: a path, its doc guid and its kind (only text notes are announced). */
export interface GuidRow {
  path: string
  guid: string | null
  kind?: 'text' | 'binary' | 'dir' | 'mount' | string
}

/** This browser's own sync record for a doc: what it has not handed the room yet. */
export interface LocalRecord {
  pendingLocal: boolean
  synced: boolean
}

export type FilesReadout =
  | { kind: 'hidden' }
  | { kind: 'in-files' }
  | { kind: 'waiting'; count: number }
  | { kind: 'blocked'; count: number; status: number | null }

/**
 * One line for the whole vault: a refusal outranks a pending write, which
 * outranks "in Files". `status` is the first refused file's HTTP status
 * (423 locked, 403, 507…), null when the custodian gave none.
 *
 * "In Files" is claimed only for what is known to be there (nextcloud-build R1 #8): a
 * note the custodian has not announced yet (brand new, or inside its 500 ms
 * throttle) is waiting, and so is one this browser has edits for that the
 * room has not taken (`pendingLocal`, or the doc not `synced`) — the
 * custodian cannot have written what it has not received.
 */
export function filesReadout(
  custodian: CustodianState | null,
  rows: readonly GuidRow[],
  records: Readonly<Record<string, LocalRecord | undefined>> = {}
): FilesReadout {
  if (!custodian) return { kind: 'hidden' }
  let waiting = 0
  let blocked = 0
  let status: number | null = null
  for (const row of rows) {
    if (!row.guid || (row.kind !== undefined && row.kind !== 'text')) continue
    const state = custodian.disk[row.guid]
    const local = records[row.guid]
    if (state === 'blocked') {
      blocked++
      const s = custodian.blocked[row.guid]
      if (status === null && typeof s === 'number') status = s
    } else if (state !== 'match' || (local && (local.pendingLocal || !local.synced))) {
      waiting++
    }
  }
  if (blocked > 0) return { kind: 'blocked', count: blocked, status }
  if (waiting > 0) return { kind: 'waiting', count: waiting }
  return { kind: 'in-files' }
}

/**
 * An enrolment in flight (`custodian: 'enrolling'`), as "N of M": the notes
 * the custodian has written into the room so far that match their file (N),
 * of those it has announced (M — it grows while the folder is read). Null
 * when nothing is being enrolled.
 */
export function enrollingProgress(
  status: { custodian: string; files: Readonly<Record<string, string>> } | null
): { done: number; total: number } | null {
  if (!status || status.custodian !== 'enrolling') return null
  const states = Object.values(status.files)
  return { done: states.filter((s) => s === 'match').length, total: states.length }
}
