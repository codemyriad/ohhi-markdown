import { OP_SCHEMAS, OpError, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { commit, openForWrite } from '../write-file.js'

/** Occurrences of a literal string — `split` counts what `replaceAll` would replace. */
const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1

/**
 * `patch` — replace one exact string, mcpvault's unique-match rule.
 *
 * Not-unique is REFUSED with the count rather than resolved by guessing which
 * occurrence was meant: the agent widens `--old` until it is unique, which
 * costs one round trip and cannot silently edit the wrong paragraph. Zero
 * occurrences is the same refusal with `occurrences: 0` — the note changed
 * under the agent, and the answer is to read it again.
 */
export const patch: OpDef<'patch'> = {
  ...OP_SCHEMAS.patch,
  async run(backend, input) {
    const note = await openForWrite(backend, input.path, input.expectHash)
    if (!note.exists) throw new OpError('not_found', `no such note: ${note.path}`, { path: note.path })
    const occurrences = countOf(note.text, input.old)
    if (occurrences === 0 || (occurrences > 1 && !input.all)) {
      throw new OpError(
        'refused',
        occurrences === 0
          ? `--old is not in ${note.path} — read it again`
          : `--old occurs ${occurrences} times in ${note.path} — widen it until it is unique, or pass --all`,
        { path: note.path, occurrences }
      )
    }
    const next = input.all
      ? note.text.split(input.old).join(input.new)
      : note.text.replace(input.old, () => input.new)
    const done = await commit(backend, note, next, input.dryRun ?? false)
    return {
      schema: schemaName('patch'),
      path: note.path,
      replaced: occurrences,
      hash: done.hash,
      journalSeq: done.journalSeq,
      dryRun: input.dryRun ?? false,
    }
  },
}
