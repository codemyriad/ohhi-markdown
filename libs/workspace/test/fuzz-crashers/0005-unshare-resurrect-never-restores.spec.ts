/**
 * L1 nested fuzz, seed -644926682 path 29:4:3:8:11:13:15:5:8:6:15:7:7:4:4:7:7:5:8:6
 * (2026-09-10), shrunk to `[carve(a), unshare(a), deleteInside(b)]`. SKIPPED:
 * the fix is in `libs/vault/src/session.ts`, outside slice N1's ownership.
 *
 * A carves `other/` and unshares it again. The unshare's announcement
 * (`announceAbsorb`) re-`set`s every subtree key on the LIVE map with its
 * original guid — that is how peers learn the subtree is back. B, which has
 * not seen either transaction, deletes `other/side.md`: a tombstone on the
 * same key, plus the file removed from B's disk.
 *
 * The two writes merge, and A's `set` wins the key. Both maps now agree the
 * file EXISTS. A has it on disk. B does not, and never will:
 *
 *  - `VaultSession.deleteFile` tombstones the entry but leaves the doc in
 *    `docs` and the LCA in the store.
 *  - The remote-change pass classifies the resurrected entry through the
 *    `!oldPath` branch ("new remote file"), whose body is guarded by
 *    `if (doc && !(await this.lcaStore.get(entry.guid)))`. B still has both,
 *    so nothing is subscribed, nothing is scheduled, and no materialize ever
 *    runs.
 *
 * End state: the map says the note is there, one device has it, the other
 * silently does not, and no review is raised on either side. The pass needs a
 * RESTORE branch — `previous.get(path)?.deleted && !entry.deleted` for a guid
 * we already hold — that drops the stale LCA and schedules a reconcile, the
 * same way a fresh remote entry does.
 *
 * Reachable outside mounts too (anything that re-`set`s a tombstoned key), but
 * N1 is where it is easy to hit: every unshare re-states the whole subtree.
 *
 * Until it is fixed the fuzz keeps one device at a time reshaping the tree
 * (see `reshaper` in `../l1-nested-fuzz.test.ts`), which also excludes this.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo, carveOn, dec, type BootedVault } from '../fixture.js'
import { unshareMount } from '../../src/unshare.js'

const FILES: Record<string, string> = {
  'keep.md': '# keep\n',
  'other/side.md': '# side\n\nanother folder\n',
}
const RELAY = 'ws://relay.test'
const ROOM = 'room-0'

describe.skip('crasher 0005 — a resurrected entry never comes back on the device that deleted it', () => {
  it('restores the file on both devices, or tombstones it on both', async () => {
    const duo = await bootDuo({
      files: FILES,
      tokensA: new Map([[ROOM, { url: RELAY, token: 'tok' }]]),
    })
    try {
      await duo.deliver()
      await carveOn(duo.a, { path: 'other', room: ROOM, token: 'tok' })
      const mount = duo.a.mounts.get('other')!
      duo.a.mounts.delete('other')
      await unshareMount({
        vaultDir: duo.a.vaultDir,
        mountsFile: duo.a.mountsFile,
        engine: duo.a.engine,
        rootRoom: 'root-room',
        desc: { room: ROOM, path: 'other' },
        mount,
        root: duo.a.root,
        removeIgnore: (p: string) => duo.a.ignore.delete(p),
      })
      await duo.a.rebuildRoot()
      await duo.a.refreshDescs()
      // B has seen none of that, and deletes the note.
      await duo.b.root.deletePath('other/side.md')
      await duo.deliver()

      const live = (dev: BootedVault): boolean =>
        dev.root.files().some((r) => r.path === 'other/side.md')
      expect(live(duo.a)).toBe(live(duo.b))
      const da = dec.decode((await duo.a.adapter.read('other/side.md')) ?? new Uint8Array())
      const db = dec.decode((await duo.b.adapter.read('other/side.md')) ?? new Uint8Array())
      expect(da).toBe(db)
    } finally {
      duo.dispose()
    }
  })
})
