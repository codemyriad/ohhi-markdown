/**
 * The inspector's pure half (devtools-shaping D5): how one row of a mount is
 * classified, and how the table is filtered. DOM-free so the classification
 * — the thing the "find the files that are wrong" requirement rests on — is
 * unit-tested on node rather than eyeballed.
 *
 * A row's state combines two sources the panel already had separately: the
 * session's facts (is there an LCA, is there a doc, do the heads agree) and
 * the live sync record the pill reads. The record wins on `diverged`, since
 * that is the one state the reconciler has already refused to write over.
 */
import type { PathInspection, PathPeek, SyncRecordFields } from '@ohhi/workspace'

export type RowState =
  | 'diverged'
  | 'disk-changed'
  | 'doc-ahead'
  | 'no-lca'
  | 'no-doc'
  | 'in-sync'
  | 'not-text'

/** Worst first — the order the state filter lists them in. */
export const ROW_STATES: readonly RowState[] = [
  'diverged',
  'disk-changed',
  'doc-ahead',
  'no-lca',
  'no-doc',
  'in-sync',
  'not-text',
]

/** The states that mean "something to look at". */
export function isWrong(state: RowState): boolean {
  return state === 'diverged' || state === 'disk-changed' || state === 'doc-ahead'
}

export function rowState(row: PathInspection, record: SyncRecordFields | undefined): RowState {
  if (row.kind !== 'text') return 'not-text'
  if (record?.diverged) return 'diverged'
  if (!row.lca) return 'no-lca'
  if (!row.doc) return 'no-doc'
  if (record && !record.diskMatchesCrdt) return 'disk-changed'
  if (row.doc.equalsLca === false) return 'doc-ahead'
  return 'in-sync'
}

export interface RowFilter {
  /** A workspace-path prefix; '' matches everything. Folder-shaped: `notes` matches `notes/…` and `notes.md` alike. */
  prefix: string
  /** null = any state. */
  state: RowState | null
}

export interface ClassifiedRow {
  row: PathInspection
  state: RowState
}

export function filterRows<T extends ClassifiedRow>(rows: readonly T[], filter: RowFilter): T[] {
  const prefix = filter.prefix.trim()
  return rows.filter(
    ({ row, state }) =>
      (filter.state === null || state === filter.state) && (prefix === '' || row.path.startsWith(prefix))
  )
}

/** How many rows sit in each state — the counts the filter chips show. */
export function countByState(rows: readonly ClassifiedRow[]): Record<RowState, number> {
  const out = Object.fromEntries(ROW_STATES.map((s) => [s, 0])) as Record<RowState, number>
  for (const r of rows) out[r.state]++
  return out
}

// ---- the chain: disk ═ lca ═ doc ═ relay ----

/** One link of the chain: do the two stages either side of it agree? */
export type Link = 'equal' | 'differs' | 'unknown'
export type RelayLink = 'synced' | 'pending' | 'offline' | 'none' | 'unknown'

export interface Chain {
  diskLca: Link
  lcaDoc: Link
  relay: RelayLink
}

/**
 * The chain a ROW can claim without reading disk. `lcaDoc` is the heads
 * comparison the session already made; `diskLca` is inferred from it and the
 * record's `diskMatchesCrdt` (disk vs doc), by the reconciler's own table:
 * doc ahead of the LCA with disk behind the doc is the flush-pending case,
 * where disk still equals the LCA; doc level with the LCA but disk not level
 * with the doc is a disk change the reconciler has not ingested yet. The
 * selected file replaces the inference with a real hash comparison (`peekChain`).
 */
