import { isCollectionPath, planCollectionMoves } from '@ohhi/collections'
import { applyLinkEdits, collectMoveRefs, planLinkRewrites, type LinkEdit } from '@ohhi/index'
import { readNote, type VaultBackend } from '../read.js'
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
 *
 * The plan goes to the trail (stderr) BEFORE the move: N+1 writes are not
 * one atomic act, and a crash between the move and the last rewrite must
 * leave the human a list of what was meant to change, not a silence.
 *
 * Collections follow too: a `.base` whose `file.inFolder("…")` or
 * `file.hasLink("…")` names what moves gets the same kind of byte edit
 * (`@ohhi/collections`' planner, the one the app runs), through the same
 * journaled write, reported in `rewrote` beside the notes — `links` then
 * counts the filter strings changed. Without it, renaming the folder a
 * collection reads leaves the collection empty.
 *
 * Reversing a move is `mv <to> <from>`, which follows the links back;
 * `restore <note>` reverts one note's text and leaves the move standing.
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
    if (!dryRun && plan.length > 0) {
      backend.trail?.(`plan: move ${from} -> ${to}, then update links in ${plan.length} note${plan.length === 1 ? '' : 's'}:`)
      for (const note of plan) {
        const n = note.edits.length
        const what = note.collection ? `filter${n === 1 ? '' : 's'}` : `link${n === 1 ? '' : 's'}`
        backend.trail?.(`plan: ${n} ${what} in ${note.path}`)
      }
    }
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
        const open = await openForWrite(backend, note.path, undefined, { allowCollection: note.collection })
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

/** One file to edit after the move: a note's links, or a collection's filter strings. */
interface PlannedEdit {
  path: string
  edits: LinkEdit[]
  collection: boolean
}

/**
 * The planners over this vault: every file's path (text and binary), the
 * index's refs, and every `.base` as it reads on disk now, before the move.
 */
async function planFor(backend: VaultBackend, from: string, to: string): Promise<PlannedEdit[]> {
  const paths = [...(await backend.files()).keys()]
  const refs = await collectMoveRefs(await backend.index(), paths, from, to)
  const notes = planLinkRewrites(refs, from, to, paths).map((n) => ({ path: n.path, edits: n.edits, collection: false }))
  const bases: { path: string; text: string }[] = []
  for (const path of paths.filter(isCollectionPath)) {
    const read = await readNote(backend, path)
    if (read) bases.push({ path, text: read.text })
  }
  const collections = planCollectionMoves(bases, from, to, paths).map((c) => ({ ...c, collection: true }))
  return [...notes, ...collections].sort((a, b) => a.path.localeCompare(b.path))
}
