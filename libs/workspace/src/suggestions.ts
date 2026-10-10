/**
 * Suggestions in the document (writing-harness shaping B7, Fork 4-B): an
 * agent's proposed edit is a RECORD beside the text, never bytes in it —
 * `{ range, baseText, proposedText, status }`, with the range pinned by a
 * relative-position pair (`anchors.ts`), so it follows every edit around it.
 *
 * Where records live (one `RecordMap` seam, two backings):
 *  - a doc whose mount is attached to a relay → a `suggestions` Y.Map in the
 *    note's own Y.Doc, beside the text, so every peer sees the proposal
 *    before it lands (the point of 4-B on a shared note);
 *  - any other doc → an in-memory map for the open doc. Nothing about a
 *    proposal on a never-shared note is persisted into its doc blob.
 *
 * The lifecycle, and why it cannot lose anyone's work:
 *  - **propose** pins `[from, to)` and records the text it read there.
 *  - **stale**: after every doc update the pending ranges are re-resolved;
 *    a range whose text is no longer `baseText` (a peer typed or deleted
 *    inside it, or the reconciler ingested a disk edit there) flips to
 *    `stale` — it is never applied, so it never reverts what changed.
 *  - **accept** re-resolves the range and re-checks the text AT accept time,
 *    then replaces it in ONE transaction carrying the run's agent origin
 *    (attributed, undoable per run — `agent-origin.ts`), flipping the status
 *    in that same transaction on a shared doc.
 *  - **reject** drops the record. The text is never touched.
 *  - An insert at either edge of the range lands outside it (`encodeRange`),
 *    so a peer typing right up against a suggestion does not stale it.
 *
 * Engine-coupled (Y.Map, Y.Text) — the sanctioned exception `anchors.ts`
 * documents. No clock here: callers stamp `at` from the injected one.
 */
import * as Y from 'yjs'
import { decodeRange, encodeRange, ydocOf, ytextOf, type TextRange } from './anchors.js'
import { AgentRuns, type AgentOrigin } from './agent-origin.js'
import type { EngineDoc } from '@ohhi/sync'

/** Mirrors `@ohhi/harness`'s seam types (libs/harness/src/types.ts); asserted equal in apps/web. */
export type SuggestionRange = { yjs: [unknown, unknown] } | { from: number; to: number }
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'stale'
export interface SuggestionRecord {
  id: string
  path: string
  origin: AgentOrigin
  at: number
  range: SuggestionRange
  baseText: string
  proposedText: string
  status: SuggestionStatus
  threadId?: string
}

/** A record resolved against the text as it is now: what the editor draws. */
export interface SuggestionSpan {
  id: string
  from: number
  to: number
  baseText: string
  proposedText: string
  status: SuggestionStatus
  /** The writer's name (`origin.name`). */
  name: string
  runId: string
}

/** The text at the range no longer matches what the agent read. */
export class SuggestionConflictError extends Error {
  readonly code = 'suggestion.conflict' as const
  constructor(message: string) {
    super(message)
    this.name = 'SuggestionConflictError'
  }
}

/** The Y.Map key records live under on a shared doc. */
export const SUGGESTIONS_KEY = 'suggestions'

/**
 * The origin of a record-only write that is not the agent's: a stale flip, a
 * reject. Never `null` — the binding's undo manager tracks `null`.
 */
export const SUGGESTIONS_ORIGIN = 'suggestions'

/** Where a store keeps its records. Stored without `path`: a doc can be renamed, and peers mount it elsewhere. */
export interface RecordMap {
  readonly shared: boolean
  get(id: string): StoredRecord | undefined
  set(id: string, record: StoredRecord): void
  delete(id: string): void
  values(): StoredRecord[]
}
export type StoredRecord = Omit<SuggestionRecord, 'path'>

/** Records in the note's Y.Doc (`suggestions` Y.Map): a shared doc. Writes join the caller's transaction. */
export function yRecordMap(doc: Y.Doc | EngineDoc): RecordMap {
  const map = ydocOf(doc).getMap<StoredRecord>(SUGGESTIONS_KEY)
  return {
    shared: true,
    get: (id) => map.get(id),
    set: (id, record) => map.set(id, record),
    delete: (id) => map.delete(id),
    values: () => [...map.values()],
  }
}

/** Records in memory, for the open doc only: a never-shared note. */
export function memoryRecordMap(): RecordMap {
  const map = new Map<string, StoredRecord>()
  return {
    shared: false,
    get: (id) => map.get(id),
    set: (id, record) => void map.set(id, record),
    delete: (id) => void map.delete(id),
    values: () => [...map.values()],
  }
}

/** Where a record's range is now (relative positions, or plain offsets clamped to the text). */
export function resolveRange(doc: Y.Doc | EngineDoc, range: SuggestionRange): TextRange | null {
  if ('yjs' in range) return decodeRange(doc, range.yjs)
  const len = ytextOf(doc).length
  const from = Math.max(0, Math.min(range.from, len))
  return { from, to: Math.max(from, Math.min(range.to, len)) }
}

export interface ProposeInput {
  id: string
  /** Stamped by the caller from the injected clock. */
  at: number
  from: number
  to: number
  baseText: string
  proposedText: string
  origin: AgentOrigin
}

export interface SuggestionStoreOptions {
  doc: Y.Doc | EngineDoc
  records: RecordMap
  /** The mount's runs: the canonical origin and the per-run undo manager. */
  runs: AgentRuns
}

