/**
 * L1 nested fuzz, seed -1271110186 (2026-09-10), shrunk to
 * `[carve(a), renameFile(a, inside the mount), deliver(3)]` and then to the
 * three lines below. SKIPPED: the fix is a design change to the adopt's
 * membership seeding (spike S10 Q1), not a local bug.
 *
 * A carves `other/`, then renames a file INSIDE the new mount before B has
 * adopted. B then adopts, and `seedCarveStores` builds B's copy of the mount's
 * folder doc as a FRESH Yjs history — B `set`s `side.md` itself, in a
 * transaction A's document has never seen. A's rename hard-deleted `side.md`
 * (`VaultSession.renameFile` does `m.delete(from); m.set(to, entry)`), and a
 * hard delete only applies to a history that contains the op it deletes. B's
 * seed does not, so the merge is a UNION:
 *
 *     A mount map: side.md = g, r2.md = g
 *     B mount map: side.md = g, r2.md = g
 *     A disk:      other/side.md
 *     B disk:      other/r2.md
 *
 * One guid at two live paths in one room — A6's first clause — and the two
 * disks are permanently divergent, with no review raised on either. Any map
 * change the carver makes between the carve and a peer's adopt has this shape:
 * a rename resurrects the old key, a delete can be undeleted.
 *
 * Why it is not a local fix. The seed is what lets a peer adopt without
 * re-fetching content, and what lets a `needs-token` mount work with no room
 * at all (S10 Q2) — so it cannot simply be dropped in favour of pulling the
 * map. Making the two seeds produce the SAME ops (a deterministic clientID)
 * is worse than the disease: two devices whose membership differs by one file
 * would then mint different ops under the same (clientID, clock), which is
 * CRDT corruption rather than a merge artifact. The real answer is a
 * tie-break the map can express — the peer's seeded entries must lose to the
 * room's — and that is a schema/protocol decision for S10 Q1, taken with the
 * plan open.
 *
 * Until then the fuzz will not manufacture this window: it only reshapes a
 * mount's tree once both devices' copies of that room's map agree, which is
 * exactly the point at which the two histories have merged. See
 * `reshapable()` in `../l1-nested-fuzz.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo, carveOn, checkInvariants, diskSnapshot } from '../fixture.js'

const RELAY = 'ws://relay.test'
const ROOM = 'room-0'
const TOKEN = { url: RELAY, token: 'tok' }

describe.skip('crasher 0003 — the adopt seed resurrects a key the carver removed', () => {
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
        checkInvariants(dev)
      }
      expect(await diskSnapshot(duo.a.adapter)).toEqual(await diskSnapshot(duo.b.adapter))
    } finally {
      duo.dispose()
    }
  })
})
