/**
 * THE INDEX CONTRACT.
 *
 * `slices` V2 originally shaped this as SQLite/FTS5 (sqlite-wasm on OPFS
 * in the browser, rusqlite under Tauri). Measured against the real vault —
 * 1,144 notes / 3.12 MB, where a brute-force full-vault substring scan takes
 * 3.9 ms and an index build takes ~120 ms over text already resident in RAM —
 * that premise did not hold, and V2 ships an in-memory TypeScript backend.
 * See v2-shaping, Fork 1, for the numbers and the trigger that flips
 * the decision back (>5k files, >20MB, cold build >750ms, or search p95 >50ms).
 *
 * This file is the insurance policy that keeps that swap a day's work rather
 * than a rewrite. Every rule below exists for that reason:
 *
 *   1. Every query returns a Promise, even though the in-memory backend
 *      resolves synchronously. A sync→async change later is a caller rewrite.
 *   2. No SQL, no query language — structured calls only.
 *   3. Every list result is limited and cursored from day one. Callers that
 *      assume whole arrays are precisely what blocks the swap.
 *   4. Ranking is in the contract, not the backend: hits carry a documented
 *      BM25-shaped score so FTS5's bm25() substitutes without visibly
 *      reordering.
 *   5. One writer path. The index is fed from exactly one place.
 *   6. schemaVersion + rebuild() — droppability is contractual, not a
 *      property of one implementation.
 *
 * INVARIANT (parent shaping R7 / golden rule 1): the index is NEVER a system
 * of record. Everything in it is derived from vault text and can be thrown
 * away. Losing it costs a rebuild, never data.
 */

/** Bump when the derived shape changes; a mismatch means rebuild, not migrate. */
export const SCHEMA_VERSION = 2

/** A document as the index sees it. Text comes from the CRDT, not from disk. */
export interface IndexDoc {
  /** Rename-stable identity. Paths move; guids don't. */
  guid: string
  /** Workspace-absolute path, e.g. `Areas/CS/Systems Programming.md`. */
  path: string
  text: string
  /**
   * Last-modified time, epoch ms, when the feeder knows it (the CLI's walk
   * does; the app's live docs do not). Absent → `Row.mtime` is null and a
   * sort on it falls through to the path.
   */
  mtime?: number
}

/** A character range in the source text. */
export interface Span {
  from: number
  to: number
}

export interface PageOptions {
  /** Default 50. Backends may cap it; they must never silently return more. */
  limit?: number
  /** Opaque continuation from a previous page's `nextCursor`. */
  cursor?: string
}

export interface Page<T> {
  items: T[]
  /** Non-null when more results exist. Opaque — never parse it. */
  nextCursor: string | null
  /** Total matches when the backend can count cheaply, else null. */
  total: number | null
}

/**
 * Which field earned the hit its place. Results are ordered by TIER FIRST,
 * then by score — a structure, not a weight, because the measured vault has
 * hundreds of one-generic-noun filenames (`Docs`, `JSON`, `HTML`) whose own
 * word is also the vault's most frequent body term. See the ranking section
 * of memory-index.ts.
 *
 *  - `title` — the note's basename IS the query.
 *  - `path`  — every query term appears somewhere in the path.
 *  - `body`  — matched in the text, headings or a partial path match.
 */
export type SearchTier = 'title' | 'path' | 'body'

/**
 * One line of a hit's score, for `--explain`. `field` is `body`, `title`,
 * `heading` or `phrase`; contributions sum to the hit's `score`.
 */
export interface ExplainRow {
  term: string
  field: string
  contribution: number
}

/**
 * A ranked hit. `score` is BM25-shaped (higher is better, unbounded above,
 * comparable only within one result set) so a future FTS5 `bm25()` can be
 * negated into the same ordering. `tier` orders ABOVE `score`: a backend that
 * only has bm25() must still compute the tier, which is a pure function of the
 * query and the path.
 */
