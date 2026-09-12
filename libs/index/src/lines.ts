/**
 * Line arithmetic over a document's text — the ONE implementation.
 *
 * Offsets are the index's contract (spans, snippets, `grep`, every caret the
 * app remaps), so turning one into a line number has to give the same answer
 * everywhere it is asked: here, in `memory-index.ts`, and in `@editor/agent`'s
 * `read`/`search` ops, which import these rather than re-scanning the text.
 */

/** Offsets at which each line begins. Computed once per document. */
export function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

/** 1-based line for an offset. Binary search — this runs per link, per hit. */
export function lineAt(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}
