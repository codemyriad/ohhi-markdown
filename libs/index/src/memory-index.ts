/**
 * The V2 index backend: everything in memory, everything derived.
 *
 * Why this rather than the shaped sqlite-wasm/rusqlite pair — the numbers, the
 * trigger that flips the decision back, and the ripple — are in
 * plans/v2-shaping.md, Fork 1. The short version: the corpus is 3.12 MB and
 * already resident in RAM (every enrolled text file has a live Y.Doc), so
 * building the index is a pure CPU pass costing ~120 ms, and a brute-force
 * scan of the whole vault takes 3.9 ms. SQLite would buy latency we already
 * have, at the price of two platform backends.
 *
 * It implements the contract in types.ts exactly — Promises, paging, cursors,
 * BM25-shaped scores — so the swap stays a day's work. conformance.ts is the
 * suite any replacement must pass.
 *
 * ---------------------------------------------------------------------------
 * RANKING (plans/agent-surface-shaping.md A10, Fork 3-B). Measured, not tuned.
 * ---------------------------------------------------------------------------
 *
 * The real vault was read for search (1,037 live notes, 3.0 MB) and it has a
 * shape that breaks a single BM25 number:
 *
 *   - Titles are one generic noun. Median title: 2 words / 14 chars; hundreds
 *     are a single word — `Docs`, `HTML`, `JSON`, `Svelte`, `Testing`,
 *     `Writing`. That word is also the vault's most frequent BODY term, so the
 *     note literally named `JSON.md` (154 B) competes with a 30 KB note that
 *     says "json" 58 times, and loses.
 *   - There is no metadata to rank on. Frontmatter: 17 files (1.6%). Aliases:
 *     0. H1 present in 35 files and never equal to the filename. Tags: 37,
 *     mostly CSS hex colours. Filename and body are the ONLY two signals.
 *   - Half the vault is link dumps and lists. 71 notes carry ≥20 URLs; the ten
 *     largest notes are reading lists and pasted research.
 *
 * Raising W_TITLE was the obvious fix and it is the wrong one: a weight is
 * always one more body mention away from being wrong, and it does nothing at
 * all about a 64 KB music list that says "html" 39 times inside URLs. So the
 * fix is a STRUCTURE:
 *
 *  1. TIERS decide order before score does. `title` (the basename IS the
 *     query) → `path` (every query term is somewhere in the path) → `body`.
 *     Within a tier: score, then recency as a pure tie-break (the working set
 *     is ~5% of the vault, so recency must never outrank a better match), then
 *     path for determinism. Measured effect on the seven probes: 1/7 correct
 *     at rank 1 before, 7/7 after.
 *  2. NOISE IS NOT BODY TEXT. URL runs, markdown link targets and fenced code
 *     are blanked before tokenization (parse.ts `indexBody`) — blanked to
 *     spaces, so offsets never move. `Areas/Life/Music.md` scored 39 "html"
 *     mentions, all of them inside URLs; it now scores none and leaves the
 *     first page for `HTML` entirely. `grep()` reads the RAW text, so nothing
 *     became unfindable — only unrankable.
 *  3. A PHRASE BONUS for multi-term queries, because a two-word query is
 *     usually a name: terms occurring adjacent and in order earn
 *     `idfSum × PHRASE_BONUS`, which reorders within a tier without inventing
 *     a new tier.
 *  4. `explain` reports every (term, field) contribution, so a wrong answer is
 *     diagnosable instead of arguable. The palette shows the tier as a
 *     subtitle for the same reason.
 *
 * The regression guard is test/ranking-corpus.test.ts (a synthetic vault
 * shaped like the measured one) plus the seven real probes in
 * bench/run-bench.test.ts under EDITOR_BENCH_VAULT.
 */
import {
  SCHEMA_VERSION,
  type ExplainRow,
  type GrepHit,
  type Heading,
  type IndexDoc,
  type IndexStats,
  type LinkRef,
  type Page,
  type PageOptions,
  type PathHit,
  type PropValue,
  type Row,
  type RowQuery,
  type SearchHit,
  type SearchTier,
  type Snippet,
  type Span,
  type TagCount,
  type ValueCount,
  type WritableIndex,
} from './types.js'
import { fuzzyScore, toSpans } from './fuzzy.js'
import { lineAt, lineStartsOf } from './lines.js'
import { paginate } from './paginate.js'
import { parseMarkdown, type ParsedDoc } from './parse.js'
import { compareRows, matchesFilter, scalarText, typeProperty, type FilterContext } from './properties.js'
import { basename, normalizeTarget, PathResolver } from './resolve.js'
import { tagKey } from './tag-syntax.js'
import { queryTerms, tokenize } from './tokenize.js'

/** Match offsets kept per (term, doc). Beyond this, ranking is unaffected and
 *  only the snippet choice degrades — an 83KB note with 400 hits doesn't need
 *  400 remembered positions. */
