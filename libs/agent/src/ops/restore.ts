import type { JournalEntry, JournalEntryInfo, PreImageJournal } from '@editor/vault'
import { hashBytes } from '@editor/vault'
import type { z } from 'zod'
import { OP_SCHEMAS, OpError, RestoreOut, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { normalizeVaultPath } from '../paths.js'
import { recordPreImage, writeSwapping } from '../write-file.js'

type Entry = NonNullable<z.infer<typeof RestoreOut>['entries']>[number]
type Source = Entry['source']

/**
 * `restore` — the command four docs promised and nothing implemented.
 *
 * It reads the UNION of two journals that never share a writer: this tool's
 * (`<dataDir>/vaults/<id>/journal/`) and the app's, when the caller pointed at
 * it (`--app-store <appData>/stores/<room>`). Separate directories, separate
 * sequence spaces — which is why `seq` is read together with `source`, and why
 * the listing prints both (Spike S11-Q4: per-path latest-of-either is enough;
 * no total order across journals is needed or invented here).
 *
 * A restore is itself journaled: the bytes currently on disk go into the
 * journal before the pre-image goes back, so restoring the wrong version is
 * one more `restore` away, never a loss.
 */
export const restore: OpDef<'restore'> = {
  ...OP_SCHEMAS.restore,
  async run(backend, input) {
    const path = normalizeVaultPath(input.path)
    const journals = sources(backend)
    const listed = (
      await Promise.all(
        journals.map(async ({ journal, source }) =>
          (await journal.list(path)).map((info) => ({ info, source, journal }))
        )
      )
    ).flat()
    // Newest first: what a caller wants is almost always "the one before now".
    listed.sort((a, b) => b.info.at - a.info.at || b.info.seq - a.info.seq)
    const dryRun = input.dryRun ?? false

    // `--list` ALWAYS succeeds: an empty list means an empty list (Cassini's
    // rule, shaping R7). "This note has no pre-images" is an answer — the
    // caller asked what is recoverable, not for a specific version — and
    // returning `not_found` would make an agent retry or invent a reason.
    // A restore with no candidate is a different question and still fails.
    if (input.list) {
      return { schema: schemaName('restore'), path, entries: listed.map((e) => describe(e.info, e.source)), dryRun }
    }
    if (listed.length === 0) {
      throw new OpError('not_found', `no pre-images for ${path} — nothing here has written it`, { path })
    }

    const candidates = input.source ? listed.filter((e) => e.source === input.source) : listed
    const chosen =
      input.seq === undefined ? candidates[0] : candidates.find((e) => e.info.seq === input.seq)
    if (!chosen) {
      throw new OpError('not_found', `no pre-image ${input.seq ?? 'latest'} for ${path} — ask for --list`, {
        path,
        ...(input.seq === undefined ? {} : { seq: input.seq }),
        ...(input.source === undefined ? {} : { source: input.source }),
      })
    }
    const entry = (await chosen.journal.entries(path)).find((e: JournalEntry) => e.seq === chosen.info.seq)
    if (!entry) throw new OpError('runtime', `pre-image ${chosen.info.seq} for ${path} is gone`)

    if (!dryRun) {
      const current = await backend.adapter.read(path)
      if (current) await recordPreImage(backend.journal, path, current)
      // The pre-image is the RAW BYTES that were on disk — its own EOL and BOM
      // travel with it, so a restore is byte-exact by construction. Written as
      // a compare-and-swap against what we just journaled: a restore that
      // overwrote somebody's concurrent save would put THEIR bytes in no
      // journal at all (S11 F1, the same window the reconciler closes).
      await writeSwapping(backend, path, entry.bytes, current ? hashBytes(current) : '')
    }
    return {
      schema: schemaName('restore'),
      path,
      restored: { seq: entry.seq, bytes: entry.bytes.length, hash: hashBytes(entry.bytes) },
      dryRun,
    }
  },
}

const describe = (info: JournalEntryInfo, source: Source): Entry => ({
  seq: info.seq,
  at: new Date(info.at).toISOString(),
  size: info.size,
  source,
})

function sources(backend: {
  journal: PreImageJournal
  appJournals: readonly PreImageJournal[]
}): { journal: PreImageJournal; source: Source }[] {
  return [
    { journal: backend.journal, source: 'cli' as const },
    ...backend.appJournals.map((journal) => ({ journal, source: 'app' as const })),
  ]
}
