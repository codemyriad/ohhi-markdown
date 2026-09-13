/**
 * Line arithmetic over a document's text — the ONE implementation, which is
 * `@editor/frontmatter`'s: it already computes line ranges over the same
 * note, and two searches would eventually disagree about which line an
 * offset is on.
 *
 * Offsets are the index's contract (spans, snippets, `grep`, every caret the
 * app remaps), so turning one into a line number has to give the same answer
 * everywhere it is asked: here, in `memory-index.ts`, and in `@editor/agent`'s
 * `read`/`search` ops, which import these rather than re-scanning the text.
 */

import { lineIndexAt } from '@editor/frontmatter'

export { lineStartsOf } from '@editor/frontmatter'

/** 1-based line for an offset. Binary search — this runs per link, per hit. */
export function lineAt(starts: number[], offset: number): number {
  return lineIndexAt(starts, offset) + 1
}
