/**
 * Code fences, as text (editor-usability E3): which line opens a fence, what
 * closes it, and the language names an info string can complete to.
 *
 * Pure — no state, no view — so the two editing helpers built on it (Enter's
 * auto-close and the language completion, fence-edit.ts) are tested here in
 * full and stay thin. CommonMark's rule, kept to what the vault writes: a run
 * of three or more backticks or tildes opens a fence; a run of the same
 * character, at least as long, with nothing after it, closes it.
 */

export interface FenceMark {
  /** The whitespace before the run (a fence inside a list item is indented). */
  indent: string
  /** The run itself: ``` or ~~~, or longer. */
  fence: string
  /** The info string after the run, trimmed (its first word is the language). */
  info: string
}

const OPEN = /^([ \t]*)(`{3,}|~{3,})(.*)$/

/** Read a line as an opening fence, or null. A backtick info string may not hold a backtick. */
export function fenceOpen(line: string): FenceMark | null {
  const m = OPEN.exec(line)
  if (!m) return null
  const [, indent, fence, rest] = m
  if (fence[0] === '`' && rest.includes('`')) return null
  return { indent, fence, info: rest.trim() }
}

/** Does `line` close a fence opened by `open`? */
export function closesFence(line: string, open: FenceMark): boolean {
  const m = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line)
  return m !== null && m[1][0] === open.fence[0] && m[1].length >= open.fence.length
}

/**
 * The document's lines, by 0-based index — an array satisfies it, and so does
 * a two-line adapter over CM6's `Text`, so no caller has to split a note.
 */
export interface LineSource {
  readonly length: number
  at(index: number): string | undefined
}

/**
 * Does line `index` OPEN a fence? It must read as one and must not sit inside
 * an earlier block: inside one, a ```lang line is content (or a closer).
 */
export function opensFenceAt(lines: LineSource, index: number): FenceMark | null {
  const here = lines.at(index)
  const open = here === undefined ? null : fenceOpen(here)
  if (!open) return null
  let inside: FenceMark | null = null
  for (let i = 0; i < index; i++) {
    const line = lines.at(i) ?? ''
    if (inside) {
      if (closesFence(line, inside)) inside = null
    } else {
      inside = fenceOpen(line)
    }
  }
  return inside ? null : open
}

/** The index of the line that closes the fence opened at `index`, or -1 (unclosed). */
export function closingLineOf(lines: LineSource, index: number, open: FenceMark): number {
  for (let i = index + 1; i < lines.length; i++) {
    if (closesFence(lines.at(i) ?? '', open)) return i
  }
  return -1
}

/**
 * What Enter at the end of line `index` should add after it, or null to do
 * nothing special: the closing run, when the line OPENS a fence and no line
 * below closes it. The caller inserts `\n<indent>` + `\n<indent><fence>` and
 * leaves the caret on the empty line.
 */
export function autoCloseFence(
  lines: LineSource,
  index: number
): { indent: string; fence: string } | null {
  const open = opensFenceAt(lines, index)
  if (!open || closingLineOf(lines, index, open) !== -1) return null
  return { indent: open.indent, fence: open.fence }
}

/** One language `@codemirror/language-data` describes — the two fields completion reads. */
export interface FenceLanguage {
  name: string
  alias: readonly string[]
}

export interface RankedLanguage {
  /** What goes in the info string: the matched name or alias, lower case. */
  label: string
  /** The language's display name. */
  name: string
}

/**
 * Language names for a typed prefix, best first: an exact name or alias, then
 * prefixes, shorter first (`j` → `js` before `java` before `javascript`), then
 * alphabetical. One row per language, under the token that matched best. An
 * empty query lists every language once, alphabetically. Tokens with a space
 * in them cannot be an info string's first word and are never offered.
 */
export function rankLanguages(
  languages: readonly FenceLanguage[],
  query: string,
  limit = 50
): RankedLanguage[] {
  const q = query.toLowerCase()
  const ranked: { label: string; name: string; rank: number }[] = []
  for (const lang of languages) {
    const tokens = [lang.name.toLowerCase(), ...lang.alias.map((a) => a.toLowerCase())].filter(
      (t) => t !== '' && !/\s/.test(t)
    )
    let best: { label: string; rank: number } | null = null
    for (const token of tokens) {
      if (!token.startsWith(q)) continue
      const rank = token === q ? 0 : 1
      if (!best || rank < best.rank || (rank === best.rank && token.length < best.label.length)) {
        best = { label: token, rank }
      }
      // An empty query keeps the first spelling: the name, if it can be one.
      if (q === '') break
    }
    if (best) ranked.push({ ...best, name: lang.name })
  }
  ranked.sort((a, b) => {
    if (q === '') return a.label.localeCompare(b.label)
    return a.rank - b.rank || a.label.length - b.label.length || a.label.localeCompare(b.label)
  })
  return ranked.slice(0, limit).map(({ label, name }) => ({ label, name }))
}

/**
 * A block's content, as a reader copies it: the lines between the fences,
 * with the opening fence's indent taken off every line that carries it (a
 * fence in a list item is indented as a whole; the code is not).
 */
export function fenceContent(body: readonly string[], indent: string): string {
  if (indent === '') return body.join('\n')
  return body.map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n')
}
