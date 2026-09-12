/**
 * Match highlighting, shared by the two surfaces that render the index's hits:
 * the `Mod+O` palette and the empty tab's launcher. One matcher in this app,
 * so one way of drawing what it matched.
 */

export interface Span {
  from: number
  to: number
}

/** Split `text` into alternating plain/highlighted segments. */
export function segments(text: string, spans: Span[] = []): { text: string; hit: boolean }[] {
  if (spans.length === 0) return [{ text, hit: false }]
  const out: { text: string; hit: boolean }[] = []
  let at = 0
  for (const span of spans) {
    const from = Math.max(0, Math.min(span.from, text.length))
    const to = Math.max(from, Math.min(span.to, text.length))
    if (from > at) out.push({ text: text.slice(at, from), hit: false })
    if (to > from) out.push({ text: text.slice(from, to), hit: true })
    at = to
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out
}

/**
 * The spans landing inside `[from, to)`, rebased onto that slice: a row that
 * prints a path as basename + folder needs each half to mark its own share.
 */
export function within(spans: Span[] = [], from: number, to: number): Span[] {
  const out: Span[] = []
  for (const span of spans) {
    const a = Math.max(span.from, from)
    const b = Math.min(span.to, to)
    if (b > a) out.push({ from: a - from, to: b - from })
  }
  return out
}
