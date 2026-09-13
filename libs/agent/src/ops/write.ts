import { OP_SCHEMAS, OpError, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { commit, openForWrite } from '../write-file.js'

/**
 * `write` — create or replace a whole note, journaled and atomic.
 *
 * The blunt instrument, and the skill says so: `patch` is what an agent
 * should reach for, because replacing a note it only partly read is how a
 * human's paragraph disappears. `expectHash` (exit 3) and `createOnly` are
 * the guards for the times it is genuinely the right tool.
 */
export const write: OpDef<'write'> = {
  ...OP_SCHEMAS.write,
  async run(backend, input) {
    const note = await openForWrite(backend, input.path, input.expectHash)
    if (input.createOnly && note.exists) {
      throw new OpError('refused', `${note.path} already exists — drop --create-only to replace it`, {
        path: note.path,
      })
    }
    const done = await commit(backend, note, input.text, input.dryRun ?? false)
    return {
      schema: schemaName('write'),
      path: note.path,
      created: done.created,
      bytes: done.bytes,
      hash: done.hash,
      journalSeq: done.journalSeq,
      dryRun: input.dryRun ?? false,
    }
  },
}
