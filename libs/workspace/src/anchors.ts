/**
 * Anchors: THE one place a range of a note is pinned with a pair of
 * `Y.RelativePosition`s and carried as JSON (writing-harness-build §Ground
 * rules › Duplication). Suggestions (B7, `suggestions.ts`) and comment
 * threads (B8) both anchor through here; a second encoder is a finding.
 *
 * Why relative positions: an offset is wrong the moment anyone types above
 * it. A relative position names the CHARACTER the range starts at (and the
 * one it ends after), so it follows every insert and delete — a peer's, the
 * reconciler's, the agent's — and needs no mapping pass of its own
 * (`plans/research/harness-in-doc-editing.md` §1).
 *
 * Engine-coupled by nature, like `libs/editor/src/binding.ts`: a relative
 * position IS a Yjs structure, so this module imports `yjs` and reaches the
 * Y.Doc only through `EngineDoc.raw()` (docs/architecture/overview.md,
 * dependency rule 3 — the sanctioned exception for anchoring, alongside the
 * collab binding). Nothing here stamps time or schedules (golden rule 5).
 */
import type { EngineDoc } from '@ohhi/sync'
import * as Y from 'yjs'

/** `Y.relativePositionToJSON`'s output: plain data, safe in a Y.Map or a JSONL line. */
export type RelativePositionJSON = Record<string, unknown>

/** A range as two relative positions: `[start, end]`. */
export type AnchorPair = [RelativePositionJSON, RelativePositionJSON]

/** An absolute, half-open character range `[from, to)` in the note's text. */
export interface TextRange {
  from: number
  to: number
}

/** The engine's text key (libs/sync/src/yjs-engine.ts, libs/editor/src/binding.ts). */
const TEXT_KEY = 'content'

/** The Y.Doc behind an engine doc, or the Y.Doc itself. */
export function ydocOf(doc: Y.Doc | EngineDoc): Y.Doc {
  return 'raw' in doc && typeof doc.raw === 'function' ? (doc.raw() as Y.Doc) : (doc as Y.Doc)
}

/** The note's Y.Text (the one the editor binding edits). */
export function ytextOf(doc: Y.Doc | EngineDoc): Y.Text {
  return ydocOf(doc).getText(TEXT_KEY)
}

/**
 * Pin `[from, to)` of `ytext`. Inserts AT either edge land OUTSIDE the range:
 * the start sticks to the first character of the range (assoc 0), the end to
 * the last (assoc −1). An empty range — a pure insertion point — pins both
 * ends to the same character so they can never cross. Offsets are clamped
 * to the text.
 */
export function encodeRange(ytext: Y.Text, from: number, to: number): AnchorPair {
  const len = ytext.length
  const a = Math.max(0, Math.min(from, len))
  const b = Math.max(a, Math.min(to, len))
  const start = Y.createRelativePositionFromTypeIndex(ytext, a, 0)
  const end = a === b ? start : Y.createRelativePositionFromTypeIndex(ytext, b, -1)
  return [Y.relativePositionToJSON(start) as RelativePositionJSON, Y.relativePositionToJSON(end) as RelativePositionJSON]
}

/**
 * Where a pinned range is NOW, or null when it cannot be resolved (the pair
 * is malformed, or names content this replica has not received yet). A range
 * whose text was deleted collapses to the point where it was; one a
 * concurrent edit turned inside out is clamped to empty at its start.
 */
export function decodeRange(doc: Y.Doc | EngineDoc, pair: readonly [unknown, unknown]): TextRange | null {
  const ydoc = ydocOf(doc)
  try {
    const [rawStart, rawEnd] = pair
    if (!rawStart || !rawEnd || typeof rawStart !== 'object' || typeof rawEnd !== 'object') return null
    const start = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(rawStart), ydoc)
    const end = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(rawEnd), ydoc)
    if (!start || !end) return null
    return { from: start.index, to: Math.max(start.index, end.index) }
  } catch {
    return null
  }
}
