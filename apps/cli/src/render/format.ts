/**
 * Shared text-rendering helpers. ONE place decides what a counter line, a
 * bracketed match or a coverage warning looks like, so the 17 renderers stay
 * a few lines each.
 *
 * Split of streams (Cassini's rule, shaping A9): stdout is the ANSWER,
 * stderr is provenance — counters, coverage, truncation, hints. A human sees
 * both in a terminal; a pipe gets only the answer.
 */
import type { Sink } from '../io.js'

export type { Sink }

export interface PageCounters {
  returned: number
  total: number | null
  nextCursor: string | null
}

export interface CoverageShape {
  docs: number
  skippedBinary: number
  ignored: string[]
}

/** `[from,to)` spans into `text`, rendered as `[match]`. Spans must be ascending. */
export function bracket(text: string, spans: { from: number; to: number }[]): string {
  if (spans.length === 0) return text
  let out = ''
  let at = 0
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    const from = Math.max(at, Math.min(s.from, text.length))
    const to = Math.max(from, Math.min(s.to, text.length))
    out += text.slice(at, from) + '[' + text.slice(from, to) + ']'
    at = to
  }
  return out + text.slice(at)
}

/** One line of context, collapsed and clipped so a 4 KB list line never happens. */
export function oneLine(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

export function kv(pairs: Record<string, unknown>): string {
  return Object.entries(pairs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
}

/** The counters every list carries (R4/R7), on stderr. */
export function counters(sink: Sink, page: PageCounters, extra: Record<string, unknown> = {}): void {
  sink.err(kv({ returned: page.returned, total: page.total ?? 'unknown', ...extra }))
  if (page.nextCursor) sink.err(`more results — pass --cursor ${page.nextCursor}`)
}

/**
 * Coverage as a WARNING, not a statistic: "nothing found" must never be
 * mistaken for "nothing exists" (R7).
 */
export function coverageNote(sink: Sink, coverage: CoverageShape): void {
  const bits = [`searched ${coverage.docs} notes`]
  if (coverage.skippedBinary > 0) bits.push(`${coverage.skippedBinary} binaries skipped`)
  if (coverage.ignored.length > 0) bits.push(`ignored ${coverage.ignored.join(', ')}`)
  sink.err(`coverage: ${bits.join('; ')}`)
}

export function bytes(n: number | undefined): string {
  if (n === undefined) return ''
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`
  return `${(n / (1024 * 1024)).toFixed(1)}M`
}

export function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

export function padStart(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s
}

/** Widest value of `of` across `rows`, capped so one silly path cannot shove every column. */
export function columnWidth<T>(rows: readonly T[], of: (row: T) => string, cap = 48): number {
  return Math.min(cap, rows.reduce((w, r) => Math.max(w, of(r).length), 0))
}
