import { OP_SCHEMAS, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { fromIndexPage } from '../paging.js'

/** `tags` — tags with the number of NOTES carrying each (not occurrences). */
export const tags: OpDef<'tags'> = {
  ...OP_SCHEMAS.tags,
  async run(backend, input) {
    const index = await backend.index()
    const page = fromIndexPage(await index.tags(input), (t) => ({ tag: t.tag, notes: t.count }))
    return { schema: schemaName('tags'), tags: page.items, returned: page.returned, total: page.total, nextCursor: page.nextCursor }
  },
}
