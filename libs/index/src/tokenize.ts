/**
 * Tokenization for the vault index.
 *
 * Two paths, and the split is measured, not aesthetic. On the real vault
 * (1,029 notes / 3.0 MB) tokenizing with Intl.Segmenter alone costs 380 ms
 * while a Unicode regex costs 37 ms — a 10x difference that showed up as a
 * 675 ms cold index build, uncomfortably close to Fork 1's own 750 ms
 * "switch to SQLite" trigger. So:
 *
 *   - The regex carries the common case. `\p{L}\p{N}\p{M}` already handles
 *     Portuguese (and every other alphabetic script) correctly, and folding
 *     makes `não` and `nao` one term.
 *   - Intl.Segmenter is used ONLY on runs that contain ideographs, where a
 *     regex genuinely cannot help: it is what turns 中文分词 into words.
 *     FTS5's unicode61 — the shaped alternative — cannot do this at all.
 *
 * CJK runs also emit each character as its own term, so a reader searching
 * for a single character still finds the note regardless of how the
 * runtime's ICU version chose to segment.
 */

const SEGMENTER: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('und', { granularity: 'word' })
    : null

/** Han, Hiragana, Katakana, Hangul — scripts with no spaces between words. */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/
const WORD = /[\p{L}\p{N}\p{M}]+/gu
const ASCII_WORD = /^[A-Za-z0-9]+$/

/**
 * NFD-fold, strip combining marks, lowercase, so `não` and `nao` are one
 * term. Deliberately lossy for search; never applied to stored text.
 *
 * The ASCII fast path matters: NFD-normalising every token costs ~77 ms over
 * this vault and changes nothing for the ~95% of tokens that are plain ASCII.
 */
export function fold(term: string): string {
  if (ASCII_WORD.test(term)) return term.toLowerCase()
  return term.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
}

export interface Token {
  term: string
  /** Offset in the ORIGINAL text — folding never shifts positions. */
  offset: number
  length: number
}

export function tokenize(text: string): Token[] {
  const out: Token[] = []
  WORD.lastIndex = 0
  for (let m = WORD.exec(text); m; m = WORD.exec(text)) {
    const run = m[0]
    if (run.length > 1 && CJK.test(run)) {
      pushCjk(out, run, m.index)
      continue
    }
    const term = fold(run)
    if (term) out.push({ term, offset: m.index, length: run.length })
  }
  return out
}

/**
 * A run of ideographs: word-level terms from Intl.Segmenter when available,
 * plus every individual character. Both, because ICU versions disagree about
 * where the word boundaries are and a single-character query must still work.
 */
function pushCjk(out: Token[], run: string, base: number): void {
  if (SEGMENTER) {
    for (const seg of SEGMENTER.segment(run)) {
      if (!seg.isWordLike) continue
      const term = fold(seg.segment)
      if (term) out.push({ term, offset: base + seg.index, length: seg.segment.length })
    }
  }
  for (let i = 0; i < run.length; i++) {
    const ch = fold(run[i])
    if (ch && ch !== run) out.push({ term: ch, offset: base + i, length: 1 })
  }
}

/** Distinct folded terms of a query, in order, empties dropped. */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const { term } of tokenize(query)) {
    if (seen.has(term)) continue
    seen.add(term)
    out.push(term)
  }
  return out
}
