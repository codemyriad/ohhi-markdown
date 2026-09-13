/**
 * `search` text form (build brief A2.3): one header line per hit, then the
 * snippets indented under it with every match bracketed. References and
 * snippets only — never a body (R4); the hint names the next, cheaper call.
 */
import type { OpOutput } from '@ohhi/agent'
import { bracket, counters, coverageNote, kv, oneLine, type Sink } from './format.js'

export function renderSearch(o: OpOutput<'search'>, sink: Sink): void {
  for (const hit of o.hits) {
    sink.out(kv({ tier: hit.tier, path: hit.path, line: hit.line ?? undefined, score: hit.score.toFixed(2) }))
    for (const snippet of hit.snippets) {
      sink.out(`    ${String(snippet.line).padStart(5)}: ${oneLine(bracket(snippet.text, snippet.spans), 200)}`)
    }
    if (hit.explain) {
      for (const row of hit.explain) {
        sink.out(`      why: ${kv({ term: row.term, field: row.field, contribution: row.contribution.toFixed(3) })}`)
      }
    }
  }
  counters(sink, o, { query: JSON.stringify(o.query), mode: o.mode })
  coverageNote(sink, o.coverage)
  const first = o.hits[0]
  if (first) sink.err(`hint=ohhi read --outline ${first.path}   (then --section or --lines; never read a long note whole)`)
  else sink.err('hint=no hits — try fewer terms, `--mode exact`, or `ohhi tags` / `ohhi ls` to see what is there')
}
