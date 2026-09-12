import { OP_SCHEMAS, OpError, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { isUnder, normalizeVaultPath } from '../paths.js'
import { countFilesUnder, requireConfirmation, resolveTarget } from './move.js'

/**
 * `mv` — rename or move a note or a folder.
 *
 * The journal follows the path (`journal.rename`), or a note's recoverable
 * history would end at its old name: the pre-images stay on disk under a name
 * nothing will ever ask for again. Journal first, then the disk move — the
 * same order every write in this package uses, so a crash in between leaves
 * history pointing forward, never nowhere.
 */
export const mv: OpDef<'mv'> = {
  ...OP_SCHEMAS.mv,
  async run(backend, input) {
    const from = normalizeVaultPath(input.from)
    const to = normalizeVaultPath(input.to)
    const source = await resolveTarget(backend, from)
    if (isUnder(from, to)) throw new OpError('refused', `cannot move ${from} into itself`, { from, to })
    if ((await backend.exists(to)) !== null) {
      throw new OpError('refused', `${to} already exists`, { to })
    }
    const files = source.kind === 'file' ? 1 : await countFilesUnder(backend, from)
    requireConfirmation(files, input.yes ?? false, `moving ${files} files`)

    const dryRun = input.dryRun ?? false
    if (!dryRun) {
      await backend.journal.rename(from, to)
      if (source.kind === 'file') await backend.adapter.rename(from, to)
      else await backend.adapter.renameDir(from, to)
    }
    return { schema: schemaName('mv'), from, to, files, dryRun }
  },
}
