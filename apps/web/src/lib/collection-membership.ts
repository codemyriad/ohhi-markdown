/**
 * Which notes are rows (bases-shaping A7, Fork 3-B). A note "belongs to a
 * collection" when the collection's GLOBAL filters match it AND at least
 * one of its VIEWS' filters does — a view with no filters of its own admits
 * whatever the global filters admit — and a collection with no filters at
 * any level claims nothing: one filterless `.base` must not put a form on
 * every note in the vault (the outcome Fork 3 rejected). The question is
 * asked of the index with the same compiler the collection tab and
 * `ohhi rows` use, so the form at the top of a note and the table that
 * lists it agree by construction. Pure: the shell decides when to ask
 * (`collection-membership.svelte.ts`) and what to do with the answer.
 */
import { compileView, isCollectionPath, parseCollection, type ViewSpec } from '@ohhi/collections'
import type { RowFilter, VaultIndex } from '@ohhi/index'

/** A collection with filters and no `views:` is still a query (as `ohhi rows` reads it): its filters through this empty view. */
const EMPTY_VIEW: ViewSpec = { index: -1, type: 'table', name: '', filters: null, order: null, sort: [], groupBy: null, limit: null, columnSize: {}, extra: {} }

/** One collection's membership test: the file, and its filters compiled. */
export interface CollectionQuery {
  path: string
  filter: RowFilter
}

/** A `.base` file compiled once per text — what a cache holds between asks. */
export interface CompiledCollection {
  text: string
  /** Null when the file claims nothing: unreadable, or no filters at any level. */
  query: CollectionQuery | null
}

/**
 * The membership filter of one `.base` text, or null when it claims nothing.
 * `this.file` inside its filters is the collection itself, as for the tab
 * and the CLI. OR over the views (each compiled as the tab compiles it:
 * notes-only AND global AND the view's own), so a note is a row when some
 * view would list it.
 */
export function compileCollection(path: string, text: string): CollectionQuery | null {
  const spec = parseCollection(text)
  if (spec.error) return null
  if (spec.filters === null && !spec.views.some((v) => v.filters !== null)) return null
  const scope = { thisPath: path }
  const views = spec.views.length ? spec.views : [EMPTY_VIEW]
  const parts: RowFilter[] = []
  for (const view of views) {
    const f = compileView(spec, view, scope).query.filter
    if (f) parts.push(f)
  }
  if (parts.length === 0) return null
  return { path, filter: parts.length === 1 ? parts[0]! : { op: 'or', args: parts } }
}

/**
 * The membership queries of every `.base` among `paths`, compiled once per
 * text when a `cache` is given: a file whose text has not changed since the
 * last ask is not parsed again, and a file that is gone leaves the cache.
 */
export function collectionQueries(
  paths: readonly string[],
  textOf: (path: string) => string | null,
  cache?: Map<string, CompiledCollection>
): CollectionQuery[] {
  const out: CollectionQuery[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    if (!isCollectionPath(path)) continue
    const text = textOf(path)
    if (text === null) continue
    seen.add(path)
    let compiled = cache?.get(path)
    if (!compiled || compiled.text !== text) {
      compiled = { text, query: compileCollection(path, text) }
      cache?.set(path, compiled)
    }
    if (compiled.query) out.push(compiled.query)
  }
  if (cache) for (const path of [...cache.keys()]) if (!seen.has(path)) cache.delete(path)
  return out
}

/** `filter AND file.path == path` — the one note, through the collection's own filter (the index answers it by lookup). */
function only(filter: RowFilter, path: string): RowFilter {
  return { op: 'and', args: [filter, { op: 'cmp', cmp: '==', left: { key: { file: 'path' } }, right: { lit: path } }] }
}

/**
 * Is the note at `path` a row of at least one of `queries`? Asked one
 * collection at a time, stopping at the first that claims it; `now` and the
 * zone are the reader's, as for every `rows()` call (golden rule 5: the
 * caller passes the instant).
 */
export async function inAnyCollection(
  index: VaultIndex,
  queries: readonly CollectionQuery[],
  path: string,
  now: number,
  tzOffsetMinutes: number
): Promise<boolean> {
  for (const q of queries) {
    const page = await index.rows({ filter: only(q.filter, path), now, tzOffsetMinutes }, { limit: 1 })
    if (page.items.length > 0) return true
  }
  return false
}

/** Every collection that claims the note — for a surface that names them. */
export async function collectionsOf(
  index: VaultIndex,
  queries: readonly CollectionQuery[],
  path: string,
  now: number,
  tzOffsetMinutes: number
): Promise<string[]> {
  const out: string[] = []
  for (const q of queries) {
    const page = await index.rows({ filter: only(q.filter, path), now, tzOffsetMinutes }, { limit: 1 })
    if (page.items.length > 0) out.push(q.path)
  }
  return out
}
