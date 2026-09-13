import { OP_SCHEMAS, OpError, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { fromIndexPage } from '../paging.js'
import { normalizeVaultPath } from '../paths.js'

/** `links` — what this note points at, and whether it lands. */
export const links: OpDef<'links'> = {
  ...OP_SCHEMAS.links,
  async run(backend, input) {
    const path = normalizeVaultPath(input.path)
    const docs = await backend.docs()
    if (!docs.has(path)) throw new OpError('not_found', `no such note: ${path}`, { path })
    const index = await backend.index()
    // guid === path in the files-direct backend: there are no CRDT guids here.
    const page = fromIndexPage(await index.outgoing(path, input), (ref) => ({
      target: ref.target,
      alias: ref.alias,
      anchor: ref.anchor,
      embed: ref.embed,
      resolved: ref.resolved,
      line: ref.line,
      context: ref.context,
    }))
    return { schema: schemaName('links'), path, links: page.items, returned: page.returned, total: page.total, nextCursor: page.nextCursor }
  },
}
