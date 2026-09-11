/**
 * L1 nested fuzz, seed -644926682 path 29:4:3:8:11:13:15:5:8:6:15:7:7:4:4:7:7:5:8:6
 * (2026-09-10), shrunk to `[carve(a), unshare(a), deleteInside(b)]`. FIXED
 * 2026-09-10 in `libs/vault/src/session.ts` (`onRemoteMapChange`).
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
 * End state was: the map says the note is there, one device has it, the other
 * silently does not, and no review is raised on either side.
 *
 * THE FIX — a RESTORE branch in the remote-change pass, ahead of the
 * "new remote file" one: an entry whose PREVIOUS state at that guid's old key
 * was `deleted` and whose current state is not is a resurrection. Its LCA is
 * re-put at the CURRENT path with `contentHash: NEVER_ON_DISK`, so the
 * reconciler materializes the doc's content back onto disk exactly as it does
 * for a fresh remote entry. The doc itself is untouched and already
 * subscribed — `deleteFile` never dropped it, which is precisely why the
 * `!oldPath` guard used to swallow the case.
 *
 * Reachable outside mounts too (anything that re-`set`s a tombstoned key), but
 * N1 is where it is easy to hit: every unshare re-states the whole subtree.
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

describe('crasher 0005 — a resurrected entry never comes back on the device that deleted it', () => {
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