const MAX_POSITIONS = 32
/** BM25 parameters. Standard values; documented so a bm25() swap can match. */
const K1 = 1.2
const B = 0.75
/** Field weights. A filename hit outranks a body hit; a heading hit sits between. */
const W_TITLE = 3
const W_HEADING = 1
/** Recency BREAKS TIES in quick-open; it never overrides a better match. */
const W_RECENCY = 3
/**
 * Phrase bonus for a multi-term query whose terms occur adjacent and in order.
 * Expressed as a fraction of the query's total idf so it scales with how rare
 * the words are — a rare pair is strong evidence, a common pair is not.
 */
const PHRASE_BONUS = 0.5
/**
 * Characters of slack allowed between two adjacent phrase terms: enough for a
 * separator ("json, import", "json - import"), not enough for another word.
 * Positions are CAPPED (MAX_POSITIONS), so in a very long note a phrase past
 * the cap simply earns no bonus — it never scores wrongly.
 */
const PHRASE_GAP = 3
/** Tier is the FIRST sort key. Lower sorts first. */
const TIER_RANK: Record<SearchTier, number> = { title: 0, path: 1, body: 2 }

interface DocEntry {
  guid: string
  path: string
  text: string
  parsed: ParsedDoc
  /** Distinct term → offsets in `text` (capped at MAX_POSITIONS). */
  terms: Map<string, number[]>
  /** Distinct term → true occurrence count. Positions are capped; tf is not. */
  freq: Map<string, number>
  /** Offsets of every line start, so offset→line is a binary search. */
  lineStarts: number[]
  /** Terms present in the PATH — a separate field for ranking (BM25F-ish). */
  pathTerms: Set<string>
  /** Folded terms of the BASENAME (sans `.md`) — the title tier's evidence. */
  baseTerms: Set<string>
  /** Those terms concatenated, so `svelte kit` matches a note called `SvelteKit`. */
  baseKey: string
  /** Total token count, for BM25 length normalisation. */
  length: number
  headings: Heading[]
  /**
   * tagKey → the first spelling seen in this note. Inline `#tags` and the
   * block's `tags:` merge here, so a note carrying both forms of one tag is
   * counted once (R5.2), and matching is case-insensitive while display is
   * case-preserving, as in Obsidian.
   */
  tags: Map<string, string>
  frontmatterKeys: string[]
  /** Typed property values (collections A1); link targets unresolved until asked. */
  props: Record<string, PropValue>
  mtime: number | null
}

/** One document's accumulating score while a query is being answered. */
interface Acc {
  entry: DocEntry
  score: number
  /** Every matched offset, for spans and snippets. */
  offsets: number[]
  /** Query-term index → that term's matched offsets, for the phrase check. */
  perTerm: number[][]
  /** Null unless the caller asked to be told why. */
  explain: ExplainRow[] | null
}


export class MemoryIndex implements WritableIndex {
  readonly schemaVersion = SCHEMA_VERSION

  private docs = new Map<string, DocEntry>()
  /** term → guids containing it. Postings; offsets live on the doc entry. */
  private postings = new Map<string, Set<string>>()
  private resolver = new PathResolver()
  /**
   * The link graph is derived lazily, and in two flavours:
   *
   *  - `resolutionDirty` — the PATH SET changed (a note was created, deleted
   *    or renamed), so every link in the vault may resolve differently and the
   *    whole graph is rebuilt.
   *  - `dirtyDocs` — only these documents' TEXT changed, so only their own
   *    links are re-derived.
   *
   * The distinction is the difference between 12 ms and 0.1 ms per keystroke:
   * `onDocChanged` fires on every character typed, and it used to walk every
   * note in the vault, on CodeMirror's input path.
   */
  private resolutionDirty = true
  private dirtyDocs = new Set<string>()
  private backlinkMap = new Map<string, LinkRef[]>()
  private outgoingMap = new Map<string, LinkRef[]>()
  private unresolvedLinks: LinkRef[] = []
  private lastBuildMs = 0

  // ---- write side ---------------------------------------------------------

  upsert(doc: IndexDoc): void {
    const existing = this.docs.get(doc.guid)
    if (existing) this.unpost(existing)
    const entry = this.derive(doc)
    this.docs.set(doc.guid, entry)
    for (const term of entry.terms.keys()) {
      const bucket = this.postings.get(term)
      if (bucket) bucket.add(doc.guid)
      else this.postings.set(term, new Set([doc.guid]))
    }
    if (!existing || existing.path !== doc.path) {
      this.resolver.reset(this.paths())
      this.resolutionDirty = true // a new or moved path re-resolves the vault
    } else {
      this.dirtyDocs.add(doc.guid)
    }
  }

  remove(guid: string): void {
    const entry = this.docs.get(guid)
    if (!entry) return
    this.unpost(entry)
    this.docs.delete(guid)
    this.resolver.reset(this.paths())
    this.resolutionDirty = true
  }

