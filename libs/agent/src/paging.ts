/**
 * Paging, carried through from `@editor/index` (contract rule 3: every list
 * has `{returned, total, nextCursor}`).
 *
 * The slicing and the cursor spelling are the INDEX's — `paginate` there is
 * the one implementation, so a cursor from `ohhi ls` (a list this package
 * built) and a cursor from `ohhi search` (a page the index built) are the same
 * kind of opaque string and resume the same way. All this file adds is
 * `returned`, which the contract names and the index's `Page` does not.
 */
import { paginate as pageOf, type Page } from '@editor/index'

export interface PageResult<T> {
  items: T[]
  returned: number
  total: number | null
  nextCursor: string | null
}

export interface PageIn {
  limit?: number
  cursor?: string
}

/** Carry an index page through to the contract, mapping its items on the way. */
export function fromIndexPage<A, B>(page: Page<A>, map: (item: A) => B): PageResult<B> {
  const items = page.items.map(map)
  return { items, returned: items.length, total: page.total, nextCursor: page.nextCursor }
}

/** Page an array this package built itself (`ls`, `changes`). */
export const paginate = <T>(items: T[], opts: PageIn): PageResult<T> =>
  fromIndexPage(pageOf(items, opts), (item) => item)
