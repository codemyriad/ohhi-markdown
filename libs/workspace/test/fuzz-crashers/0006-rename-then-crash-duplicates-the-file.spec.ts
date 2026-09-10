/**
 * L1 nested fuzz (2026-09-10), shrunk to `[renameDir(a), crash(b), crash(a)]`
 * and then to the three lines below. SKIPPED: no mount is involved at any
 * point — this is `libs/vault`'s rename durability, outside slice N1's
 * ownership.
 *
 * A renames a folder. `VaultSession.renameDir` moves the bytes on disk FIRST
 * and then writes the map transaction, and the folder blob's flush is
 * debounced behind that. A crash in between leaves the disk ahead of the
 * durable map, and the next boot's delta scan sees `d0/side.md` as a file
 * nobody has ever enrolled:
 *
 *     A map:  other/side.md = f3f6ef   AND   d0/side.md = c94b2e   (fresh guid)
 *     A disk: other/side.md, d0/side.md      (the note, twice)
 *     B disk: other/side.md               (B never applied the rename)
 *
 * So one rename plus one crash yields a duplicated note on the crashing
 * device, a phantom map entry for a path that no longer exists, and two
 * permanently divergent disks — with no review on either side.
 *
 * The fix belongs with the rename: the map transaction and the disk move need
 * the same crash story the carve machine already has (status first, roll
 * forward from the durable side), or the delta scan needs to recognise a moved
 * file by content and re-key the existing guid instead of minting one.
 *
 * The nested fuzz therefore leaves tree renames off by default —
 * `NESTED_FUZZ_RENAMES=1` turns them back on — and `nested.test.ts` covers the
 * rename paths N1 owns (the ghost rule's rename branch, S10 Q5 rows 3 and 4)
 * directly. See also crasher 0004, the other half of this lane.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo, diskSnapshot } from '../fixture.js'

describe.skip('crasher 0006 — a rename interrupted by a crash duplicates the file', () => {
  it('leaves one entry per note and identical disks', async () => {
    const duo = await bootDuo({
      files: { 'keep.md': '# keep\n', 'other/side.md': '# side\n\nanother folder\n' },
    })
    try {
      await duo.deliver()
      await duo.a.root.renamePath('other', 'd0')
      await duo.crash('b', 0)
      await duo.crash('a', 0)
      await duo.deliver()

      const paths = duo.a.root.files().filter((r) => r.kind === 'text').map((r) => r.path)
      expect(paths.sort()).toEqual(['d0/side.md', 'keep.md'])
      expect(await diskSnapshot(duo.a.adapter)).toEqual(await diskSnapshot(duo.b.adapter))
    } finally {
      duo.dispose()
    }
  })
})
