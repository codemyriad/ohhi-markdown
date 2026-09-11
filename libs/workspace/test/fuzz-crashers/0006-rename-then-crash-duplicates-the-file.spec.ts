/**
 * L1 nested fuzz (2026-09-10), shrunk to `[renameDir(a), crash(b), crash(a)]`
 * and then to the four lines below. STILL SKIPPED after the 2026-09-10
 * session.ts wave (crashers 0002/0004/0005): the remaining half of the fix is
 * in `MountSession.bootScan`/`enrollOne`, not in `libs/vault/src/session.ts`,
 * so it could not be reached this wave. No mount is involved at any point —
 * this is rename DURABILITY.
 *
 * ## What happens
 *
 * `VaultSession.renameDir` moves the bytes on disk first, writes the map
 * transaction second, and updates each child's LCA `path` third. Only the LCA
 * write is durable at that moment: the map's durability is `MountSession`'s
 * DEBOUNCED folder-blob flush. A crash in the window leaves three stores
 * disagreeing about one file:
 *
 *     durable map:  other/side.md = g_old        (pre-rename)
 *     durable LCA:  g_old -> path d0/side.md     (post-rename)
 *     disk:         d0/side.md                   (post-rename)
 *
 * The next boot's delta scan sees `d0/side.md` as a path no map entry claims
 * and enrolls it with a FRESH guid, so the map now carries the note twice —
 * `other/side.md = g_old` (a phantom: nothing is there) and
 * `d0/side.md = g_new`. Re-measured 2026-09-10 with the fixes above in place:
 *
 *     A map after reboot: d0 (dir, fresh), d0/side.md = g_new,
 *                         other (dir, g_old), other/side.md = g_old, keep.md
 *     A disk:             d0/side.md, content DOUBLED
 *
 * The doubling is the sharp end and it is new information: `g_old`'s LCA
 * still points at `d0/side.md`, so its reconcile three-way-merges the old
 * doc's text against the freshly enrolled file at the same path and
 * concatenates them. One rename plus one crash therefore corrupts the note's
 * CONTENT, not just the map — and the corruption then replicates to the peer,
 * which is why the two coarse assertions this file shipped with (one text
 * entry per note; identical disks) both PASS while the vault is broken. The
 * content assertion below is what actually pins the defect.
 *
 * The repro is TIMING-DEPENDENT and must stay skipped for that reason too:
 * `crash(dev, 0)` kills at the next store write, and which write that is
 * depends on microtask order between the debounced folder-blob flush and the
 * per-doc blob flushes. Measured 2026-09-10 over six runs of the assertion
 * below: 4 pass, 2 fail with the doubled content. Un-skipping it needs the
 * fix AND a deterministic kill point (a named write to cut at, rather than a
 * budget), or the fuzz lane's seeded driver.
 *
 * ## The fix, and why it is not here
 *
 * Journal-ordered rename, in two halves:
 *
 *  1. `libs/vault/src/session.ts` — journal the rename INTENT (a `{from, to}`
 *     record through `PreImageJournal`, or a dedicated rename journal) before
 *     `adapter.rename`/`adapter.renameDir` touches the bytes, and clear it
 *     once the folder blob carrying the map transaction is durable. That
 *     needs a durability signal session.ts does not have today: the blob
 *     flush lives in `MountSession`, debounced, and session.ts is handed only
 *     an `EngineDoc`. Adding the record alone would be a write nobody reads.
 *
 *  2. `MountSession.bootScan` / `enrollOne` — the reader. An out-of-map file
 *     must not be enrolled with a fresh guid while an LCA record already
 *     claims that exact path (or while its bytes hash-match an LCA at the
 *     journaled `from` path). It must be RE-KEYED onto the existing guid and
 *     the stale map key hard-deleted, which is the same move the ghost rule
 *     makes for a parent-map key under a mount root. `bootScan` belongs to
 *     `libs/workspace` and was another agent's file during this wave.
 *
 * Half (2) alone would fix this repro, because the surviving LCA record
 * already names the new path; half (1) is what makes it hold when the LCA
 * write is the one that is lost instead.
 *
 * Until then the nested fuzz leaves tree renames off by default —
 * `NESTED_FUZZ_RENAMES=1` turns them back on — and `nested.test.ts` covers the
 * rename paths N1 owns (the ghost rule's rename branch, S10 Q5 rows 3 and 4)
 * directly. See also crasher 0004, the other half of this lane, now fixed.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo, dec, diskSnapshot } from '../fixture.js'

const SIDE = '# side\n\nanother folder\n'

describe.skip('crasher 0006 — a rename interrupted by a crash duplicates the file', () => {
  it('leaves one entry per note, one copy of its bytes, and identical disks', async () => {
    const duo = await bootDuo({ files: { 'keep.md': '# keep\n', 'other/side.md': SIDE } })
    try {
      await duo.deliver()
      await duo.a.root.renamePath('other', 'd0')
      await duo.crash('b', 0)
      await duo.crash('a', 0)
      await duo.deliver()

      const paths = duo.a.root.files().filter((r) => r.kind === 'text').map((r) => r.path)
      expect(paths.sort()).toEqual(['d0/side.md', 'keep.md'])
      // The assertion that actually fails today: the note's bytes, once.
      expect(dec.decode((await duo.a.adapter.read('d0/side.md'))!)).toBe(SIDE)
      expect(await diskSnapshot(duo.a.adapter)).toEqual(await diskSnapshot(duo.b.adapter))
    } finally {
      duo.dispose()
    }
  })
})
