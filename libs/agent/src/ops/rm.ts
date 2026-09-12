import { OP_SCHEMAS, OpError, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { dirOf, normalizeVaultPath, splitExtension } from '../paths.js'
import { recordPreImage } from '../write-file.js'
import { countFilesUnder, filesUnder, requireConfirmation, resolveTarget } from './move.js'

/** Obsidian's convention, and the one a user already knows how to undo by hand. */
const TRASH = '.trash'

/**
 * `rm` — move to `.trash/`, NEVER unlink (golden rule 1: Editor never holds
 * the only copy, and it never destroys the user's either).
 *
 * Two recoveries, deliberately: the file itself is sitting in `.trash/<path>`
 * where a user can drag it back, and a pre-image of every removed note is in
 * the journal under its ORIGINAL path, so `ohhi restore <path>` puts it back
 * where it was. The journal is NOT re-keyed to the trash path for exactly
 * that reason — unlike `mv`, where the note is still the note and its history
 * should follow it.
 */
export const rm: OpDef<'rm'> = {
  ...OP_SCHEMAS.rm,
  async run(backend, input) {
    const path = normalizeVaultPath(input.path)
    const target = await resolveTarget(backend, path)
    const files = target.kind === 'file' ? 1 : await countFilesUnder(backend, path)
    requireConfirmation(files, input.yes ?? false, `removing ${files} files`)
    const trashedTo = await freeTrashPath(backend, path)
    const dryRun = input.dryRun ?? false

    if (!dryRun) {
      for (const doomed of await filesUnder(backend, path)) {
        const bytes = await backend.adapter.read(doomed)
        if (bytes) await recordPreImage(backend.journal, doomed, bytes)
      }
      await backend.adapter.mkdir(dirOf(trashedTo))
      if (target.kind === 'file') await backend.adapter.rename(path, trashedTo)
      else await backend.adapter.renameDir(path, trashedTo)
    }
    return { schema: schemaName('rm'), path, trashedTo, files, dryRun }
  },
}

/**
 * `.trash/<path>`, with `~1`, `~2`… before the extension when that name is
 * taken — `Notes~1.md` stays a markdown file a user can open, which
 * `Notes.md~1` would not.
 */
async function freeTrashPath(backend: { exists(path: string): Promise<unknown> }, path: string): Promise<string> {
  const base = `${TRASH}/${path}`
  if ((await backend.exists(base)) === null) return base
  const { stem, ext } = splitExtension(base)
  for (let n = 1; n < 1000; n++) {
    const candidate = `${stem}~${n}${ext}`
    if ((await backend.exists(candidate)) === null) return candidate
  }
  throw new OpError('runtime', `${base} and 999 variants of it are all taken in ${TRASH}/`)
}
