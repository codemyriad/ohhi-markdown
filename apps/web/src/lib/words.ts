/**
 * The one word count (quiet-shell F6, spike S21 Q3): the `words` readout
 * (drawn by the toolbar and by every per-pane status bar) and `reading-time`
 * both count through this, so two surfaces can never disagree about a note.
 *
 * A word is a run of letters, digits, apostrophes and hyphens — the rule the
 * status bar has used since U2, kept so no count moves.
 */
const WORD = /[\p{L}\p{N}'’-]+/gu

export function countWords(text: string): number {
  return (text.match(WORD) ?? []).length
}

/** Words per minute for `reading-time`: the common silent-reading figure for prose. */
export const READING_WPM = 200

/** Whole minutes to read `words`, rounded up; 0 only for an empty note. */
export function readingMinutes(words: number, wpm = READING_WPM): number {
  return words <= 0 ? 0 : Math.max(1, Math.ceil(words / wpm))
}

/**
 * The one character count (round 3, Q4): the `chars` readout's, beside the
 * word count so the corner's two numbers are counted over the same text.
 * Code points, line breaks excluded — what a person means by "characters"
 * (an emoji is one, a newline is none).
 */
export function countChars(text: string): number {
  let n = 0
  for (const ch of text) if (ch !== '\n' && ch !== '\r') n++
  return n
}
