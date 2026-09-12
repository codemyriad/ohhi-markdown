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
 */
import {
  SCHEMA_VERSION,
  type Heading,
  type IndexDoc,
  type IndexStats,
  type LinkRef,
  type Page,
  type PageOptions,
  type PathHit,
  type SearchHit,
  type Snippet,
  type Span,
  type TagCount,
  type WritableIndex,
} from './types.js'
import { fuzzyScore, toSpans } from './fuzzy.js'
import { parseMarkdown, type ParsedDoc } from './parse.js'
import { normalizeTarget, PathResolver } from './resolve.js'
import { tagKey } from './tag-syntax.js'
import { queryTerms, tokenize } from './tokenize.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 1000
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
}

/** Encode/decode an opaque page cursor. Callers must never parse it. */
const encodeCursor = (n: number): string => `o${n}`
const decodeCursor = (c: string | undefined): number => {
  if (!c || !c.startsWith('o')) return 0
  const n = Number.parseInt(c.slice(1), 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function paginate<T>(items: T[], opts?: PageOptions): Page<T> {
  const limit = Math.min(Math.max(opts?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const start = decodeCursor(opts?.cursor)
  const slice = items.slice(start, start + limit)
  const end = start + slice.length
  return {
    items: slice,
    nextCursor: end < items.length ? encodeCursor(end) : null,
    total: items.length,
  }
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
    this.upsert({ guid, path, text: entry.text })
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

  search(query: string, opts?: PageOptions): Promise<Page<SearchHit>> {
    const { terms, tag, pathPrefix } = parseQuery(query)
    let pool = [...this.docs.values()]
    // `tag:#a` finds `#a/b` too — the same predicate byTag() uses, because a
    // filter that disagrees with the tag list is a bug report waiting to happen.
    if (tag) pool = pool.filter((d) => hasTag(d, tagKey(tag)))
    if (pathPrefix) {
      const p = pathPrefix.toLowerCase()
      pool = pool.filter((d) => d.path.toLowerCase().startsWith(p))
    }

    // A bare `tag:`/`path:` query is a filter, not a search: rank by path.
    if (terms.length === 0) {
      const hits = pool
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((d): SearchHit => ({ guid: d.guid, path: d.path, score: 0, spans: [], snippets: [] }))
      return Promise.resolve(paginate(hits, opts))
    }

    const avgLen = pool.length
      ? pool.reduce((sum, d) => sum + d.length, 0) / pool.length
      : 1
    const inPool = new Set(pool.map((d) => d.guid))

    const scored = new Map<string, { entry: DocEntry; score: number; offsets: number[] }>()
    for (const term of terms) {
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
          const add = idf * (body + title + heading) * exactness
          const prev = scored.get(guid)
          if (prev) {
            prev.score += add
            prev.offsets.push(...offsets.map((o) => o))
          } else {
            scored.set(guid, { entry, score: add, offsets: [...offsets] })
          }
        }
      }
    }

    const hits = [...scored.values()]
      .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
      .map(({ entry, score, offsets }): SearchHit => {
        const spans = mergeSpans(
          offsets.map((o) => ({ from: o, to: o + termLengthAt(entry.text, o) }))
        )
        return {
          guid: entry.guid,
          path: entry.path,
          score,
          spans,
          snippets: buildSnippets(entry.text, spans),
        }
      })
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

  backlinks(target: string, opts?: PageOptions): Promise<Page<LinkRef>> {
    this.refreshLinks()
    const path = this.resolver.resolve(target) ?? normalizeTarget(target)
    return Promise.resolve(paginate(this.backlinkMap.get(path) ?? [], opts))
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

  resolve(target: string, fromPath?: string): Promise<string | null> {
    return Promise.resolve(this.resolver.resolve(target, fromPath))
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
    for (const token of tokenize(parsed.body)) {
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
    const lineStarts = lineStartsOf(doc.text)
    return {
      guid: doc.guid,
      path: doc.path,
      text: doc.text,
      parsed,
      terms,
      freq,
      pathTerms,
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
    for (const raw of entry.parsed.links) {
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

/** Offsets at which each line begins. Computed once per document. */
function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

/** 1-based line for an offset. Binary search — this runs per link, per rebuild. */
function lineAt(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
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
