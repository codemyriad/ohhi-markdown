/**
 * The active region (read-shaping B2, Spike S12): the lines a selection
 * touches. A construct whose range meets one of them shows its markers as
 * text; everywhere else the markers are hidden.
 *
 * Pure, and deliberately the whole of the rule — the reveal engine, the click
 * handler and the tests all ask these three functions, so "is this rendered?"
 * has exactly one answer.
 */
import type { EditorSelection, EditorState, Text } from '@codemirror/state'
import { previewMode } from '../read-host.js'

export interface Span {
  from: number
  to: number
}

/**
 * The active lines as document ranges, merged and in order.
 *
 * This is the form the engine uses: it costs one `lineAt` per selection range
 * rather than one per line, so selecting the whole of a 3,000-line note is as
 * cheap as a caret (R7).
 */
export function activeSpans(selection: EditorSelection, doc: Text): Span[] {
  const spans: Span[] = []
  for (const range of selection.ranges) {
    const from = doc.lineAt(range.from).from
    const to = range.to === range.from ? doc.lineAt(range.from).to : doc.lineAt(range.to).to
    const last = spans[spans.length - 1]
    // Ranges arrive sorted, so only the previous span can overlap. Touching
    // spans merge too: line N's end and line N+1's start are one apart.
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to)
    else spans.push({ from, to })
  }
  return spans
}

/** Every line number (1-based) any selection range touches. */
export function activeLines(selection: EditorSelection, doc: Text): Set<number> {
  const lines = new Set<number>()
  for (const span of activeSpans(selection, doc)) {
    const first = doc.lineAt(span.from).number
    const last = doc.lineAt(span.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

/** Does `[from, to]` meet any active line? Touching at an edge counts. */
export function inActiveRegion(spans: readonly Span[], from: number, to: number): boolean {
  for (const span of spans) {
    if (from <= span.to && to >= span.from) return true
  }
  return false
}

/**
 * Is a list marker `[from, to)` (the `-` and the spaces after it) being
 * edited? True when a selection range overlaps it, or a caret sits inside it
 * or immediately BEFORE it; a caret at `to` — anywhere after the marker — is
 * not editing it, so the bullet stays drawn. This is the whole of the list
 * marker's caret-line rule (read-shaping B2.3, amended 2026-10-06): unlike
 * a heading's `#`, a bullet is rendered on the caret's line too.
 */
export function markerSelected(selection: EditorSelection, from: number, to: number): boolean {
  return selection.ranges.some((r) => r.from < to && r.to >= from)
}

/**
 * Is the construct at `[from, to]` drawn as itself rather than as its markup?
 *
 * The click rule rests on this (R2.4): a rendered link navigates, a link whose
 * brackets you can see is text and a click places the caret. Source never
 * renders; Reading always does.
 */
export function isRendered(state: EditorState, from: number, to: number): boolean {
  const mode = state.facet(previewMode)
  if (mode === 'source') return false
  if (mode === 'reading') return true
  return !inActiveRegion(activeSpans(state.selection, state.doc), from, to)
}
