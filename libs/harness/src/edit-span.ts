/**
 * The changed span between two texts — a common-prefix/suffix trim, nothing
 * cleverer. A tool proposal (`write`/`patch`/`append` under `proposeEdit`)
 * becomes ONE suggestion over the smallest range that differs, so a patch of
 * one word is reviewed as one word, not as the whole note.
 *
 * `@codemirror/merge`'s `diff` lives in `libs/editor` for the in-document
 * presentation; this is the one helper the harness needs and it is
 * deliberately minimal (writing-harness-build A2).
 */
export interface EditSpan {
  /** Character offsets into `before`; `to` is exclusive. */
  from: number
  to: number
  baseText: string
  proposedText: string
}

/** The smallest `[from, to)` of `before` that, replaced, gives `after`; null when equal. */
export function editSpan(before: string, after: string): EditSpan | null {
  if (before === after) return null
  const max = Math.min(before.length, after.length)
  let start = 0
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++
  // Never split a surrogate pair: back off onto its high half.
  if (start > 0 && isLowSurrogate(before.charCodeAt(start))) start--
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--
    endAfter--
  }
  if (endBefore < before.length && isLowSurrogate(before.charCodeAt(endBefore))) {
    endBefore++
    endAfter++
  }
  return {
    from: start,
    to: endBefore,
    baseText: before.slice(start, endBefore),
    proposedText: after.slice(start, endAfter),
  }
}

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff
