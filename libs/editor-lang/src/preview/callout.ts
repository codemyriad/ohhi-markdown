/**
 * Callouts (editor-usability E3): Obsidian's syntax, read as it is written —
 * no new markup. A blockquote whose first line is
 *
 *     > [!type]± Optional title
 *
 * is a callout; the rest of the blockquote's lines are its body. The `-` / `+`
 * right after `]` makes it foldable (`-` starts collapsed, `+` open). Folding
 * is view-only (callout-fold.ts) and never edits the file.
 *
 * Pure: the reveal engine, the widgets and the tests all ask this module, so
 * "is this line a callout header, and of what?" has one answer.
 */

/** The thirteen types Obsidian draws, each with its own colour token. */
export type CalloutType =
  | 'note'
  | 'abstract'
  | 'info'
  | 'todo'
  | 'tip'
  | 'success'
  | 'question'
  | 'warning'
  | 'failure'
  | 'danger'
  | 'bug'
  | 'example'
  | 'quote'

/** The lucide icon each type wears (the names are lucide's, drawn by icons.ts). */
export type CalloutIcon =
  | 'info'
  | 'lightbulb'
  | 'triangle-alert'
  | 'octagon-x'
  | 'circle-check'
  | 'circle-help'
  | 'bug'
  | 'list'
  | 'quote'
  | 'clipboard'

/** Obsidian's aliases, lower-cased; every key resolves to a canonical type. */
const ALIASES: Readonly<Record<string, CalloutType>> = {
  note: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  info: 'info',
  todo: 'todo',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'failure',
  fail: 'failure',
  missing: 'failure',
  danger: 'danger',
  error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
}

export const CALLOUT_ICONS: Readonly<Record<CalloutType, CalloutIcon>> = {
  note: 'info',
  abstract: 'clipboard',
  info: 'info',
  todo: 'circle-check',
  tip: 'lightbulb',
  success: 'circle-check',
  question: 'circle-help',
  warning: 'triangle-alert',
  failure: 'octagon-x',
  danger: 'octagon-x',
  bug: 'bug',
  example: 'list',
  quote: 'quote',
}

export interface CalloutHeader {
  /** The canonical type: what the colour and the icon are chosen by. */
  type: CalloutType
  /** The type as written (`[!FAQ]` → `FAQ`), which the default title is made from. */
  written: string
  /** `-` collapsed, `+` open, null not foldable. */
  fold: '-' | '+' | null
  /** The title as written, or the capitalised type when there is none. */
  title: string
  /** True when the line carries its own title. */
  titled: boolean
}

/**
 * `> [!type]` at the start of a line, after any indent and the quote's own
 * `>` (one level: a callout nested in a quote is a quote line to this module).
 * The type is Obsidian's: letters, digits, `-` and `_`.
 */
const HEADER = /^[ \t]*>[ \t]?\[!([A-Za-z0-9_-]+)\]([-+])?(?:[ \t]+(.*?))?[ \t]*$/

/** Resolve a written type to a canonical one; unknown types render as a note. */
export function calloutType(written: string): CalloutType {
  return ALIASES[written.toLowerCase()] ?? 'note'
}

/** `faq` → `Faq`, `my-type` → `My-type`: Obsidian's default title. */
export function defaultTitle(written: string): string {
  const lower = written.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** Parse a blockquote's FIRST line; null when it does not open a callout. */
export function parseCalloutHeader(line: string): CalloutHeader | null {
  const m = HEADER.exec(line)
  if (!m) return null
  const written = m[1]
  const fold = m[2] === '-' || m[2] === '+' ? m[2] : null
  const own = (m[3] ?? '').trim()
  return {
    type: calloutType(written),
    written,
    fold,
    title: own || defaultTitle(written),
    titled: own !== '',
  }
}

/** Does this line open a callout? */
export function isCalloutHeader(line: string): boolean {
  return HEADER.test(line)
}

/** The markup before a callout's title: the quote marker, `[!type]`, the fold sign and one space. */
const HEADER_MARKUP = /^[ \t]*>[ \t]?\[![A-Za-z0-9_-]+\][-+]?[ \t]?/

/** A callout's header line with its markup taken off — what is left is its title (or nothing). */
export function stripCalloutHeader(line: string): string {
  return isCalloutHeader(line) ? line.replace(HEADER_MARKUP, '') : line
}

/**
 * Is a foldable callout collapsed? The view's own choice wins (the chevron),
 * then the marker: `-` starts collapsed, `+` and no marker start open.
 */
export function calloutCollapsed(header: CalloutHeader, choice: boolean | undefined): boolean {
  if (header.fold === null) return false
  return choice ?? header.fold === '-'
}
