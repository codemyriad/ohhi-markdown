import type { JournalEntryInfo } from '@editor/vault'
import type { z } from 'zod'
import { OP_SCHEMAS, ChangesOut, OpError, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { paginate } from '../paging.js'

type Change = z.infer<typeof ChangesOut>['changes'][number]

const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * `since` is either an ISO instant or `j<seq>` — a journal sequence from a
 * previous answer. Both are turned into the SAME pair of thresholds, because
 * the two sources of truth (disk mtimes and our own journal) have to be cut
 * at the same moment or a resumed agent sees a row twice or not at all.
 */
function parseSince(raw: string, entries: JournalEntryInfo[]): { ms: number; seq: number } {
  const asSeq = /^j(\d+)$/.exec(raw.trim())
  if (asSeq) {
    const seq = Number(asSeq[1])
    const at = entries.filter((e) => e.seq <= seq).reduce((max, e) => Math.max(max, e.at), 0)
    return { ms: at, seq }
  }
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) {
    throw new OpError('usage', `since must be an ISO-8601 instant or j<seq>, not: ${raw}`)
  }
  const seq = entries.filter((e) => e.at <= ms).reduce((max, e) => Math.max(max, e.seq), 0)
  return { ms, seq }
}

/**
 * `changes` — "what moved since I last looked", so an agent RESUMES instead of
 * re-reading the vault (shaping R4.1).
 *
 * Two sources, unioned into ONE row per path:
 *
 *  - disk mtimes, which see every writer including the user typing in Editor;
 *  - our own pre-image journal, which sees paths that are no longer on disk
 *    at all (an `rm`, the source side of an `mv`) and therefore have no mtime
 *    left to report.
 *
 * When a path is in both, the disk row wins the `kind` (it describes what is
 * there NOW) and keeps the journal's `seq`. `created` means we hold no
 * pre-image predating the file, which is exactly "nobody here wrote over
 * anything".
 *
 * This op does not build the index: resuming must be cheap or it will not be
 * done.
 */
export const changes: OpDef<'changes'> = {
  ...OP_SCHEMAS.changes,
  async run(backend, input) {
    const journaled = await backend.journal.list()
    const since = parseSince(input.since, journaled)
    const rows = new Map<string, Change>()

    // `list()` is in seq order, so the newest pre-image for a path lands last.
    for (const entry of journaled) {
      if (entry.seq <= since.seq) continue
      rows.set(entry.path, { path: entry.path, kind: 'journaled', at: iso(entry.at), seq: entry.seq })
    }

    const files = await backend.files()
    for (const file of files.values()) {
      const mtime = file.mtime
      if (mtime === null || mtime <= since.ms) continue
      const predating = journaled.filter((e) => e.path === file.path && e.at <= mtime)
      const seq = rows.get(file.path)?.seq ?? predating[predating.length - 1]?.seq
      rows.set(file.path, {
        path: file.path,
        kind: predating.length > 0 ? 'modified' : 'created',
        at: iso(mtime),
        ...(seq === undefined ? {} : { seq }),
      })
    }

    const sorted = [...rows.values()].sort((a, b) => a.at.localeCompare(b.at) || a.path.localeCompare(b.path))
    const page = paginate(sorted, input)
    // The cursor is the latest moment this answer covers — pass it back as
    // `since` and the next call starts exactly here.
    const latest = sorted.reduce((max, row) => Math.max(max, Date.parse(row.at)), since.ms)
    return {
      schema: schemaName('changes'),
      since: input.since,
      changes: page.items,
      cursorSince: iso(latest),
      returned: page.returned,
      total: page.total,
      nextCursor: page.nextCursor,
    }
  },
}
