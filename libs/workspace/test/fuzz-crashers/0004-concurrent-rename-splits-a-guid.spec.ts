/**
 * L1 nested fuzz, seed -626309086 (2026-09-10), shrunk to
 * `[renameDir(a), renameFile(b), edit(a)]` and then to the two cases below.
 * SKIPPED: the fix is in `libs/vault/src/session.ts`, outside slice N1's
 * ownership. Nothing here involves a mount — the nested fuzz was simply the
 * first harness in the repo to generate concurrent renames (`l1-fuzz.test.ts`
 * has no rename command, and `dir-ops.test.ts` drives them one side at a
 * time).
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
 * rather than on the key — and that is `libs/vault`'s call.
 *
 * Until then the fuzz will not manufacture the window: two devices never
 * reshape a tree concurrently (see `reshaper` in `../l1-nested-fuzz.test.ts`).
 * That is also why this pair belongs in `libs/vault`'s own L1 lane once fixed.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo, diskSnapshot } from '../fixture.js'

const FILES = { 'keep.md': '# keep\n', 'dir/f.md': '# f\n' }

describe.skip('crasher 0004 — concurrent renames put one guid at two paths', () => {
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
