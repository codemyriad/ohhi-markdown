/**
 * S10 Q5 row 5, the PEER's half — found while writing the directed row-5
 * fixture on 2026-09-10 (not a fast-check seed: the duo scenario is the
 * counterexample). FIXED 2026-09-10 by the row-5 design decision; this spec is
 * the permanent regression.
 *
 * The scenario. A carves `team/`. B, still unaware, drags `team/plan.md` out
 * to `other/plan.md` (`renameDir`/`renameFile` in its ROOT map, guid g kept).
 * They meet. The ghost rule's move-out branch fires on both devices:
 * `other/plan.md` sits outside every mount root and carries a guid the mount
 * owns.
 *
 * What was wrong. The resolution said "re-enrol it at its new path with a
 * FRESH guid in the parent and `deletePath` it inside the mount; the bytes are
 * already at the destination, so no copy" — and on a PEER the bytes are not at
 * the destination. A never applied B's rename to disk (the source path is
 * under a mount boundary, so `onRemoteMapChange` skips it), so
 * `reenrollPath` → `enrollOne` read null and returned silently, and the
 * resolution degraded to "delete it inside the mount, leave the parent key
 * alone": guid g live in A's parent room and tombstoned in the mount, over an
 * EMPTY doc that only B could ever fill.
 *
 * Neither obvious repair worked alone. Carrying the bytes and re-enrolling on
 * BOTH devices mints a different g' per device over the same text and merges
 * them as the note twice (measured: 'shared plan\nshared plan\n'). Leaving it
 * converges only while the mover is reachable.
 *
 * The rule that fixes it: a cross-boundary move-out is performed by exactly
 * ONE device — the one whose disk already holds the bytes at the destination
 * (`adapter.read(dest) !== null`). It re-enrols with a fresh guid and
 * tombstones inside the mount; every other device does neither half and
 * receives both as ordinary map updates. What the other device DOES do is drop
 * its own parent-side doc/LCA/blob for the mount-owned guid, so the mover's
 * replacement does not land on top of a rival copy.
 *
 * The directed pair in `../nested.test.ts` runs the same row with the carver
 * on each device; this keeps the original repro.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo, carveOn, checkInvariants, dec } from '../fixture.js'

const FILES: Record<string, string> = {
  'keep.md': 'stays in the root vault\n',
  'team/plan.md': 'shared plan\n',
  'team/notes/deep.md': 'nested shared note\n',
}
const TEAM_ROOM = 'team-room'
const TEAM_TOKEN = { url: 'ws://relay.test', token: 'team-token' }

describe('crasher 0001 — a peer resolves a move-out of a file it still holds', () => {
  it('gives the parent a fresh guid, one copy of the text, and no guid in two rooms', async () => {
    const duo = await bootDuo({
      files: FILES,
      tokensA: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
      tokensB: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
    })
    try {
      await duo.deliver()
      const plan = duo.b.root.files().find((r) => r.path === 'team/plan.md')!.guid

      duo.net.setOffline('A', true)
      duo.net.setOffline('B', true)
      await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
      await duo.b.root.renamePath('team/plan.md', 'other/plan.md')
      duo.net.setOffline('A', false)
      duo.net.setOffline('B', false)
      await duo.deliver()

      for (const dev of [duo.a, duo.b]) {
        const moved = dev.root.files().find((r) => r.path === 'other/plan.md')!
        // Identity never crosses rooms: the guid the mount held is retired.
        expect(moved.guid).not.toBe(plan)
        // ...and the text is there exactly once.
        expect(dec.decode((await dev.adapter.read('other/plan.md'))!)).toBe(FILES['team/plan.md'])
        expect(dev.root.docForPath('other/plan.md')?.getText()).toBe(FILES['team/plan.md'])
        await checkInvariants(dev)
      }
    } finally {
      duo.dispose()
    }
  })
})
