/**
 * L1 nested fuzz, seed 1430944294 (2026-09-10), shrunk from
 * `[deleteInside(a), deliver(1), carve(a), renameDir(a)]` to the three lines
 * below — and it turned out not to need a race at all. FIXED in
 * `adopt.ts` (`membershipFor`) + `mount-session.ts` (the pre-image now keeps
 * tombstones); this spec is the permanent regression.
 *
 * A deletes a note, everyone agrees it is gone, and then A carves the folder
 * that used to contain it. The peer's adopt computes membership as
 * "pre-image ∪ orphan LCA records under P" — and a delete tombstones the map
 * entry and removes the file but LEAVES the LCA record. The carve's own
 * transaction then hard-deletes the tombstone from the parent map, so by the
 * time the adopt runs there is nothing anywhere saying "deleted": the orphan
 * LCA reads as membership and the note comes back, alive, in the new room.
 *
 * What that looked like: `notes/deep.md` live in the mount's map on both
 * devices, materialized back onto the carver's disk from the doc, and a
 * `vanished` review on every other device — a note the user deleted,
 * reappearing the moment someone shares its folder.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo, carveOn, checkInvariants, diskSnapshot } from '../fixture.js'

const FILES: Record<string, string> = {
  'keep.md': '# keep\n',
  'team/plan.md': '# plan\n',
  'team/notes/deep.md': '# deep\n\nnested shared note\n',
}
const RELAY = 'ws://relay.test'
const ROOM = 'room-0'
const TOKEN = { url: RELAY, token: 'tok' }

describe('crasher 0007 — a carve must not resurrect a note deleted before it', () => {
  it('the deleted note stays deleted, in the room and on both disks', async () => {
    const duo = await bootDuo({
      files: FILES,
      tokensA: new Map([[ROOM, TOKEN]]),
      tokensB: new Map([[ROOM, TOKEN]]),
    })
    try {
      await duo.deliver()
      await duo.a.root.deletePath('team/notes/deep.md')
      await duo.deliver()
      const gone = await diskSnapshot(duo.a.adapter)
      expect(Object.keys(gone).sort()).toEqual(['keep.md', 'team/plan.md'])

      await carveOn(duo.a, { path: 'team', room: ROOM, token: 'tok' })
      await duo.deliver()

      for (const dev of [duo.a, duo.b]) {
        expect(dev.mounts.get('team')!.files().filter((r) => r.kind === 'text').map((r) => r.path))
          .toEqual(['plan.md'])
        expect(await diskSnapshot(dev.adapter)).toEqual(gone)
        expect(dev.events.reviews).toEqual([])
        checkInvariants(dev)
      }
    } finally {
      duo.dispose()
    }
  })
})
