/**
 * Paging, in one place. Every list in the contract carries
 * `{returned, total, nextCursor}` (contract rule 3), and the cursor is
 * OPAQUE — it is produced here and consumed here, and no caller may parse it.
 *
 * Two shapes exist because two kinds of list exist: lists the index already
 * paged for us (`Page<T>` from `@editor/index`), and lists this package built
 * itself (`ls`, `changes`, `restore --list`, the grep fallback).
 */
import type { Page } from '@editor/index'

export interface PageResult<T> {
  items: T[]
  returned: number
  total: number | null
  nextCursor: string | null
}

/** Same spelling the index uses, so a cursor looks the same wherever it came from. */
const encodeCursor = (n: number): string => `o${n}`

const decodeCursor = (cursor: string | undefined): number => {
  if (!cursor || !cursor.startsWith('o')) return 0
  const n = Number.parseInt(cursor.slice(1), 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export interface PageIn {
  limit?: number
  cursor?: string
}

/** Page an array this package built. `total` is always known here. */
export function paginate<T>(items: T[], opts: PageIn, defaultLimit = 50): PageResult<T> {
  const limit = Math.max(1, opts.limit ?? defaultLimit)
  const start = decodeCursor(opts.cursor)
  const slice = items.slice(start, start + limit)
  const end = start + slice.length
  return {
    items: slice,
    returned: slice.length,
    total: items.length,
    nextCursor: end < items.length ? encodeCursor(end) : null,
  }
}

/** Carry an index page through to the contract, mapping its items on the way. */
export function fromIndexPage<A, B>(page: Page<A>, map: (item: A) => B): PageResult<B> {
  const items = page.items.map(map)
  return { items, returned: items.length, total: page.total, nextCursor: page.nextCursor }
}
