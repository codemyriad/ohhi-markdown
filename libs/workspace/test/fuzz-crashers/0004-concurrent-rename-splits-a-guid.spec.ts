/**
 * L1 nested fuzz, seed -626309086 (2026-09-10), shrunk to
 * `[renameDir(a), renameFile(b), edit(a)]` and then to the two cases below.
 * FIXED 2026-09-10 in `libs/vault/src/session.ts`. Nothing here involves a
 * mount — the nested fuzz was simply the first harness in the repo to
 * generate concurrent renames (`l1-fuzz.test.ts` has no rename command, and
 * `dir-ops.test.ts` drives them one side at a time).
 *
 * `renameFile` and `renameDir` both write `m.delete(from); m.set(to, entry)`
 * with the SAME guid. Two peers doing that concurrently produces a union: the
 * guid ends up at BOTH new paths in both maps, which is A6's first clause
 * ("every guid in exactly one map, at one path"). Worse, each device's
 * reconciler then resolves that pair differently and the DISKS diverge, with
 * no review raised on either side:
 *
 *   case 1 — A renames the dir, B renames a file inside it:
 *     both maps: moved/f.md = g AND dir/g.md = g
 *     A disk: dir/g.md          B disk: moved/f.md
 *
 *   case 2 — both rename the same file:
 *     both maps: dir/x.md = g AND dir/y.md = g
 *     A disk: dir/y.md          B disk: dir/x.md
 *
 * A rename's source removal is a HARD delete, which is right for a live peer
 * (it reconstructs the move from `lastEntries`) and wrong for a concurrent
 * one, which has a competing `set` the delete never saw. Rename-vs-rename
 * needs a resolution the map can express — last-writer-wins on the guid
 * rather than on the key.
 *
 * THE RULE (`VaultSession.dedupeGuidKeys`, run over the merged map before any
 * disk effect is derived): when one guid holds two or more live keys, the
 * **lexicographically greatest path wins** — UTF-16 code-unit order, the
 * order `<`/`>` give — and every other key is HARD-deleted.
 *
 * Why that rule and not "the map's own last item": `MapHandle` exposes
 * `get`/`set`/`delete`/`entries` and nothing else — no item id, no per-key
 * clock — and a Y.Map's iteration order is its local integration order, which
 * two peers need not share. The path comparison is computed from the MERGED
 * key set, which both peers do share, so both elect the same survivor without
 * any engine support. Hard-deleted rather than tombstoned for the ghost
 * rule's reason (S10 Q5): a tombstone tells peers to remove the bytes, and
 * the bytes belong to the survivor.
 *
 * The fuzz still does not manufacture the window (two devices never reshape a
 * tree concurrently — see `reshaper` in `../l1-nested-fuzz.test.ts`); these
 * two cases drive it directly, and the pair belongs in `libs/vault`'s own L1
 * lane whenever that lane grows a rename command.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo, diskSnapshot } from '../fixture.js'

const FILES = { 'keep.md': '# keep\n', 'dir/f.md': '# f\n' }

describe('crasher 0004 — concurrent renames put one guid at two paths', () => {
  it('case 1: renameDir races renameFile inside it', async () => {
    const duo = await bootDuo({ files: FILES })
    try {
      await duo.deliver()
      duo.net.setOffline('A', true)
      duo.net.setOffline('B', true)
      await duo.a.root.renamePath('dir', 'moved')
      await duo.b.root.renamePath('dir/f.md', 'dir/g.md')
      duo.net.setOffline('A', false)
      duo.net.setOffline('B', false)
      await duo.deliver()

      const guids = duo.a.root.files().filter((r) => r.kind === 'text').map((r) => r.guid)
      expect(new Set(guids).size).toBe(guids.length) // one guid, one path
      expect(await diskSnapshot(duo.a.adapter)).toEqual(await diskSnapshot(duo.b.adapter))
    } finally {
      duo.dispose()
    }
  })

  it('case 2: both devices rename the same file', async () => {
    const duo = await bootDuo({ files: FILES })
    try {
      await duo.deliver()
      duo.net.setOffline('A', true)
      duo.net.setOffline('B', true)
      await duo.a.root.renamePath('dir/f.md', 'dir/x.md')
      await duo.b.root.renamePath('dir/f.md', 'dir/y.md')
      duo.net.setOffline('A', false)
      duo.net.setOffline('B', false)
      await duo.deliver()

      const guids = duo.a.root.files().filter((r) => r.kind === 'text').map((r) => r.guid)
      expect(new Set(guids).size).toBe(guids.length)
      expect(await diskSnapshot(duo.a.adapter)).toEqual(await diskSnapshot(duo.b.adapter))
    } finally {
      duo.dispose()
    }
  })
})
