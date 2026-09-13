import { OP_SCHEMAS, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'

/**
 * `stats` — the setup check, and the honesty counters behind every other
 * answer: what was indexed, what was skipped, what is never looked at.
 */
export const stats: OpDef<'stats'> = {
  ...OP_SCHEMAS.stats,
  async run(backend) {
    const index = await backend.index()
    const [figures, coverage, buildMs] = await Promise.all([
      index.stats(),
      backend.coverage(),
      backend.buildMs(),
    ])
    return {
      schema: schemaName('stats'),
      vault: backend.root,
      docs: figures.docs,
      terms: figures.terms,
      links: figures.links,
      unresolved: figures.unresolved,
      tags: figures.tags,
      skippedBinary: coverage.skippedBinary,
      ignored: coverage.ignored,
      buildMs,
      indexSchemaVersion: figures.schemaVersion,
    }
  },
}