export interface SearchHit {
  guid: string
  path: string
  score: number
  tier: SearchTier
  /** Match positions in the document text, ascending, non-overlapping. */
  spans: Span[]
  /** One line of context per span group, for the results list. */
  snippets: Snippet[]
  /** Per-(term, field) contributions. Present only when `explain` was asked. */
  explain?: ExplainRow[]
}

/**
 * An unranked literal/regex match, in document order — the `grep` half of the
 * contract. Ranked search deliberately does NOT index URL text or fenced code;
 * `grep` reads the raw text, so what ranking hides is still findable.
 */
export interface GrepHit {
  guid: string
  path: string
  /** 1-based. */
  line: number
  /** The whole line, untrimmed, as it is in the document. */
  lineText: string
  /** Match spans, relative to `lineText`. */
  spans: Span[]
}

export interface Snippet {
  /** Offset of the snippet's first character in the document text. */
  offset: number
  text: string
  /** Match spans, relative to `text`. */
  spans: Span[]
}

/** A quick-open candidate. `spans` index into `path`, for highlighting. */
export interface PathHit {
  guid: string
  path: string
  score: number
  spans: Span[]
}

/** One `[[wikilink]]` occurrence. */
export interface LinkRef {
  /** Guid of the note containing the link. */
  guid: string
  /** Path of the note containing the link. */
  path: string
  /** The raw target as written, e.g. `Systems Programming` or `notes/x`. */
  target: string
  /** Display text after `|`, when the link is aliased. */
  alias: string | null
  /** `#heading` or `#^block` anchor, without the `#`. */
  anchor: string | null
  /**
   * The occurrence was `![[…]]`, not `[[…]]`. Worth carrying: an unresolved
   * EMBED is a missing attachment, not a note waiting to be written, so it
   * must never be offered as "create this".
   */
  embed: boolean
  /** Resolved path, or null when nothing in the vault matches. */
  resolved: string | null
  /** Character offset of the link in the containing note. */
  offset: number
  /** 1-based line number, for the panels. */
  line: number
  /** The whole line the link sits on, trimmed — the panel's context. */
  context: string
  /**
   * Set when the link is written INSIDE a frontmatter value (`pillar:
   * "[[Clusters]]"`): the property's key. A relation (collections A5) is a
   * link with a property; its reverse side is `backlinks(target, {property})`.
   */
  property?: string
}

export interface TagCount {
  tag: string
  count: number
}

export interface Heading {
  level: number
  text: string
  offset: number
  line: number
}

export interface IndexStats {
  schemaVersion: number
  docs: number
  terms: number
  postings: number
  links: number
  unresolved: number
  tags: number
  /** Milliseconds spent in the last full rebuild. */
  lastBuildMs: number
}


// ---- rows: notes as records (collections DB1, A1) ------------------------

/**
 * A frontmatter scalar, typed by what it says (bases-shaping S17-Q1):
 * `true`/`false` → boolean; a plain decimal (no leading zero) → number; an
 * ISO date or date-time → date; `[[x]]` → link; empty → null; else string.
 * The typing is inferred from the written value, never from a side table,
 * so what the index says a cell is and what the note says are one thing.
 */
export type PropScalar =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  /** `value` as written; `ms` its epoch for comparison and sorting. */
  | { kind: 'date'; value: string; ms: number }
  /** A `[[wikilink]]` written as the value. `resolved` is filled per query. */
  | { kind: 'link'; target: string; alias: string | null; resolved: string | null }
  | { kind: 'null' }

export type PropValue = PropScalar | { kind: 'list'; items: PropScalar[] }

