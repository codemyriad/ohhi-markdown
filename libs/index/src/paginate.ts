/**
 * Paging, in one place. Every list in the index contract — and every list in
 * `@ohhi/agent`'s op contract, which imports this — carries
 * `{items, total, nextCursor}`, and the cursor is OPAQUE: it is produced here
 * and consumed here, and no caller may parse it.
 *
 * One implementation matters because the cursor crosses a package boundary:
 * a page the index produced and a page `ohhi ls` produced have to be resumable
 * by the same `--cursor` string.
 */
import type { Page, PageOptions } from './types.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 1000

const encodeCursor = (n: number): string => `o${n}`

const decodeCursor = (c: string | undefined): number => {
  if (!c || !c.startsWith('o')) return 0
  const n = Number.parseInt(c.slice(1), 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Slice `items` for one page. `total` is always known here. */
export function paginate<T>(items: T[], opts?: PageOptions): Page<T> {
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
