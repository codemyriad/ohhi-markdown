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

// ---- the second pass: order, tone, the mount header, the report ----

/**
 * The colour family a state paints in — the pill's own (devtools-shaping
 * R9): red for divergence only, amber for what is pending, green for in
 * sync; the two "nothing to compare yet" states and not-text are muted.
 */
export type Tone = 'ok' | 'pending' | 'diverged' | 'offline' | 'muted'

export const STATE_TONE: Record<RowState, Tone> = {
  diverged: 'diverged',
  'disk-changed': 'pending',
  'doc-ahead': 'pending',
  'no-lca': 'muted',
  'no-doc': 'muted',
  'in-sync': 'ok',
  'not-text': 'muted',
}

/** A link's tone: a differing link is pending amber, red only on a diverged row (the caller says which). */
export function linkTone(link: Link, diverged: boolean): Tone {
  if (link !== 'differs') return 'muted'
  return diverged ? 'diverged' : 'pending'
}

export const RELAY_TONE: Record<RelayLink, Tone> = {
  synced: 'ok',
  pending: 'pending',
  offline: 'offline',
  none: 'muted',
  unknown: 'muted',
}

export const LINK_GLYPH: Record<Link, string> = { equal: '═══', differs: '≠≠≠', unknown: '···' }
export const RELAY_GLYPH: Record<RelayLink, string> = { synced: '✓', pending: '…', offline: '✗', none: '–', unknown: '?' }

/** `disk ═══ base ≠≠≠ doc ✓ relay` — the chain as one line of text (the report). */
export function chainText(chain: Chain): string {
  return `disk ${LINK_GLYPH[chain.diskLca]} base ${LINK_GLYPH[chain.lcaDoc]} doc ${RELAY_GLYPH[chain.relay]} relay`
}

export type RowSort = 'worst' | 'path'

/**
 * The table's order (fork 4): worst first — `ROW_STATES` order, then path
 * within a state — or plain path order. Not-text rows go last either way:
 * shown, never in the way. A new array; the input is untouched.
 */
export function sortRows<T extends ClassifiedRow>(rows: readonly T[], sort: RowSort): T[] {
  const rank = (s: RowState): number => (sort === 'worst' ? ROW_STATES.indexOf(s) : s === 'not-text' ? 1 : 0)
  return [...rows].sort(
    (a, b) => rank(a.state) - rank(b.state) || (a.row.path < b.row.path ? -1 : a.row.path > b.row.path ? 1 : 0)
  )
}

/** What a mount's header and its scope chip say at a glance. */
export interface MountHealth {
  /** The dot: needs a link → offline; any diverged → diverged; anything pending → pending; else ok. */
  tone: 'ok' | 'pending' | 'diverged' | 'offline'
  /** Rows per state. */
  counts: Record<RowState, number>
  /** Text rows the relay has not received everything for. */
  atRelay: number
}

/** A mount's worst state, from its classified rows (with chains) and its `mounts.json` status. */
export function mountHealth(
  rows: readonly (ClassifiedRow & { chain: Chain })[],
  status: string | null | undefined
): MountHealth {
  const counts = countByState(rows)
  const atRelay = rows.filter((r) => r.chain.relay === 'pending').length
  const tone: MountHealth['tone'] =
    status === 'needs-token'
      ? 'offline'
      : counts.diverged > 0
        ? 'diverged'
        : counts['disk-changed'] + counts['doc-ahead'] + atRelay > 0
          ? 'pending'
          : 'ok'
  return { tone, counts, atRelay }
}

/** Which wrong counts a mount line names, in `ROW_STATES` order (zeros left out). */
export const WRONG_STATES: readonly RowState[] = ROW_STATES.filter(isWrong)

/**
 * Line 2 of a mount's card (devtools-shaping D4 amended): does `mounts.json`
 * agree with the live session? Computed, so the reader never compares two
 * columns by eye.
 */
export type Agreement =
  | { kind: 'agrees' }
  /** The root mount: `mounts.json` names only shared folders, so no row is expected. */
  | { kind: 'root' }
  | { kind: 'no-desc' }
  | { kind: 'needs-token'; neverHeld: boolean }
  /** A status boot recovers from (mid-carve, mid-unshare…): the session is between states. */
  | { kind: 'status'; status: string }
  | { kind: 'relay'; desc: string; session: string | null }

export function mountAgreement(m: {
  mountPath: string
  relay: string | null
  desc: { status: string; relay: string | null; neverHeld: boolean } | null
}): Agreement {
  if (!m.desc) return m.mountPath === '' ? { kind: 'root' } : { kind: 'no-desc' }
  if (m.desc.status === 'needs-token') return { kind: 'needs-token', neverHeld: m.desc.neverHeld }
  if (m.desc.status !== 'active') return { kind: 'status', status: m.desc.status }
  // No relay in the row means "the default for the room", which the session resolved.
  if (m.desc.relay !== null && m.desc.relay !== m.relay) return { kind: 'relay', desc: m.desc.relay, session: m.relay }
  return { kind: 'agrees' }
}