export function chainOf(row: PathInspection, record: SyncRecordFields | undefined): Chain {
  if (row.kind !== 'text') return { diskLca: 'unknown', lcaDoc: 'unknown', relay: 'none' }
  // A link needs both of its ends: no LCA record or no doc in memory is unknown.
  const lcaDoc: Link =
    !row.lca || !row.doc ? 'unknown' : row.doc.equalsLca === true ? 'equal' : row.doc.equalsLca === false ? 'differs' : 'unknown'
  let diskLca: Link = 'unknown'
  if (record?.diverged) diskLca = 'differs'
  else if (record && lcaDoc !== 'unknown') {
    diskLca = lcaDoc === 'equal' ? (record.diskMatchesCrdt ? 'equal' : 'differs') : record.diskMatchesCrdt ? 'differs' : 'equal'
  }
  return { diskLca, lcaDoc, relay: relayOf(row, record) }
}

export function relayOf(row: PathInspection, record: SyncRecordFields | undefined): RelayLink {
  if (!row.providerAttached) return 'none'
  if (!record) return 'unknown'
  if (!record.connected) return 'offline'
  return record.synced && !record.pendingLocal ? 'synced' : 'pending'
}

/** The chain for the selected file, with disk vs LCA measured rather than inferred. */
export function peekChain(chain: Chain, peek: PathPeek | null): Chain {
  if (!peek || !peek.disk || !peek.lca) return chain
  return { ...chain, diskLca: peek.disk.hash === peek.lca.hash ? 'equal' : 'differs' }
}

// ---- the peek: a line diff between two of the three texts ----

export interface DiffLine {
  kind: 'same' | 'add' | 'del'
  text: string
}

/** Above this many lines on a side the diff is skipped — it is a peek, not a review. */
export const DIFF_LINE_CAP = 3000

/**
 * A plain LCS line diff, `a` → `b`. Small on purpose: the divergence review
 * has diff3 for the real thing; this shows a human what moved between two
 * of the three texts. Returns null above the cap.
 */
export function lineDiff(a: string, b: string): DiffLine[] | null {
  const A = a.split('\n')
  const B = b.split('\n')
  if (A.length > DIFF_LINE_CAP || B.length > DIFF_LINE_CAP) return null
  const n = A.length
  const m = B.length
  // Trim the common prefix and suffix first; most edits are local.
  let start = 0
  while (start < n && start < m && A[start] === B[start]) start++
  let endA = n
  let endB = m
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--
    endB--
  }
  const w = endB - start + 1
  const dp = new Uint32Array((endA - start + 1) * w)
  for (let i = endA - 1; i >= start; i--) {
    for (let j = endB - 1; j >= start; j--) {
      const ii = i - start
      const jj = j - start
      dp[ii * w + jj] =
        A[i] === B[j]
          ? dp[(ii + 1) * w + jj + 1] + 1
          : Math.max(dp[(ii + 1) * w + jj], dp[ii * w + jj + 1])
    }
  }
  const out: DiffLine[] = []
  for (let k = 0; k < start; k++) out.push({ kind: 'same', text: A[k] })
  let i = start
  let j = start
  while (i < endA && j < endB) {
    const ii = i - start
    const jj = j - start
    if (A[i] === B[j]) {
      out.push({ kind: 'same', text: A[i] })
      i++
      j++
    } else if (dp[(ii + 1) * w + jj] >= dp[ii * w + jj + 1]) {
      out.push({ kind: 'del', text: A[i] })
      i++
    } else {
      out.push({ kind: 'add', text: B[j] })
      j++
    }
  }
  while (i < endA) out.push({ kind: 'del', text: A[i++] })
  while (j < endB) out.push({ kind: 'add', text: B[j++] })
  for (let k = endA; k < n; k++) out.push({ kind: 'same', text: A[k] })
  return out
}

export type PeekView = 'doc-lca' | 'disk-lca' | 'disk-doc' | 'disk' | 'lca' | 'doc'

/** The most telling view for a chain: the diff across the link that differs, else the doc. */
export function defaultPeekView(chain: Chain): PeekView {
  if (chain.lcaDoc === 'differs') return 'doc-lca'
  if (chain.diskLca === 'differs') return 'disk-lca'
  return 'doc'
}