/** One note as a record: its file fields and its typed properties. */
export interface Row {
  guid: string
  path: string
  /** Basename without `.md`. */
  name: string
  /** Parent folder, `''` at the root. */
  folder: string
  /** Extension without the dot (`md`). */
  ext: string
  /** Tags without `#`, first spelling seen, inline and frontmatter merged. */
  tags: string[]
  /** Resolved paths of every link the note writes (body and properties), deduped. */
  links: string[]
  /** Epoch ms, or null when the feeder did not know. */
  mtime: number | null
  /** Character count of the note's text — `file.size` in a filter. */
  size: number
  props: Record<string, PropValue>
}

/** What a filter or a sort addresses: a file field or a property. */
export type RowKey =
  | { file: 'name' | 'path' | 'folder' | 'ext' | 'mtime' | 'tags' | 'links' | 'size' }
  | { prop: string }

/** A literal in a filter. Dates are literals too — compared by epoch. */
export type RowLiteral = string | number | boolean | null

/** The operands of a comparison. */
export type RowExpr =
  | { key: RowKey }
  | { lit: RowLiteral }
  /** `now()` / `today()` at evaluation time (the index's injected clock, see `rows`). */
  | { now: 'now' | 'today' }
  /** A date plus or minus a duration, e.g. `today() - "7d"`. Units: y M w d h m s. */
  | { dateAdd: RowExpr; duration: string; sign: 1 | -1 }

/**
 * THE ROW FILTER — a closed, structured vocabulary (contract rule 2: no
 * query language in the index). `@ohhi/collections` compiles the `.base`
 * statement grammar into this; a SQLite backend would compile this into
 * SQL. Anything a caller cannot express here is a caller-side refusal,
 * never an eval.
 */
export type RowFilter =
  | { op: 'and'; args: RowFilter[] }
  | { op: 'or'; args: RowFilter[] }
  | { op: 'not'; arg: RowFilter }
  | { op: 'cmp'; cmp: '==' | '!=' | '<' | '<=' | '>' | '>='; left: RowExpr; right: RowExpr }
  /** Truthy: non-empty, non-zero, non-false, non-null. */
  | { op: 'truthy'; arg: RowExpr }
  /** Obsidian's nesting rule: `a` matches `a/b`. Tags without `#`. Any of. */
  | { op: 'hasTag'; tags: string[] }
  /** The note links to `target` (a path or a bare name) anywhere, properties included. */
  | { op: 'hasLink'; target: string }
  /** In the folder or any folder beneath it. `''` is the whole vault. */
  | { op: 'inFolder'; folder: string }
  | { op: 'hasProperty'; key: string }
  /** A list holding the value, or a string containing it (case-sensitive). */
  | { op: 'contains'; target: RowExpr; value: RowExpr }
  | { op: 'containsAny'; target: RowExpr; values: RowExpr[] }
  | { op: 'containsAll'; target: RowExpr; values: RowExpr[] }
  | { op: 'isEmpty'; target: RowExpr }
  | { op: 'startsWith'; target: RowExpr; value: RowExpr }
  | { op: 'endsWith'; target: RowExpr; value: RowExpr }

export interface RowSort {
  key: RowKey
  direction: 'asc' | 'desc'
}

export interface RowQuery {
  filter?: RowFilter
  /** Applied in order; ties fall through to the path. Nulls sort last. */
  sort?: RowSort[]
  /**
   * Evaluation instant for `now()`/`today()`, epoch ms. The index has no
   * clock of its own (golden rule 5): every caller passes the time it means.
   */
  now: number
  /**
   * The caller's zone, minutes east of UTC (`-new Date().getTimezoneOffset()`),
   * so `today()` is the LOCAL calendar day: a date-only value (`2026-06-02`)
   * is that day's UTC midnight, and so is `today()` for whoever reads it at
   * 23:30 in UTC-4. Absent → UTC.
   */
  tzOffsetMinutes?: number
}

/** A distinct value seen under a property key, with the notes carrying it. */
export interface ValueCount {
  value: string
  count: number
}

/** Read side. Everything is a Promise; everything list-shaped is paged. */
export interface VaultIndex {
  readonly schemaVersion: number