  rename(guid: string, path: string): void {
    const entry = this.docs.get(guid)
    if (!entry || entry.path === path) return
    // The PATH is an indexed field (a filename hit outranks a body hit), so a
    // rename must re-derive it — mutating entry.path alone would leave the
    // note findable by its OLD name and invisible under its new one.
    this.upsert({ guid, path, text: entry.text, ...(entry.mtime === null ? {} : { mtime: entry.mtime }) })
  }

  rebuild(docs: Iterable<IndexDoc>): void {
    const started = now()
    this.docs.clear()
    this.postings.clear()
    for (const doc of docs) {
      const entry = this.derive(doc)
      this.docs.set(doc.guid, entry)
      for (const term of entry.terms.keys()) {
        const bucket = this.postings.get(term)
        if (bucket) bucket.add(doc.guid)
        else this.postings.set(term, new Set([doc.guid]))
      }
    }
    this.resolver.reset(this.paths())
    this.resolutionDirty = true
    this.dirtyDocs.clear()
    this.lastBuildMs = Math.round(now() - started)
  }

  // ---- read side ----------------------------------------------------------

  search(
    query: string,
    opts?: PageOptions & { explain?: boolean; recent?: string[] }
  ): Promise<Page<SearchHit>> {
    const { terms, tag, pathPrefix } = parseQuery(query)
    let pool = [...this.docs.values()]
    // `tag:#a` finds `#a/b` too — the same predicate byTag() uses, because a
    // filter that disagrees with the tag list is a bug report waiting to happen.
    if (tag) pool = pool.filter((d) => hasTag(d, tagKey(tag)))
    if (pathPrefix) {
      const p = pathPrefix.toLowerCase()
      pool = pool.filter((d) => d.path.toLowerCase().startsWith(p))
    }

    // Recency is a TIE-BREAK, never a ranking signal: position in `recent`,
    // with everything unseen sharing last place.
    const recent = opts?.recent ?? []
    const recency = new Map(recent.map((path, i) => [path, i]))
    const recencyOf = (path: string): number => recency.get(path) ?? Number.MAX_SAFE_INTEGER

    // A bare `tag:`/`path:` query is a filter, not a search: rank by path.
    if (terms.length === 0) {
      const tier: SearchTier = pathPrefix ? 'path' : 'body'
      const hits = pool
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((d): SearchHit => ({
          guid: d.guid,
          path: d.path,
          score: 0,
          tier,
          spans: [],
          snippets: [],
        }))
      return Promise.resolve(paginate(hits, opts))
    }

    const avgLen = pool.length
      ? pool.reduce((sum, d) => sum + d.length, 0) / pool.length
      : 1
    const inPool = new Set(pool.map((d) => d.guid))
    const wantExplain = opts?.explain === true

    const scored = new Map<string, Acc>()
    let idfSum = 0
    for (let ti = 0; ti < terms.length; ti++) {
      const term = terms[ti]
      // Prefix matching: `svel` must find `svelte` as you type.
      const matching = this.postingsFor(term)
      // DISTINCT documents, not the sum of per-variant posting sizes. Summing
      // lets df exceed the corpus size as soon as a prefix matches several
      // terms, which drives idf negative and INVERTS the ranking — the note
      // literally named the query would sort last.
      const matched = new Set<string>()
      for (const [, guids] of matching) for (const guid of guids) matched.add(guid)
      const df = matched.size
      if (df === 0) continue
      const idf = Math.max(0, Math.log(1 + (this.docs.size - df + 0.5) / (df + 0.5)))
      idfSum += idf
      for (const [matchedTerm, guids] of matching) {
        // A prefix hit is worth less than an exact one, so `note` outranks
        // `notebook` for the query `note`.
        const exactness = matchedTerm === term ? 1 : term.length / matchedTerm.length
        for (const guid of guids) {
          if (!inPool.has(guid)) continue
          const entry = this.docs.get(guid)!
          const offsets = entry.terms.get(matchedTerm) ?? []
          const tf = entry.freq.get(matchedTerm) ?? 0
          const body = tf
            ? (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (entry.length / avgLen)))
            : 0
          // Fields score ADDITIVELY (BM25F-shaped), not multiplicatively: a
          // note whose FILENAME is the query must win even when the word
          // never appears in its body, and multiplying a zero body score by a
          // title bonus is still zero.
          const title = entry.pathTerms.has(matchedTerm) ? W_TITLE : 0
          const heading = entry.headings.some((h) =>
            h.text.toLowerCase().includes(matchedTerm)
          )
            ? W_HEADING
            : 0
          let acc = scored.get(guid)
          if (!acc) {
            acc = {
              entry,
              score: 0,
              offsets: [],
              perTerm: terms.map(() => [] as number[]),
              explain: wantExplain ? [] : null,
            }
            scored.set(guid, acc)
          }
          acc.score += idf * (body + title + heading) * exactness
          acc.offsets.push(...offsets)
          acc.perTerm[ti].push(...offsets)
          if (acc.explain) {
            addExplain(acc.explain, term, 'body', idf * body * exactness)
            addExplain(acc.explain, term, 'title', idf * title * exactness)
            addExplain(acc.explain, term, 'heading', idf * heading * exactness)
          }
        }
      }
    }

