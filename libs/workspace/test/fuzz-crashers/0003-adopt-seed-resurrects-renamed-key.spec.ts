/**
 * L1 nested fuzz, seed -1271110186 (2026-09-10), shrunk to
 * `[carve(a), renameFile(a, inside the mount), deliver(3)]` and then to the
 * three lines below. FIXED 2026-09-10 by the announced SEED (spike S10 Q1);
 * this spec is the permanent regression.
 *
 * A carves `other/`, then renames a file INSIDE the new mount before B has
 * adopted. B then adopts, and `seedCarveStores` used to build B's copy of the
 * mount's folder doc as a FRESH Yjs history — B `set` `side.md` itself, in a
 * transaction A's document had never seen. A's rename hard-deleted `side.md`
 * (`VaultSession.renameFile` does `m.delete(from); m.set(to, entry)`), and a
 * hard delete only applies to a history that contains the op it deletes. B's
 * seed did not, so the merge was a UNION:
 *
 *     A mount map: side.md = g, r2.md = g
 *     B mount map: side.md = g, r2.md = g
 *     A disk:      other/side.md
 *     B disk:      other/r2.md
 *
 * One guid at two live paths in one room — A6's first clause — and two
 * permanently divergent disks, with no review raised on either. Any map change
 * the carver made between the carve and a peer's adopt had this shape: a
 * rename resurrected the old key, a delete could be undeleted.
 *
 * The fix. The carver's seeded folder-doc state travels WITH the
 * announcement — `FileEntry.seed`, base64 of
 * `encodeUpdateSince(mountFolderDoc, null)`, written in the same transaction
 * as the `kind:'mount'` entry — and every peer seeds by APPLYING that update
 * to a fresh doc. One history on every device, so a hard delete anywhere
 * deletes everywhere. Membership comes from the seeded map, which also ends
 * the orphan-LCA resurrection class (crasher 0007's shape). Above a 64 KB cap
 * the seed is omitted and the peer pulls the room instead; a peer that pulls
 * gets the room's own history, which is the same guarantee by another route.
 *
 * The alternatives, recorded as rejected: dropping the seed in favour of
 * always pulling breaks the `needs-token` mount, which must work with no room
 * at all (S10 Q2); making the two seeds produce identical ops via a
 * deterministic clientID is CRDT corruption the moment two devices' membership
 * differs by one file.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo, carveOn, checkInvariants, diskSnapshot } from '../fixture.js'

const RELAY = 'ws://relay.test'
const ROOM = 'room-0'
const TOKEN = { url: RELAY, token: 'tok' }

describe('crasher 0003 — the adopt seed resurrects a key the carver removed', () => {
  it('leaves one guid at one path, and the two disks identical', async () => {
    const duo = await bootDuo({
      files: { 'keep.md': '# keep\n', 'other/side.md': '# side\n' },
      tokensA: new Map([[ROOM, TOKEN]]),
      tokensB: new Map([[ROOM, TOKEN]]),
    })
    try {
      await duo.deliver()
      duo.net.setOffline('B', true)
      await carveOn(duo.a, { path: 'other', room: ROOM, token: 'tok' })
      await duo.a.mounts.get('other')!.renamePath('side.md', 'r2.md')
      duo.net.setOffline('B', false)
      await duo.deliver()

      for (const dev of [duo.a, duo.b]) {
        expect(dev.mounts.get('other')!.files().map((r) => r.path)).toEqual(['r2.md'])
        await checkInvariants(dev)
      }
      expect(await diskSnapshot(duo.a.adapter)).toEqual(await diskSnapshot(duo.b.adapter))
    } finally {
      duo.dispose()
    }
  })
})
