import { OP_SCHEMAS, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { normalizeVaultPath } from '../paths.js'

/**
 * `resolve` — where a wikilink target lands, by the editor's own rule (exact
 * path, then case-insensitive basename, tie-broken by proximity to `from`).
 * `null` is an answer, not an error: it is what `unresolved` is made of.
 */
export const resolve: OpDef<'resolve'> = {
  ...OP_SCHEMAS.resolve,
  async run(backend, input) {
    const index = await backend.index()
    const from = input.from === undefined ? undefined : normalizeVaultPath(input.from)
    return { schema: schemaName('resolve'), target: input.target, path: await index.resolve(input.target, from) }
  },
}