    // Phrase bonus. A two-word query is usually a NAME, and a note where the
    // two words sit next to each other in that order is what was meant. Scaled
    // by the query's total idf so a rare pair counts for more than a common
    // one; it reorders WITHIN a tier and never across one.
    if (terms.length > 1 && idfSum > 0) {
      const bonus = idfSum * PHRASE_BONUS
      for (const acc of scored.values()) {
        if (!hasPhrase(acc.entry.text, acc.perTerm)) continue
        acc.score += bonus
        if (acc.explain) addExplain(acc.explain, terms.join(' '), 'phrase', bonus)
      }
    }

    const hits = [...scored.values()]
      .map((acc) => ({ acc, tier: tierOf(acc.entry, terms) }))
      .sort(
        (a, b) =>
          TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
          b.acc.score - a.acc.score ||
          recencyOf(a.acc.entry.path) - recencyOf(b.acc.entry.path) ||
          a.acc.entry.path.localeCompare(b.acc.entry.path)
      )
      .map(({ acc, tier }): SearchHit => {
        const { entry } = acc
        const spans = mergeSpans(
          acc.offsets.map((o) => ({ from: o, to: o + termLengthAt(entry.text, o) }))
        )
        const hit: SearchHit = {
          guid: entry.guid,
          path: entry.path,
          score: acc.score,
          tier,
          spans,
          snippets: buildSnippets(entry.text, spans),
        }
        if (acc.explain) {
          hit.explain = acc.explain
            .filter((row) => row.contribution !== 0)
            .sort((x, y) => y.contribution - x.contribution)
        }
        return hit
      })
    return Promise.resolve(paginate(hits, opts))
  }

  /**
   * Unranked literal/regex match over the RAW text — the escape hatch from the
   * ranking pass's noise exclusion. Whatever `search` refuses to rank (URLs,
   * link targets, fenced code) is still here, in document order.
   */
  grep(
    pattern: string,
    opts?: PageOptions & { regex?: boolean; caseSensitive?: boolean; pathPrefix?: string }
  ): Promise<Page<GrepHit>> {
    if (!pattern) return Promise.resolve(paginate([] as GrepHit[], opts))
    let re: RegExp
    try {
      // `m` so `^`/`$` anchor to LINES, which is what anyone typing a grep
      // pattern means. No `s`, so `.` still stops at a newline.
      re = new RegExp(
        opts?.regex ? pattern : escapeRegExp(pattern),
        opts?.caseSensitive ? 'gm' : 'gim'
      )
    } catch (err) {
      // A bad regex is an ERROR, never an empty result — "nothing found" would
      // be a lie about the vault (parent shaping R7).
      return Promise.reject(err)
    }
    const prefix = opts?.pathPrefix?.toLowerCase()
    const entries = [...this.docs.values()]
      .filter((d) => !prefix || d.path.toLowerCase().startsWith(prefix))
      .sort((a, b) => a.path.localeCompare(b.path))

    const hits: GrepHit[] = []
    for (const entry of entries) {
      re.lastIndex = 0
      let current: GrepHit | null = null
      for (let m = re.exec(entry.text); m; m = re.exec(entry.text)) {
        if (m[0].length === 0) {
          // A pattern that can match nothing (`x*`) would otherwise spin.
          re.lastIndex++
          continue
        }
        const line = lineAt(entry.lineStarts, m.index)
        const start = entry.lineStarts[line - 1]
        if (!current || current.line !== line) {
          const nl = entry.text.indexOf('\n', start)
          current = {
            guid: entry.guid,
            path: entry.path,
            line,
            lineText: entry.text.slice(start, nl === -1 ? entry.text.length : nl),
            spans: [],
          }
          hits.push(current)
        }
        current.spans.push({
          from: m.index - start,
          // A multi-line match is reported on the line it STARTS on, clipped —
          // `lineText` and its spans must stay consistent.
          to: Math.min(m.index + m[0].length - start, current.lineText.length),
        })
      }
    }
    return Promise.resolve(paginate(hits, opts))
  }

  quickOpen(
    query: string,
    opts?: PageOptions & { recent?: string[] }
  ): Promise<Page<PathHit>> {
    const recent = opts?.recent ?? []
    const recency = new Map(recent.map((p, i) => [p, recent.length - i]))
    const q = query.trim()

    if (!q) {
      // Empty query IS the recent-files list — the working set is 5% of the
      // vault, so this is the answer most of the time.
      const seen = new Set<string>()
      const items: PathHit[] = []
      for (const path of recent) {
        const entry = [...this.docs.values()].find((d) => d.path === path)
        if (!entry || seen.has(path)) continue
        seen.add(path)
        items.push({ guid: entry.guid, path, score: recency.get(path) ?? 0, spans: [] })
      }
      for (const entry of [...this.docs.values()].sort((a, b) => a.path.localeCompare(b.path))) {
        if (seen.has(entry.path)) continue
        items.push({ guid: entry.guid, path: entry.path, score: 0, spans: [] })
      }
      return Promise.resolve(paginate(items, opts))
    }

    const hits: PathHit[] = []
    for (const entry of this.docs.values()) {
      const match = fuzzyScore(q, entry.path)
      if (!match) continue
      const bump = Math.min(recency.get(entry.path) ?? 0, 10) * W_RECENCY
      hits.push({
        guid: entry.guid,
        path: entry.path,
        score: match.score + bump,
        spans: toSpans(match.positions),
      })
    }
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    return Promise.resolve(paginate(hits, opts))
  }

  backlinks(target: string, opts?: PageOptions & { property?: string }): Promise<Page<LinkRef>> {
    this.refreshLinks()
    const path = this.resolver.resolve(target) ?? normalizeTarget(target)
    const refs = this.backlinkMap.get(path) ?? []
    const want = opts?.property
    return Promise.resolve(paginate(want === undefined ? refs : refs.filter((r) => r.property === want), opts))
  }

  outgoing(guid: string, opts?: PageOptions): Promise<Page<LinkRef>> {
    this.refreshLinks()
    return Promise.resolve(paginate(this.outgoingMap.get(guid) ?? [], opts))
  }

  unresolved(opts?: PageOptions): Promise<Page<LinkRef>> {
    this.refreshLinks()
    return Promise.resolve(paginate(this.unresolvedLinks, opts))
  }

  tags(opts?: PageOptions): Promise<Page<TagCount>> {
    // NOTES per tag, not occurrences — `byTag()` returns notes, and a list
    // reading "#project 3" that opens one note is a lie about the data.
    const counts = new Map<string, number>()
    const shown = new Map<string, string>()
    for (const entry of this.docs.values()) {
      for (const [key, display] of entry.tags) {
        counts.set(key, (counts.get(key) ?? 0) + 1)
        // First spelling wins, vault-wide: `#Project` and `#project` are one
        // tag, and the list shows the one the vault wrote first.
        if (!shown.has(key)) shown.set(key, display)
      }
    }
    const items = [...counts.entries()]
      .map(([key, count]) => ({ tag: shown.get(key) ?? key, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    return Promise.resolve(paginate(items, opts))
  }

  byTag(tag: string, opts?: PageOptions): Promise<Page<PathHit>> {
    const want = tagKey(tag)
    const items = [...this.docs.values()]
      .filter((d) => hasTag(d, want))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((d): PathHit => ({ guid: d.guid, path: d.path, score: 0, spans: [] }))
    return Promise.resolve(paginate(items, opts))
  }

  headings(guid: string): Promise<Heading[]> {
    return Promise.resolve(this.docs.get(guid)?.headings ?? [])
  }

  frontmatterKeys(opts?: PageOptions): Promise<Page<TagCount>> {
    const counts = new Map<string, number>()
    for (const entry of this.docs.values()) {
      for (const key of entry.frontmatterKeys) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const items = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    return Promise.resolve(paginate(items, opts))
  }

  rows(query: RowQuery, opts?: PageOptions): Promise<Page<Row>> {
    this.refreshLinks()
    const ctx: FilterContext = {
      now: query.now,
      ...(query.tzOffsetMinutes === undefined ? {} : { tzOffsetMinutes: query.tzOffsetMinutes }),
      resolve: (target) => this.resolver.resolve(target),
    }
    const rows: Row[] = []
    for (const entry of this.docs.values()) {
      const row = this.rowOf(entry)
      if (query.filter && !matchesFilter(row, query.filter, ctx)) continue
      rows.push(row)
    }
    const sort = query.sort ?? []
    rows.sort((a, b) => compareRows(a, b, sort))
    return Promise.resolve(paginate(rows, opts))
  }

  propertyValues(key: string, opts?: PageOptions): Promise<Page<ValueCount>> {
    const counts = new Map<string, number>()
    for (const entry of this.docs.values()) {
      const v = entry.props[key]
      if (!v) continue
      const items = v.kind === 'list' ? v.items : [v]
      // Each note counts a value ONCE, as `tags()` does — an option list
      // reading "Deep 3" that filters to two notes is wrong about the data.
      const seen = new Set<string>()
      for (const item of items) {
        const text = scalarText(item)
        if (text === '' || seen.has(text)) continue
        seen.add(text)
        counts.set(text, (counts.get(text) ?? 0) + 1)
      }
    }
    const items = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    return Promise.resolve(paginate(items, opts))
  }

  resolve(target: string, fromPath?: string): Promise<string | null> {
    return Promise.resolve(this.resolver.resolve(target, fromPath))
  }

  /** One note as a record. Links in values resolve NOW, against the current path set. */
  private rowOf(entry: DocEntry): Row {
    const props: Record<string, PropValue> = {}
    for (const [key, value] of Object.entries(entry.props)) props[key] = this.resolveLinks(value, entry.path)
    const links = new Set<string>()
    for (const ref of this.outgoingMap.get(entry.guid) ?? []) if (ref.resolved) links.add(ref.resolved)
    const slash = entry.path.lastIndexOf('/')
    const file = entry.path.slice(slash + 1)
    const dot = file.lastIndexOf('.')
    return {
      guid: entry.guid,
      path: entry.path,
      name: basename(entry.path),
      folder: slash === -1 ? '' : entry.path.slice(0, slash),
      ext: dot === -1 ? '' : file.slice(dot + 1),
      tags: [...entry.tags.values()].map((t) => t.slice(1)),
      links: [...links],
      mtime: entry.mtime,
      size: entry.text.length,
      props,
    }
  }

  private resolveLinks(value: PropValue, fromPath: string): PropValue {
    if (value.kind === 'link') return { ...value, resolved: this.resolver.resolve(value.target, fromPath) }
    if (value.kind === 'list' && value.items.some((i) => i.kind === 'link')) {
      return {
        kind: 'list',
        items: value.items.map((i) =>
          i.kind === 'link' ? { ...i, resolved: this.resolver.resolve(i.target, fromPath) } : i
        ),
      }
    }
    return value
  }

  stats(): Promise<IndexStats> {
    this.refreshLinks()
    let postings = 0
    for (const entry of this.docs.values()) postings += entry.terms.size
    let links = 0
    for (const list of this.outgoingMap.values()) links += list.length
    const tags = new Set<string>()
    for (const entry of this.docs.values()) for (const key of entry.tags.keys()) tags.add(key)
    return Promise.resolve({
      schemaVersion: this.schemaVersion,
      docs: this.docs.size,
      terms: this.postings.size,
      postings,
      links,
      unresolved: this.unresolvedLinks.length,
      tags: tags.size,
      lastBuildMs: this.lastBuildMs,
    })
  }

  // ---- internals ----------------------------------------------------------

  private paths(): string[] {
    return [...this.docs.values()].map((d) => d.path)
  }

  private unpost(entry: DocEntry): void {
    for (const term of entry.terms.keys()) {
      const bucket = this.postings.get(term)
      if (!bucket) continue
      bucket.delete(entry.guid)
      if (bucket.size === 0) this.postings.delete(term)
    }
  }

  /** Exact posting plus prefix postings, so search matches as you type. */
  private postingsFor(term: string): [string, Set<string>][] {
    const out: [string, Set<string>][] = []
    const exact = this.postings.get(term)
    if (exact) out.push([term, exact])
    // Prefix scan. Linear over distinct terms (~36k here, 0.3 ms measured);
    // a trie is the obvious upgrade if the trigger in Fork 1 ever fires.
    if (term.length >= 2) {
      for (const [candidate, guids] of this.postings) {
        if (candidate !== term && candidate.startsWith(term)) out.push([candidate, guids])
      }
    }
    return out
  }

  private derive(doc: IndexDoc): DocEntry {
    const parsed = parseMarkdown(doc.text)
    const terms = new Map<string, number[]>()
    const freq = new Map<string, number>()
    let length = 0
    // `indexBody`, not `body`: URL text, markdown link targets and fenced code
    // are blanked (to spaces, so offsets hold) before anything is counted. See
    // the ranking note in this file's header for the measured reason.
    for (const token of tokenize(parsed.indexBody)) {
      length++
      freq.set(token.term, (freq.get(token.term) ?? 0) + 1)
      const list = terms.get(token.term)
      if (list) {
        // Positions are capped; the frequency above is not. An 83KB note with
        // 400 hits does not need 400 remembered offsets, but its term
        // frequency must stay honest or ranking drifts.
        if (list.length < MAX_POSITIONS) list.push(token.offset)
      } else {
        terms.set(token.term, [token.offset])
      }
    }
    // The PATH is a separate field, not more body text: "find the note called
    // X" must work when X never appears in the body, and a filename hit is
    // worth more than a body hit.
    const pathTerms = new Set(
      tokenize(doc.path.replace(/[/_.-]/g, ' ')).map((t) => t.term)
    )
    for (const term of pathTerms) if (!terms.has(term)) terms.set(term, [])
    // The BASENAME is a narrower field again: `Areas/CS/JSON.md` is *called*
    // JSON, while `Docs/Immich Setup.md` merely lives under a folder named
    // Docs. Tier 1 is the first, tier 2 the second.
    const baseTermList = tokenize(
      doc.path.slice(doc.path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
    ).map((t) => t.term)
    const lineStarts = lineStartsOf(doc.text)
    return {
      guid: doc.guid,
      path: doc.path,
      text: doc.text,
      parsed,
      terms,
      freq,
      pathTerms,
      baseTerms: new Set(baseTermList),
      baseKey: baseTermList.join(''),
      lineStarts,
      length: Math.max(length, 1),
      headings: parsed.headings.map((h) => ({
        level: h.level,
        text: h.text,
        offset: h.offset,
        line: lineAt(lineStarts, h.offset),
      })),
      tags: mergeTags(parsed),
      frontmatterKeys: parsed.frontmatterKeys,
      props: Object.fromEntries(parsed.properties.map((p) => [p.key, typeProperty(p.value)])),
      mtime: doc.mtime ?? null,
    }
  }

  /**
   * Bring the link graph up to date: a full rebuild when resolution changed,
   * otherwise only the documents whose text changed.
   */
  private refreshLinks(): void {
    if (this.resolutionDirty) {
      this.backlinkMap = new Map()
      this.outgoingMap = new Map()
      this.unresolvedLinks = []
      for (const entry of this.docs.values()) this.insertLinks(entry)
      this.resolutionDirty = false
      this.dirtyDocs.clear()
      this.sortUnresolved()
      return
    }
    if (this.dirtyDocs.size === 0) return
    for (const guid of this.dirtyDocs) {
      this.removeLinks(guid)
      const entry = this.docs.get(guid)
      if (entry) this.insertLinks(entry)
    }
    this.dirtyDocs.clear()
    this.sortUnresolved()
  }

  /** Drop every link ORIGINATING in `guid` from the graph. */
  private removeLinks(guid: string): void {
    const old = this.outgoingMap.get(guid)
    if (!old) return
    this.outgoingMap.delete(guid)
    for (const ref of old) {
      if (ref.resolved) {
        const bucket = this.backlinkMap.get(ref.resolved)
        if (!bucket) continue
        const next = bucket.filter((r) => r.guid !== guid)
        if (next.length) this.backlinkMap.set(ref.resolved, next)
        else this.backlinkMap.delete(ref.resolved)
      }
    }
    this.unresolvedLinks = this.unresolvedLinks.filter((r) => r.guid !== guid)
  }

  private insertLinks(entry: DocEntry): void {
    const refs: LinkRef[] = []
    // Body links first, then the ones written inside property values: a
    // relation is a backlink like any other, tagged with its key (A5).
    for (const raw of [...entry.parsed.links, ...entry.parsed.propertyLinks]) {
      // `[[#heading]]` is a same-note anchor with no target to resolve.
      const resolved = raw.target ? this.resolver.resolve(raw.target, entry.path) : entry.path
      const ref: LinkRef = {
        guid: entry.guid,
        path: entry.path,
        target: raw.target,
        alias: raw.alias,
        anchor: raw.anchor,
        embed: raw.embed,
        resolved,
        offset: raw.offset,
        line: lineAt(entry.lineStarts, raw.offset),
        context: lineTextAt(entry.text, raw.offset),
        ...(raw.property === undefined ? {} : { property: raw.property }),
      }
      refs.push(ref)
      if (resolved) {
        const bucket = this.backlinkMap.get(resolved)
        if (bucket) bucket.push(ref)
        else this.backlinkMap.set(resolved, [ref])
      } else {
        this.unresolvedLinks.push(ref)
      }
    }
    if (refs.length) this.outgoingMap.set(entry.guid, refs)
  }

  private sortUnresolved(): void {
    this.unresolvedLinks.sort(
      (a, b) => a.target.localeCompare(b.target) || a.path.localeCompare(b.path)
    )
  }
}

// ---- helpers --------------------------------------------------------------

/**
 * Diagnostic timing for stats().lastBuildMs only — nothing in this package
 * SCHEDULES anything, so there is no behaviour for an injected clock to make
 * deterministic. clock-exempt (golden rule 5).
 */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0 // clock-exempt
}

/**
 * Obsidian's nesting rule: `#a` matches `#a` and every `#a/b` under it, while
 * `#a/b` matches only itself. `want` is a tagKey.
 */
function hasTag(entry: DocEntry, want: string): boolean {
  if (entry.tags.has(want)) return true
  const nested = `${want}/`
  for (const key of entry.tags.keys()) if (key.startsWith(nested)) return true
  return false
}

/** Inline tags and frontmatter tags, one set, first spelling kept. */
function mergeTags(parsed: ParsedDoc): Map<string, string> {
  const tags = new Map<string, string>()
  for (const { tag } of [...parsed.tags, ...parsed.frontmatterTags]) {
    const key = tagKey(tag)
    if (!tags.has(key)) tags.set(key, tag)
  }
  return tags
}

/** `tag:#x` / `path:foo/` prefixes, parsed out of the query string. */
export function parseQuery(query: string): {
  terms: string[]
  tag: string | null
  pathPrefix: string | null
} {
  let tag: string | null = null
  let pathPrefix: string | null = null
  const rest: string[] = []
  for (const word of query.split(/\s+/)) {
    if (!word) continue
    if (word.startsWith('tag:')) {
      const v = word.slice(4)
      if (v) tag = v.startsWith('#') ? v : `#${v}`
    } else if (word.startsWith('path:')) {
      const v = word.slice(5)
      if (v) pathPrefix = v
    } else {
      rest.push(word)
    }
  }
  return { terms: queryTerms(rest.join(' ')), tag, pathPrefix }
}

function lineTextAt(text: string, offset: number): string {
  const start = text.lastIndexOf('\n', Math.max(offset - 1, 0)) + 1
  const nl = text.indexOf('\n', offset)
  return text.slice(start, nl === -1 ? text.length : nl).trim()
}

/** Length of the word starting at `offset`, for highlight spans. */
function termLengthAt(text: string, offset: number): number {
  let i = offset
  while (i < text.length && /[\p{L}\p{N}\p{M}]/u.test(text[i])) i++
  return Math.max(i - offset, 1)
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from)
  const out: Span[] = []
  for (const span of sorted) {
    const last = out[out.length - 1]
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to)
    else out.push({ ...span })
  }
  return out
}

const SNIPPET_RADIUS = 60
const MAX_SNIPPETS = 3

/** One line of context per span group, capped — the results-list payload. */
function buildSnippets(text: string, spans: Span[]): Snippet[] {
  const out: Snippet[] = []
  for (const span of spans) {
    if (out.length >= MAX_SNIPPETS) break
    const lineStart = text.lastIndexOf('\n', Math.max(span.from - 1, 0)) + 1
    const nl = text.indexOf('\n', span.from)
    const lineEnd = nl === -1 ? text.length : nl
    if (out.some((s) => s.offset <= lineStart && lineStart < s.offset + s.text.length)) continue
    const from = Math.max(lineStart, span.from - SNIPPET_RADIUS)
    const to = Math.min(lineEnd, span.to + SNIPPET_RADIUS)
    const snippetSpans = spans
      .filter((s) => s.from >= from && s.to <= to)
      .map((s) => ({ from: s.from - from, to: s.to - from }))
    out.push({ offset: from, text: text.slice(from, to), spans: snippetSpans })
  }
  return out
}

/**
 * Which field earned the hit its place — the FIRST sort key, ahead of score.
 *
 *  - `title`: the basename (sans `.md`) IS the query, either term-for-term or
 *    concatenated (`svelte kit` finds a note called `SvelteKit`).
 *  - `path`: every query term appears somewhere in the path — the note lives
 *    in a folder called that, or its name contains the word among others.
 *  - `body`: matched on content, a heading, or only part of the path.
 *
 * Deliberately NOT prefix-aware: while the query is still being typed (`svel`)
 * there is no title claim to make, and ranking falls back to the body tier —
 * exactly what it did before tiers existed.
 */
function tierOf(entry: DocEntry, terms: string[]): SearchTier {
  if (entry.baseKey && entry.baseKey === terms.join('')) return 'title'
  if (entry.baseTerms.size === terms.length && terms.every((t) => entry.baseTerms.has(t))) {
    return 'title'
  }
  if (terms.every((t) => entry.pathTerms.has(t))) return 'path'
  return 'body'
}

/**
 * Do the query's terms occur adjacent and in order anywhere in the document?
 *
 * Char offsets rather than token indexes, with PHRASE_GAP characters of slack
 * for a separator. Positions are capped at MAX_POSITIONS per term, so a phrase
 * that only occurs past the cap earns no bonus — it is never scored wrongly,
 * only missed, and the tier above it is what actually decides the answer.
 */
function hasPhrase(text: string, perTerm: number[][]): boolean {
  if (perTerm.some((list) => list.length === 0)) return false
  const sorted = perTerm.map((list) => [...new Set(list)].sort((a, b) => a - b))
  for (const start of sorted[0]) {
    let at = start
    let ok = true
    for (let i = 1; i < sorted.length; i++) {
      const end = at + termLengthAt(text, at)
      const next = sorted[i].find((o) => o >= end && o - end <= PHRASE_GAP)
      if (next === undefined) {
        ok = false
        break
      }
      at = next
    }
    if (ok) return true
  }
  return false
}

/** Accumulate one (term, field) contribution; rows sum to the hit's score. */
function addExplain(rows: ExplainRow[], term: string, field: string, contribution: number): void {
  if (contribution === 0) return
  const row = rows.find((r) => r.term === term && r.field === field)
  if (row) row.contribution += contribution
  else rows.push({ term, field, contribution })
}

const REGEX_META = /[.*+?^${}()|[\]\\]/g

/** Literal `grep` mode: the pattern is text, not a pattern. */
function escapeRegExp(text: string): string {
  return text.replace(REGEX_META, '\\$&')
}