  /**
   * Full-text search. Supports `tag:#x` and `path:foo/` prefixes in `query`.
   *
   * Ordering is tier → score → recency → path. `recent` is a TIE-BREAK ONLY
   * (the working set is ~5% of the vault); it never reorders across tiers or
   * across scores. `explain` is opt-in because building the rows costs a
   * second pass per hit.
   */
  search(
    query: string,
    opts?: PageOptions & { explain?: boolean; recent?: string[] }
  ): Promise<Page<SearchHit>>

  /**
   * Literal (or regex) match over the RAW document text, unranked, in document
   * order — paths sorted, then line number. This is the escape hatch from
   * ranking's noise exclusion: a term that only ever appears inside a URL or a
   * fenced code block is invisible to `search` and findable here.
   *
   * `pattern` is matched case-insensitively unless `caseSensitive`. An invalid
   * regex must be reported as a thrown `SyntaxError`, never as "no results".
   */
  grep(
    pattern: string,
    opts?: PageOptions & { regex?: boolean; caseSensitive?: boolean; pathPrefix?: string }
  ): Promise<Page<GrepHit>>

  /** Fuzzy path match for the quick-open switcher. Empty query → MRU order. */
  quickOpen(query: string, opts?: PageOptions & { recent?: string[] }): Promise<Page<PathHit>>

  /**
   * Every link pointing at `target` (a path or a bare note name). With
   * `property`, only links written in that frontmatter key — a relation's
   * reverse side (collections A5), derived, never written twice.
   */
  backlinks(target: string, opts?: PageOptions & { property?: string }): Promise<Page<LinkRef>>

  /** Every link written in the note `guid`. */
  outgoing(guid: string, opts?: PageOptions): Promise<Page<LinkRef>>

  /** Links whose target resolves to nothing — the note-creation queue. */
  unresolved(opts?: PageOptions): Promise<Page<LinkRef>>

  /** Tag counts, most-used first. */
  tags(opts?: PageOptions): Promise<Page<TagCount>>

  byTag(tag: string, opts?: PageOptions): Promise<Page<PathHit>>

  /** Headings of one note, in document order. */
  headings(guid: string): Promise<Heading[]>

  /** Distinct frontmatter keys across the vault, most-used first. */
  frontmatterKeys(opts?: PageOptions): Promise<Page<TagCount>>

  /**
   * Notes as records (collections DB1): filtered and sorted by the structured
   * `RowQuery`, paged. The backing for every collection view and for
   * `ohhi rows`. Ordered by `sort`, then path, so pages are stable.
   */
  rows(query: RowQuery, opts?: PageOptions): Promise<Page<Row>>

  /**
   * Distinct scalar values written under `key` across the vault (list items
   * counted singly), most-used first — the option list a select editor
   * offers when the collection declares none.
   */
  propertyValues(key: string, opts?: PageOptions): Promise<Page<ValueCount>>

  /**
   * Resolve a wikilink target to a workspace path.
   *
   * Obsidian's rule, and the vault's measured shape (only 4 duplicate
   * basenames across 1,144 notes, only 6 links with a path prefix): exact
   * path first, then case-insensitive basename, tie-broken by proximity to
   * `fromPath`. Returns null when nothing matches.
   */
  resolve(target: string, fromPath?: string): Promise<string | null>

  stats(): Promise<IndexStats>
}

/**
 * Write side. Exactly ONE caller drives this (the workspace's index sink) —
 * fanning it out to N call sites is what makes an index drift from the vault.
 */
export interface IndexWriter {
  upsert(doc: IndexDoc): void
  remove(guid: string): void
  /** Rename keeps the guid and moves the path. */
  rename(guid: string, path: string): void
  /** Drop everything and re-derive from `docs`. */
  rebuild(docs: Iterable<IndexDoc>): void
}

export type WritableIndex = VaultIndex & IndexWriter
