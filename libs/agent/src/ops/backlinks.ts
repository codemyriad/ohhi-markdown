import { OP_SCHEMAS, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { fromIndexPage } from '../paging.js'

/**
 * `backlinks` — who points here. The target is a vault path OR a bare note
 * name, exactly as a wikilink writes it, because that is what an agent has in
 * hand after reading one.
 */
export const backlinks: OpDef<'backlinks'> = {
  ...OP_SCHEMAS.backlinks,
  async run(backend, input) {
    const index = await backend.index()
    const page = fromIndexPage(await index.backlinks(input.target, input), (ref) => ({
      path: ref.path,
      line: ref.line,
      context: ref.context,
      alias: ref.alias,
      anchor: ref.anchor,
    }))
    return { schema: schemaName('backlinks'), target: input.target, backlinks: page.items, returned: page.returned, total: page.total, nextCursor: page.nextCursor }
  },
}
