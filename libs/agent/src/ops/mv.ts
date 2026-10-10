import { applyLinkEdits, collectMoveRefs, planLinkRewrites, type LinkRewrite } from '@ohhi/index'
import type { VaultBackend } from '../backend.js'
import { OP_SCHEMAS, OpError, schemaName, type OpOutput } from '../contract.js'
import type { OpDef } from '../op.js'
import { isUnder, normalizeVaultPath } from '../paths.js'
import { commit, openForWrite } from '../write-file.js'
import { filesUnder, requireConfirmation, resolveTarget } from './move.js'

/**
 * `mv` — rename or move a note or a folder, and make the vault's links
 * follow it (bases-shaping A5.1, collections DB6).
 *
 * The journal follows the path (`journal.rename`), or a note's recoverable
 * history would end at its old name: the pre-images stay on disk under a name
 * nothing will ever ask for again. Journal first, then the disk move — the
 * same order every write in this package uses, so a crash in between leaves
 * history pointing forward, never nowhere.
 *
 * Links: the index names every note that links to what moves
 * (`collectMoveRefs`), the shared planner (`planLinkRewrites`, the same one
 * the app runs) says which written targets the move breaks and the byte edit
 * that mends each, and every referencing note then goes through the ONE
 * journaled write path on its own — its own pre-image, its own
 * compare-and-swap — AFTER the move, so a note that loses a race is reported
 * in `skipped` with nothing written to it, while the move and the other
 * notes stand. The breaker counts those notes with the files moved: a
 * rename that would rewrite 24 notes is a burst, whatever moved. `keepLinks`
 * skips all of it; `dryRun` plans and reports and writes nothing.
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
    const files = source.kind === 'file' ? 1 : (await filesUnder(backend, from)).length
    const keepLinks = input.keepLinks ?? false
    const plan = keepLinks ? [] : await planFor(backend, from, to)
    const what = plan.length
      ? `moving ${files} file${files === 1 ? '' : 's'} and rewriting links in ${plan.length} note${plan.length === 1 ? '' : 's'}`
      : `moving ${files} file${files === 1 ? '' : 's'}`
    requireConfirmation(files + plan.length, input.yes ?? false, what)

    const dryRun = input.dryRun ?? false
    if (!dryRun) {
      await backend.journal.rename(from, to)
      if (source.kind === 'file') await backend.adapter.rename(from, to)
      else await backend.adapter.renameDir(from, to)
    }

    const rewrote: OpOutput<'mv'>['rewrote'] = []
    const skipped: OpOutput<'mv'>['skipped'] = []
    for (const note of plan) {
      const links = note.edits.length
      try {
        // A fresh read from disk at the note's post-move path — never the
        // walk's copy — so the pre-image journaled is what is there now.
        const open = await openForWrite(backend, note.path)
        if (!open.exists) {
          skipped.push({ path: note.path, links, reason: 'not_found' })
          continue
        }
        const next = applyLinkEdits(open.text, note.edits)
        if (next === null) {
          skipped.push({ path: note.path, links, reason: 'unaddressable' })
          continue
        }
        const done = await commit(backend, open, next, dryRun)
        // The hash ON DISK: after the write, or unchanged on a dry run.
        rewrote.push({ path: note.path, links, hash: dryRun ? (open.hash ?? '') : done.hash, journalSeq: done.journalSeq })
      } catch (err) {
        if (err instanceof OpError && (err.code === 'conflict' || err.code === 'refused')) {
          skipped.push({ path: note.path, links, reason: err.code })
          continue
        }
        throw err
      }
    }
    return { schema: schemaName('mv'), from, to, files, rewrote, skipped, keepLinks, dryRun }
  },
}

/** The planner over this vault: every file's path (text and binary), the index's refs. */
async function planFor(backend: VaultBackend, from: string, to: string): Promise<LinkRewrite[]> {
  const paths = [...(await backend.files()).keys()]
  const refs = await collectMoveRefs(await backend.index(), paths, from)
  return planLinkRewrites(refs, from, to, paths)
}
