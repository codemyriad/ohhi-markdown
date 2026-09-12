import type { GrepHit, Page, SearchHit as IndexHit, VaultIndex } from '@editor/index'
import type { z } from 'zod'
import { OP_SCHEMAS, OpError, schemaName, type Span, type SearchHit } from '../contract.js'
import type { OpDef } from '../op.js'
import { fromIndexPage } from '../paging.js'
import { isUnder, normalizeDir } from '../paths.js'
import { lineAt, lineStartsOf } from '../text.js'

type Hit = z.infer<typeof SearchHit>
type Match = z.infer<typeof Span>

/** Ten is what fits in an answer. The contract caps it at 100. */
const DEFAULT_LIMIT = 10
/** The radius `libs/index` keeps around a ranked snippet; grep keeps the same. */
const SNIPPET_RADIUS = 60

/**
 * `search` — REFERENCES and snippets, never bodies (contract rule 2).
 *
 * `ranked` is the index's tiered BM25F: folded, case-insensitive, URL text and
 * fenced code excluded from the body terms. `exact`/`regex` are `index.grep`
 * over the raw text, unranked, in document order — the escape hatch from that
 * exclusion, and the only way to ask a case-sensitive question.
 *
 * `path:`/`tag:` are folded into the query string in ranked mode because the
 * index parses them there; in grep mode `path` is `pathPrefix` and `tag` has
 * no meaning (there is no tag graph over raw text), which is a `usage` error
 * rather than a silently ignored flag.
 */
export const search: OpDef<'search'> = {
  ...OP_SCHEMAS.search,
  async run(backend, input) {
    const mode = input.mode ?? 'ranked'
    const limit = input.limit ?? DEFAULT_LIMIT
    const prefix = normalizeDir(input.path)
    const head = { schema: schemaName('search'), query: input.query, mode }
    const [coverage, index] = await Promise.all([backend.coverage(), backend.index()])

    if (mode !== 'ranked') {
      if (input.tag) {
        throw new OpError('usage', `tag filtering is only available in ranked mode (drop --mode ${mode})`)
      }
      const found = await grep(index, input.query, {
        limit,
        cursor: input.cursor,
        regex: mode === 'regex',
        caseSensitive: input.caseSensitive ?? false,
        ...(prefix ? { pathPrefix: prefix } : {}),
      })
      const page = fromIndexPage(found, (hit): Hit => {
        const snippet = clip(hit.lineText, hit.spans)
        return { path: hit.path, tier: 'grep', score: 0, line: hit.line, snippets: [{ line: hit.line, ...snippet }] }
      })
      return { ...head, hits: page.items, returned: page.returned, total: page.total, nextCursor: page.nextCursor, coverage }
    }

    if (input.caseSensitive) {
      throw new OpError(
        'usage',
        'ranked search is always case-insensitive and folded — use --mode exact for a case-sensitive match'
      )
    }
    const docs = await backend.docs()
    const query = [
      input.query,
      ...(prefix ? [`path:${prefix}`] : []),
      ...(input.tag ? [`tag:${input.tag.replace(/^#/, '')}`] : []),
    ].join(' ')
    const found = await index.search(query, { limit, cursor: input.cursor, explain: input.explain })
    // The index parses `path:` out of a WHITESPACE-SEPARATED query, so a folder
    // with a space in its name (`Edible/Dev Notes/`) reaches it truncated.
    // Filtering the page again makes the answer correct rather than merely
    // cheap; `total` becomes null because the index counted the wider prefix,
    // and a number that is not the count is worse than no number.
    const spacey = /\s/.test(prefix)
    if (spacey) found.items = found.items.filter((hit) => isUnder(prefix, hit.path))

    const starts = new Map<string, number[]>()
    const linesOfDoc = (path: string): number[] => {
      const cached = starts.get(path)
      if (cached) return cached
      const computed = lineStartsOf(docs.get(path)?.text ?? '')
      starts.set(path, computed)
      return computed
    }
    const page = fromIndexPage(found, (hit: IndexHit): Hit => {
      const lines = linesOfDoc(hit.path)
      return {
        path: hit.path,
        tier: hit.tier,
        score: hit.score,
        line: hit.spans.length ? lineAt(lines, hit.spans[0].from) : null,
        snippets: hit.snippets.map((s) => ({ line: lineAt(lines, s.offset), text: s.text, spans: s.spans })),
        ...(hit.explain ? { explain: hit.explain } : {}),
      }
    })
    return {
      ...head,
      hits: page.items,
      returned: page.returned,
      total: spacey ? null : page.total,
      nextCursor: page.nextCursor,
      coverage,
    }
  },
}

/** `index.grep` throws a `SyntaxError` for a bad pattern; the surface says `usage`. */
async function grep(
  index: VaultIndex,
  pattern: string,
  opts: Parameters<VaultIndex['grep']>[1]
): Promise<Page<GrepHit>> {
  try {
    return await index.grep(pattern, opts)
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new OpError('usage', `not a valid regular expression: ${err.message}`)
    }
    throw err
  }
}

/**
 * Keep a match in its line without shipping a 3 KB pasted paragraph as
 * context. `grep` returns the whole line by contract; the budget is this
 * surface's problem (R4), not the index's.
 */
function clip(line: string, spans: Match[]): { text: string; spans: Match[] } {
  if (spans.length === 0) return { text: line.slice(0, SNIPPET_RADIUS * 2), spans: [] }
  const from = Math.max(0, spans[0].from - SNIPPET_RADIUS)
  const to = Math.min(line.length, spans[spans.length - 1].to + SNIPPET_RADIUS)
  return {
    text: line.slice(from, to),
    spans: spans.filter((s) => s.from >= from && s.to <= to).map((s) => ({ from: s.from - from, to: s.to - from })),
  }
}