/**
 * One doc's suggestions. Listens to the doc for the stale check; `subscribe`
 * fires after any change to the text or the records (the editor's redraw).
 */
export class SuggestionStore {
  private readonly ydoc: Y.Doc
  private readonly ytext: Y.Text
  private readonly records: RecordMap
  private readonly runs: AgentRuns
  private readonly listeners = new Set<() => void>()
  private readonly onUpdate = (): void => {
    this.checkStale()
    this.emit()
  }

  constructor(opts: SuggestionStoreOptions) {
    this.ydoc = ydocOf(opts.doc)
    this.ytext = ytextOf(opts.doc)
    this.records = opts.records
    this.runs = opts.runs
    this.ydoc.on('update', this.onUpdate)
  }

  /** Pin a proposal. Throws `SuggestionConflictError` when the text there is not `baseText`. */
  propose(input: ProposeInput): StoredRecord {
    const text = this.ytext.toString()
    if (input.from < 0 || input.to < input.from || input.to > text.length || text.slice(input.from, input.to) !== input.baseText) {
      throw new SuggestionConflictError(`the text at ${input.from}–${input.to} is not the text the agent read`)
    }
    const origin = this.runs.origin(input.origin)
    const record: StoredRecord = {
      id: input.id,
      origin: { ...origin },
      at: input.at,
      range: { yjs: encodeRange(this.ytext, input.from, input.to) },
      baseText: input.baseText,
      proposedText: input.proposedText,
      status: 'pending',
      ...(origin.threadId !== undefined ? { threadId: origin.threadId } : {}),
    }
    this.write(() => this.records.set(record.id, record), origin)
    return record
  }

  /**
   * Apply a pending proposal: re-resolve, re-check, replace — one transaction
   * with the run's origin. Returns the record as it now stands (`accepted`,
   * or `stale` when the text moved under it), or null when there is none.
   */
  accept(id: string): StoredRecord | null {
    const record = this.records.get(id)
    if (!record) return null
    if (record.status !== 'pending') return record
    const at = this.current(record)
    if (!at) return this.flipStale(record)
    const origin = this.runs.track(record.origin, this.ytext)
    const accepted: StoredRecord = { ...record, status: 'accepted' }
    this.ydoc.transact(() => {
      if (at.to > at.from) this.ytext.delete(at.from, at.to - at.from)
      if (record.proposedText) this.ytext.insert(at.from, record.proposedText)
      // In the same transaction on either backing: the update this fires
      // must already read `accepted`, or the stale check would see the
      // replaced text and call the proposal stale.
      this.records.set(id, accepted)
    }, origin)
    // An in-memory record change fires no update of its own.
    if (!this.records.shared) this.emit()
    return accepted
  }

  /** Drop a record (any status). The text is never touched. */
  reject(id: string): boolean {
    if (!this.records.get(id)) return false
    this.write(() => this.records.delete(id), SUGGESTIONS_ORIGIN)
    return true
  }

  /** Every record, newest first, as stored (`path` is the caller's to add). */
  list(): StoredRecord[] {
    return this.records.values().sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
  }

  /** The records still on the page (pending or stale), resolved against the text now. */
  spans(): SuggestionSpan[] {
    const out: SuggestionSpan[] = []
    for (const r of this.list()) {
      if (r.status !== 'pending' && r.status !== 'stale') continue
      const at = resolveRange(this.ydoc, r.range)
      if (!at) continue
      out.push({
        id: r.id,
        from: at.from,
        to: at.to,
        baseText: r.baseText,
        proposedText: r.proposedText,
        status: r.status,
        name: r.origin.name,
        runId: r.origin.runId,
      })
    }
    return out.sort((a, b) => a.from - b.from)
  }

  /**
   * Flip every pending record whose range no longer holds `baseText` to
   * `stale`. Runs after every doc update; cheap when nothing is pending.
   */
  checkStale(): void {
    const pending = this.records.values().filter((r) => r.status === 'pending')
    if (pending.length === 0) return
    const text = this.ytext.toString()
    const stale = pending.filter((r) => {
      const at = resolveRange(this.ydoc, r.range)
      return !at || text.slice(at.from, at.to) !== r.baseText
    })
    if (stale.length === 0) return
    this.write(() => {
      for (const r of stale) this.records.set(r.id, { ...r, status: 'stale' })
    }, SUGGESTIONS_ORIGIN)
  }

  /** Called after any change to the text or the records. */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  destroy(): void {
    this.ydoc.off('update', this.onUpdate)
    this.listeners.clear()
  }

  /** The record's range if its text is still `baseText`, else null. */
  private current(record: StoredRecord): TextRange | null {
    const at = resolveRange(this.ydoc, record.range)
    if (!at) return null
    return this.ytext.toString().slice(at.from, at.to) === record.baseText ? at : null
  }

  private flipStale(record: StoredRecord): StoredRecord {
    const stale: StoredRecord = { ...record, status: 'stale' }
    this.write(() => this.records.set(record.id, stale), SUGGESTIONS_ORIGIN)
    return stale
  }

  /** A record write: in a transaction on a shared doc (its update notifies), else direct + notify. */
  private write(fn: () => void, origin: unknown): void {
    if (this.records.shared) {
      this.ydoc.transact(fn, origin)
      return
    }
    fn()
    this.emit()
  }

  private emit(): void {
    for (const cb of [...this.listeners]) {
      try {
        cb()
      } catch {
        // A listener (an editor redraw) must never break the doc's update path.
      }
    }
  }
}
