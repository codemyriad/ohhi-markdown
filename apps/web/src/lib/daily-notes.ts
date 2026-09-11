/**
 * Daily notes over Obsidian's own configuration (v2-shaping B5, slice W3).
 *
 * The vault is the source of truth here too: `.obsidian/daily-notes.json` is
 * read, never written, and its `format` is a moment.js pattern — Chris's is
 * `DD-M-Y` in `Daily/`, so today is `Daily/10-9-2026.md`. Editor formats the
 * same way Obsidian does, so the two agree on which file "today" is.
 *
 * It also PARSES that pattern back, which Obsidian never needs to: prev/next
 * walk the dailies that already exist, in date order, and a folder listing is
 * all there is to order them by.
 *
 * Pure and DOM-free (v2 R6). "Today" arrives as an injected clock (golden
 * rule 5) — a date the module reads off `Date.now()` itself is a date no test
 * can pin.
 */

export interface DailyConfig {
  /** moment.js date pattern, e.g. `DD-M-Y` or `YYYY-MM-DD`. */
  format: string
  /** Vault-relative folder, '' = vault root. */
  folder: string
}

/** Obsidian's own defaults when the plugin has never been configured. */
export const DAILY_DEFAULTS: DailyConfig = { format: 'YYYY-MM-DD', folder: '' }

export const DAILY_CONFIG_PATH = '.obsidian/daily-notes.json'

/**
 * moment's English month/weekday names, fixed rather than localised.
 *
 * These land in FILENAMES on disk, which Obsidian wrote with moment's default
 * (English) locale. Translating them would rename a person's daily notes on a
 * locale switch — the dictionary's own "persisted identifiers are data" rule.
 */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type Token =
  | { kind: 'literal'; text: string }
  | { kind: 'token'; name: string }

/**
 * Split a moment pattern into tokens: a run of the SAME letter is one token
 * (moment's own rule, so `YYYY` is one and `MMDD` is two), `[...]` is literal
 * text, anything else is a separator.
 */
