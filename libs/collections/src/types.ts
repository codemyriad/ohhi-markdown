/**
 * THE COLLECTION CONTRACT (bases-shaping A2; §Provenance and naming).
 *
 * A collection is a set of notes with properties, seen through saved views.
 * On disk it is a plain vault file in Obsidian's `.base` format — YAML with
 * `filters`, `properties` and `views` at the top — read here as a DOCUMENTED
 * SUBSET: what the measured views use is interpreted, what they do not
 * (formulas, summaries, map views) is carried through untouched and marked
 * on the view, the way the frontmatter reader marks a block it cannot
 * patch. Nothing here evaluates a formula and nothing here ever re-emits a
 * line it did not change (golden rule 2: see patch.ts).
 */
import type { RowKey, RowQuery } from '@ohhi/index'

/**
 * A filter as the file writes it: one statement, or an `and`/`or`/`not`
 * node over more of them. The statement grammar is compiled in filter.ts.
 */
export type FilterTree = string | { and: FilterTree[] } | { or: FilterTree[] } | { not: FilterTree[] }

export interface PropertyConfig {
  displayName?: string
}

export type SortDirection = 'asc' | 'desc'

export interface ViewSort {
  /** As written: `file.name`, `status`, `note.status`, `formula.x`. */
  property: string
  direction: SortDirection
}

/** View types this reader renders; anything else is carried and marked. */
export const VIEW_TYPES = ['table', 'list', 'kanban', 'cards'] as const
export type ViewType = (typeof VIEW_TYPES)[number]

export interface ViewSpec {
  /** Position in `views`, the handle the patcher takes. */
  index: number
  /** As written. One of `VIEW_TYPES` when this app can draw it. */
  type: string
  name: string
  filters: FilterTree | null
  /**
   * Properties shown, in order, as written (`file.name`, `status`, `formula.x`).
   * NULL when the view writes no `order` at all: its columns then follow the
   * notes — the name plus every property the rows on screen hold
   * (`dynamicColumnIds`). An `order` the file writes, even an empty one, is
   * honoured exactly.
   */
  order: string[] | null
  sort: ViewSort[]
  groupBy: { property: string; direction: SortDirection } | null
  limit: number | null
  /** Obsidian's `columnSize`: property → px. */
  columnSize: Record<string, number>
  /**
   * Every other key the file wrote on this view (`cardSize`, `image`,
   * `summaries`, a plugin's state). Read past, written back unchanged.
   */
  extra: Record<string, unknown>
}

export interface CollectionSpec {
  /** Global filters, applied to every view (AND with the view's own). */
  filters: FilterTree | null
  properties: Record<string, PropertyConfig>
  views: ViewSpec[]
  /**
   * Top-level blocks this reader reads past: `formulas`, `summaries`, and
   * anything else. Named so the UI can say "formulas are not computed here".
   */
  issues: string[]
  /** The file could not be read as YAML at all; `views` is then empty. */
  error: string | null
}

/** One column of a compiled view. */
export interface Column {
  /** The property as written in `order` — the id the patcher and the editors use. */
  id: string
  /** `displayName` from `properties`, else a readable form of `id`. */
  label: string
  /** What the index answers; null when the column cannot be computed here (`formula.x`). */
  key: RowKey | null
}

/** A view, compiled against the index's structured query. */
export interface ViewQuery {
  view: ViewSpec
  /** The filter and sort; the caller adds the instant (`now`) and its zone when it runs it. */
  query: Omit<RowQuery, 'now' | 'tzOffsetMinutes'>
  /** The view's written `order`; empty when the view writes none (`dynamicColumns`). */
  columns: Column[]
  /** True when the view writes no `order`: the caller derives the columns from the rows (`rowColumns`). */
  dynamicColumns: boolean
  limit: number | null
  groupBy: { key: RowKey; direction: SortDirection; id: string } | null
  /** False when some part was refused; `reasons` says which, in the file's words. */
  supported: boolean
  reasons: string[]
}