/** The host of a relay URL (`wss://relay.example/x` → `relay.example`), or the string when it is not a URL. */
export function relayHost(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

// ---- Copy report (R11): plain text for a bug report ----

/** The words a report carries, from the dictionary (field names are not copy). */
export interface ReportWords {
  title: string
  state(state: RowState): string
}

export interface ReportRow extends ClassifiedRow {
  chain: Chain
}

export type Report =
  | {
      kind: 'scope'
      /** The scope's name ("All mounts", or a mount's). */
      scope: string
      invariants: readonly string[]
      mounts: readonly { name: string; line: string }[]
      rows: readonly ReportRow[]
    }
  | {
      kind: 'file'
      row: ReportRow
      record?: SyncRecordFields
      peek?: PathPeek | null
      detail?: {
        guid: string
        mount: { path: string; room: string }
        lca: { contentHash: string; headsDigest: string; eol: string; bom: boolean; baseTextLength: number } | null
        doc: { headsDigest: string; textLength: number } | null
        journal: { count: number; recent: readonly { at: number; bytes: number }[] }
        providerAttached: boolean
      } | null
    }

/**
 * The two shapes *Copy report* offers (devtools-shaping open question 2):
 * the selected file, or every row in scope. Plain text, one fact per line,
 * paths left-aligned last so a long one never pushes the columns.
 */
export function reportText(report: Report, at: number, words: ReportWords): string {
  const out = [`${words.title} · ${new Date(at).toISOString()}`]
  if (report.kind === 'scope') {
    out.push(`scope: ${report.scope}`)
    out.push(report.invariants.length ? `invariants: ${report.invariants.length} violated` : 'invariants: hold')
    for (const v of report.invariants) out.push(`  ! ${v}`)
    for (const m of report.mounts) out.push(`mount ${m.name}: ${m.line}`)
    out.push(`rows: ${report.rows.length}`)
    const width = Math.max(0, ...report.rows.map((r) => words.state(r.state).length))
    for (const r of report.rows) {
      const chain = r.row.kind === 'text' ? chainText(r.chain) : r.row.kind
      out.push(`${words.state(r.state).padEnd(width)}  ${chain}  ${r.row.path}`)
    }
    return out.join('\n')
  }
  const { row, record, peek, detail } = report
  out.push(`path: ${row.row.path}`)
  out.push(`state: ${words.state(row.state)} (${row.state})`)
  out.push(`chain: ${chainText(peek ? peekChain(row.chain, peek) : row.chain)}`)
  if (record) {
    out.push(
      `record: connected ${record.connected} · synced ${record.synced} · pendingLocal ${record.pendingLocal} · diskMatchesCrdt ${record.diskMatchesCrdt} · diverged ${record.diverged}`
    )
  }
  if (detail) {
    out.push(`mount: '${detail.mount.path || '/'}' · room ${detail.mount.room} · guid ${detail.guid}`)
    out.push(`provider: ${detail.providerAttached ? 'attached' : 'none'}`)
    out.push(
      `hashes: disk ${peek?.disk ? peek.disk.hash.slice(0, 12) : '—'} · base ${detail.lca ? detail.lca.contentHash.slice(0, 12) : '—'}`
    )
    out.push(`heads: base ${detail.lca?.headsDigest ?? '—'} · doc ${detail.doc?.headsDigest ?? '—'}`)
    out.push(
      `lengths: base ${detail.lca?.baseTextLength ?? '—'} · doc ${detail.doc?.textLength ?? '—'} · eol ${detail.lca?.eol ?? '—'} · bom ${detail.lca?.bom ?? '—'}`
    )
    out.push(`journal: ${detail.journal.count}`)
    for (const e of detail.journal.recent) out.push(`  ${new Date(e.at).toISOString()} · ${e.bytes} B`)
  }
  return out.join('\n')
}

// ---- tone → classes (design tokens only: the pill's `--ed-sync-*`, golden rule 7) ----

/** Text in a tone: glyphs and the diverged badge's word. Muted is the house floor (/70). */
export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ed-sync-ok',
  pending: 'text-ed-sync-pending',
  diverged: 'text-ed-sync-diverged',
  offline: 'text-ed-sync-offline',
  muted: 'text-base-content/70',
}

/** A dot in a tone (chips, badges, the mount strip). Not text, so no contrast floor. */
export const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-ed-sync-ok',
  pending: 'bg-ed-sync-pending',
  diverged: 'bg-ed-sync-diverged',
  offline: 'bg-ed-sync-offline',
  muted: 'bg-base-content/40',
}

/** A badge's tint; its word stays `text-base-content` so it clears 4.5:1 on every theme. */
export const TONE_TINT: Record<Tone, string> = {
  ok: 'bg-ed-sync-ok/15',
  pending: 'bg-ed-sync-pending/15',
  diverged: 'bg-ed-sync-diverged/15',
  offline: 'bg-ed-sync-offline/15',
  muted: 'bg-base-200',
}
