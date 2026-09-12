import { OP_SCHEMAS, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { fromIndexPage } from '../paging.js'

/** `unresolved` — the note-creation queue. An unresolved EMBED is a missing attachment. */
export const unresolved: OpDef<'unresolved'> = {
  ...OP_SCHEMAS.unresolved,
  async run(backend, input) {
    const index = await backend.index()
    const page = fromIndexPage(await index.unresolved(input), (ref) => ({
      path: ref.path,
      target: ref.target,
      line: ref.line,
      context: ref.context,
      embed: ref.embed,
    }))
    return { schema: schemaName('unresolved'), links: page.items, returned: page.returned, total: page.total, nextCursor: page.nextCursor }
  },
}
