/**
 * L1 nested fuzz, seed 835532086 (2026-09-10), shrunk to four commands and
 * then to the two below. SKIPPED: the fix is in `libs/vault/src/session.ts`,
 * outside slice N1's ownership — it is a plain VaultSession bug that the
 * nested fixture happened to be the first harness to reach.
 *
 * A creates a note and renames it. Both updates reach B back to back — which
 * is exactly how a relay delivers them, and how `RoomNet.deliverAll` does.
 * B's `onRemoteMapChange` handles the rename by moving the file on disk, but
 * B has not MATERIALIZED it yet (the create's materialize is queued behind the
 * map scan), so `adapter.rename` throws `rename: missing n1.md`.
 *
 * Two consequences, one visible and one not:
 *
 *  - Visible: an error reaches the host for something the user did nothing
 *    wrong to cause.
 *  - Not visible, and the reason this is a bug rather than noise: the throw
 *    aborts `onRemoteMapChange` for the WHOLE transaction, so every entry
 *    after the failing one in that batch — other renames, remote deletions —
 *    is skipped. A rename batched with a delete can therefore leave a file on
 *    disk that the map says is gone. This repro converges (the later map scan
 *    materializes at the new path); a bigger batch need not.
 *
 * The fix is one branch in `VaultSession.renameFile`'s remote path: a source
 * that is not on disk is not an error, it is a file this device has not
 * written yet — skip the disk move and let materialization write it at the new
 * path. Un-skip this spec with that change.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo } from '../fixture.js'

describe.skip('crasher 0002 — a remote rename of a file this device has not materialized', () => {
  it('is not an error, and does not abort the rest of the remote-change pass', async () => {
    const duo = await bootDuo({ files: { 'keep.md': '# keep\n' } })
    try {
      await duo.deliver()
      await duo.a.root.createFile('', 'n1.md', 'hello\n')
      await duo.a.root.renamePath('n1.md', 'r2.md')
      await duo.deliver()

      expect(duo.b.root.files().map((r) => r.path)).toEqual(['keep.md', 'r2.md'])
      expect(duo.b.events.errors.map(String)).toEqual([])
    } finally {
      duo.dispose()
    }
  })
})
