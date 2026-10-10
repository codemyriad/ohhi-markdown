/**
 * Fork D1 — a provisional bullet on a lone `-` setext underline.
 *
 * Type a paragraph, Enter, then `-`: CommonMark reads the `-` (and `- `,
 * trailing spaces allowed) as a setext underline, so for the keystroke or two
 * before the item's text arrives the line above flashes up as a level-2
 * heading — big, coloured, then gone again. The parser is right and stays
 * unchanged; what changes is what Live shows WHILE the caret is on that
 * underline: the paragraph keeps its body style, and the `-` is drawn as a
 * faint bullet where the real one will sit. Anywhere else — the caret moved
 * off, or the underline is `--` / `---` — it is the heading it parses as.
 *
 * Pure: the decision is a function of the underline's text and of whether the
 * caret is on it, so it is testable without a tree.
 */

/**
 * Is this setext underline a bullet being typed? `mark` is the HeaderMark's
 * own text (the dashes), `rest` the line after it, `caretOnLine` whether the
 * main selection's head is on the underline's line.
 */
export function provisionalBullet(mark: string, rest: string, caretOnLine: boolean): boolean {
  return caretOnLine && mark === '-' && /^[ \t]*$/.test(rest)
}

/** The line class that keeps a provisional heading's lines body-styled. */
export const SETEXT_PROVISIONAL = 'cm-setext-provisional'