function lex(format: string): Token[] {
  const out: Token[] = []
  let i = 0
  let literal = ''
  const flush = (): void => {
    if (literal) out.push({ kind: 'literal', text: literal })
    literal = ''
  }
  while (i < format.length) {
    const ch = format[i]!
    if (ch === '[') {
      const end = format.indexOf(']', i + 1)
      if (end === -1) {
        literal += format.slice(i + 1)
        i = format.length
      } else {
        literal += format.slice(i + 1, end)
        i = end + 1
      }
      continue
    }
    if (/[A-Za-z]/.test(ch)) {
      let run = ch
      while (format[i + run.length] === ch) run += ch
      i += run.length
      if (FORMATTERS[run]) {
        flush()
        out.push({ kind: 'token', name: run })
      } else {
        literal += run // an unsupported run prints itself, as moment does
      }
      continue
    }
    literal += ch
    i++
  }
  flush()
  return out
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** The tokens we support. Anything not here is treated as literal text. */
const FORMATTERS: Record<string, (d: Date) => string> = {
  YYYY: (d) => pad(d.getFullYear(), 4),
  YY: (d) => pad(d.getFullYear() % 100),
  // moment's `Y`: the year with no padding at all — Chris's `DD-M-Y`.
  Y: (d) => String(d.getFullYear()),
  MMMM: (d) => MONTHS[d.getMonth()]!,
  MMM: (d) => MONTHS[d.getMonth()]!.slice(0, 3),
  MM: (d) => pad(d.getMonth() + 1),
  M: (d) => String(d.getMonth() + 1),
  DD: (d) => pad(d.getDate()),
  D: (d) => String(d.getDate()),
  dddd: (d) => DAYS[d.getDay()]!,
  ddd: (d) => DAYS[d.getDay()]!.slice(0, 3),
}

export function formatDate(format: string, date: Date): string {
  return lex(format)
    .map((t) => (t.kind === 'literal' ? t.text : FORMATTERS[t.name]!(date)))
    .join('')
}

/**
 * The letter runs in `format` that moment would expand and this module prints
 * LITERALLY (`Do`, `gggg`, `ww`, `Q`, …), deduplicated and in order.
 *
 * `lex` folds an unsupported run into literal text, which is the right
 * behaviour — a filename is never mangled — but silent: a vault on `gggg-[W]ww`
 * would disagree with Obsidian about which file today is, and the only symptom
 * would be a second note appearing beside the right one. So the disagreement
 * is REPORTED (Minor 17), once, by the caller that loads the config.
 */
export function unsupportedTokens(format: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < format.length) {
    const ch = format[i]!
    if (ch === '[') {
      const end = format.indexOf(']', i + 1)
      i = end === -1 ? format.length : end + 1
      continue
    }
    if (/[A-Za-z]/.test(ch)) {
      let run = ch
      while (format[i + run.length] === ch) run += ch
      i += run.length
      if (!FORMATTERS[run] && !out.includes(run)) out.push(run)
      continue
    }
    i++
  }
  return out
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** What each token contributes to the parse: a pattern and where it lands. */
type Field = 'year' | 'year2' | 'month' | 'monthName' | 'day' | 'ignore'

/**
 * Numeric tokens parse 1-OR-2 digits regardless of their padding.
 *
 * Deliberately tolerant, and the vault is the reason: Chris's format is
 * `DD-M-Y`, but `Daily/` also holds `03-01-2025.md` — a note whose month is
 * zero-padded, from before the format was what it is. A strict `M` would
 * refuse it, and prev/next would silently step over notes that are plainly
 * dailies.
 */
const PARSERS: Record<string, { re: string; field: Field }> = {
  YYYY: { re: '(\\d{4})', field: 'year' },
  YY: { re: '(\\d{2})', field: 'year2' },
  Y: { re: '(\\d{1,6})', field: 'year' },
  MMMM: { re: `(${MONTHS.join('|')})`, field: 'monthName' },
  MMM: { re: `(${MONTHS.map((m) => m.slice(0, 3)).join('|')})`, field: 'monthName' },
  MM: { re: '(\\d{1,2})', field: 'month' },
  M: { re: '(\\d{1,2})', field: 'month' },
  DD: { re: '(\\d{1,2})', field: 'day' },
  D: { re: '(\\d{1,2})', field: 'day' },
  // The weekday is implied by the date; it is matched so the pattern lines up
  // and then thrown away.
  dddd: { re: `(${DAYS.join('|')})`, field: 'ignore' },
  ddd: { re: `(${DAYS.map((d) => d.slice(0, 3)).join('|')})`, field: 'ignore' },
}

/**
 * Read a date back out of a daily note's basename (no `.md`). Returns null
 * for anything that is not this format, or that is this format but not a real
 * date (`32-13-2026`).
 */
export function parseDate(format: string, basename: string): Date | null {
  const fields: Field[] = []
  let pattern = '^'
  for (const t of lex(format)) {
    if (t.kind === 'literal') {
      pattern += escapeRe(t.text)
      continue
    }
    const p = PARSERS[t.name]!
    pattern += p.re
    fields.push(p.field)
  }
  pattern += '$'
  const m = new RegExp(pattern, 'i').exec(basename)
  if (!m) return null

  let year: number | null = null
  let month = 1
  let day = 1
  for (const [i, field] of fields.entries()) {
    const raw = m[i + 1]!
    if (field === 'year') year = Number(raw)
    // moment's two-digit pivot: 00-68 is this century, 69-99 the last.
    else if (field === 'year2') year = Number(raw) < 69 ? 2000 + Number(raw) : 1900 + Number(raw)
    else if (field === 'month') month = Number(raw)
    else if (field === 'monthName') {
      month = MONTHS.findIndex((name) => name.toLowerCase().startsWith(raw.toLowerCase())) + 1
    } else if (field === 'day') day = Number(raw)
  }
  if (year === null) return null
  const date = new Date(year, month - 1, day)
  // Rolled over (day 32, month 13) → it was never this date.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

/** Local midnight of the day containing `now` — the clock is the caller's. */
export function today(now: () => number): Date {
  const d = new Date(now())
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function normalizeFolder(folder: string): string {
  return folder.replace(/^\/+|\/+$/g, '')
}

/** Vault-relative path of the daily note for `date`. */
export function dailyPath(cfg: DailyConfig, date: Date): string {
  const name = `${formatDate(cfg.format, date)}.md`
  const folder = normalizeFolder(cfg.folder)
  return folder ? `${folder}/${name}` : name
}

/** The date a vault path stands for, or null when it is not a daily note. */
export function dateOfPath(cfg: DailyConfig, path: string | null): Date | null {
  if (!path || !path.endsWith('.md')) return null
  const folder = normalizeFolder(cfg.folder)
  const rel = folder ? (path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : null) : path
  // Dailies are direct children of the folder; a note in a subfolder that
  // happens to be named like a date is not one.
  if (rel === null || rel.includes('/')) return null
  return parseDate(cfg.format, rel.slice(0, -'.md'.length))
}

/**
 * The note that already IS the daily for `date`, or null.
 *
 * Matched on the parsed DATE, never on the formatted string (Minor 16): the
 * parser is deliberately padding-tolerant, so Chris's `Daily/03-01-2025.md`
 * is the daily for 3 January 2025 even though `DD-M-Y` writes it
 * `03-1-2025`. Comparing strings, as the shell used to, meant `Mod+\` would
 * CREATE a second note for a day that already had one.
 */
export function findDaily(cfg: DailyConfig, files: readonly string[], date: Date): string | null {
  const want = date.getTime()
  let found: string | null = null
  for (const path of files) {
    if (dateOfPath(cfg, path)?.getTime() !== want) continue
    // Two notes for one day is a real (legacy) state: pick by path so the
    // answer does not depend on the order the tree happened to list them in.
    if (found === null || path < found) found = path
  }
  return found
}

/**
 * The dailies immediately before and after `from` among the notes that
 * actually exist. Both null when there is nothing to step to — which is what
 * greys the commands out rather than opening a note that isn't there.
 *
 * Ties are broken by PATH, not by listing order (Minor 16): a vault with two
 * notes for one day (`03-01-2025.md` beside `3-1-2025.md`) otherwise answered
 * differently depending on how the tree happened to be sorted. The walk is
 * strictly by date, so the sibling of a duplicated day is reachable through
 * the tree, quick-open and `findDaily`, but not by stepping — which is the
 * honest behaviour for a walk whose only ordering key is the date.
 */
export function neighbours(
  cfg: DailyConfig,
  files: readonly string[],
  from: Date
): { prev: string | null; next: string | null } {
  const at = from.getTime()
  let prev: { at: number; path: string } | null = null
  let next: { at: number; path: string } | null = null
  const better = (a: { at: number; path: string } | null, t: number, path: string, side: 'prev' | 'next'): boolean => {
    if (!a) return true
    if (t !== a.at) return side === 'prev' ? t > a.at : t < a.at
    return path < a.path
  }
  for (const path of files) {
    const date = dateOfPath(cfg, path)
    if (!date) continue
    const t = date.getTime()
    if (t < at && better(prev, t, path, 'prev')) prev = { at: t, path }
    else if (t > at && better(next, t, path, 'next')) next = { at: t, path }
  }
  return { prev: prev?.path ?? null, next: next?.path ?? null }
}

/**
 * Obsidian's `.obsidian/daily-notes.json`, with its defaults when the file is
 * absent, empty or malformed — a vault that has never opened the plugin is
 * the normal case, not an error worth a notice.
 */
export async function loadDailyConfig(
  readAppFile: (path: string) => Promise<string | null>
): Promise<DailyConfig> {
  let raw: string | null = null
  try {
    raw = await readAppFile(DAILY_CONFIG_PATH)
  } catch {
    return DAILY_DEFAULTS
  }
  if (!raw) return DAILY_DEFAULTS
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DAILY_DEFAULTS
    const { format, folder } = parsed as { format?: unknown; folder?: unknown }
    return {
      format: typeof format === 'string' && format.trim() ? format : DAILY_DEFAULTS.format,
      folder: typeof folder === 'string' ? normalizeFolder(folder) : DAILY_DEFAULTS.folder,
    }
  } catch {
    return DAILY_DEFAULTS
  }
}
