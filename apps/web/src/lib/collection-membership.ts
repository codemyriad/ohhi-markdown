/**
 * Which notes are rows (bases-shaping A7, Fork 3-B): a note "belongs to a
 * collection" when some `.base` file's GLOBAL filters — plus the implicit
 * notes-only rule every compiled view carries — match it. The question is
 * asked of the index, with the same compiler the collection tab and
 * `ohhi rows` use, so the form at the top of a note and the table that
 * lists it can never disagree about membership. Pure: the shell decides
 * when to ask (coalesced on its clock) and what to do with the answer.
 */
import { compileView, isCollectionPath, parseCollection, type ViewSpec } from '@ohhi/collections'
import type { RowFilter, VaultIndex } from '@ohhi/index'

/**
 * A collection with no `views:` is still a query: its global filters apply
 * through this empty view (as `ohhi rows` does), so a file with filters and
 * no views still claims its notes.
 */
const EMPTY_VIEW: ViewSpec = { index: -1, type: 'table', name: '', filters: null, order: [], sort: [], groupBy: null, limit: null, columnSize: {}, extra: {} }

/** One collection's membership test: the file, and its global filter compiled. */
export interface CollectionQuery {
  path: string
  filter: RowFilter
}

/**
 * The membership queries of every readable `.base` among `paths`. A file
 * whose YAML does not parse claims nothing (the tab says why; this stays
 * quiet); `this.file` inside its filters is the collection itself, as for
 * the tab and the CLI.
 */
export function collectionQueries(paths: readonly string[], textOf: (path: string) => string | null): CollectionQuery[] {
  const out: CollectionQuery[] = []
  for (const path of paths) {
    if (!isCollectionPath(path)) continue
    const text = textOf(path)
    if (text === null) continue
    const spec = parseCollection(text)
    if (spec.error) continue
    const compiled = compileView(spec, EMPTY_VIEW, { thisPath: path })
    if (compiled.query.filter) out.push({ path, filter: compiled.query.filter })
  }
  return out
}

/** `filter AND file.path == path` — the one note, through the collection's own filter. */
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
