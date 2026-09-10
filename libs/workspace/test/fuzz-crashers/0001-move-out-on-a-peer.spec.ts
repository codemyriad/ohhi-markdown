/**
 * S10 Q5 row 5, the PEER's half — found while writing the directed row-5
 * fixture on 2026-09-10 (not a fast-check seed: the duo scenario is the
 * counterexample). SKIPPED: the fix is a design decision, not a local bug.
 *
 * The scenario. A carves `team/`. B, still unaware, drags `team/plan.md` out
 * to `other/plan.md` (`renameDir`/`renameFile` in its ROOT map, guid g kept).
 * They meet. On A the ghost rule's move-out branch fires: `other/plan.md` sits
 * outside every mount root and carries a guid A's mount owns.
 *
 * What the resolution says (spike S10 Q5): "re-enrol it at its new path with a
 * FRESH guid in the parent — content identity never crosses rooms — and
 * `deletePath` it inside the mount. Bytes are already at the destination, so
 * no copy."
 *
 * What is true on a peer: the bytes are NOT at the destination. They are still
 * under the mount root, because A never applied B's rename to disk (the source
 * path is under a mount boundary, so `onRemoteMapChange` skips it). So
 * `reenrollPath` → `enrollOne` reads null and returns silently, and the
 * resolution degrades to "delete it inside the mount, leave the parent key
 * alone". End state on A: guid g live in the parent room and tombstoned in the
 * mount room, with A's parent doc for g EMPTY — the content only reaches A
 * because B is around to serve it over the parent room's channel.
 *
 * Neither obvious fix is safe on its own, which is why this is a design
 * question:
 *
 *  - **Carry the bytes and re-enrol anyway** (mint g' on A, write the file at
 *    the destination). Then B — which already holds `other/plan.md` on disk
 *    with its own doc — adopts g', invents an empty doc plus a NEVER_ON_DISK
 *    LCA, and the reconciler's disk-changed branch ingests B's identical disk
 *    copy into it. A's g' and B's g' are two independent histories over the
 *    same text, and they merge as the note's text TWICE. Measured: the assert
 *    below fails with 'shared plan\nshared plan\n'. That is the two-bridge
 *    double-ingestion hazard, arriving through a new door.
 *  - **Leave it as it is** (today's behaviour). Converges, content correct
 *    while the mover is reachable — but identity crossed rooms, and a device
 *    that adopts the entry with no peer holding g in the parent room
 *    materializes nothing at all: the file is deleted from under the mount
 *    root and never written at the destination.
 *
 * The real fix belongs one level down — adopting a map entry for a path whose
 * file is already on disk must not blind-ingest into an empty doc — and that
 * is `libs/vault`'s reconciler, i.e. outside N1. Un-skipping this spec is the
 * acceptance test for whichever way that goes.
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

describe.skip('crasher 0001 — a peer resolves a move-out of a file it still holds', () => {
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
        checkInvariants(dev)
      }
    } finally {
      duo.dispose()
    }
  })
})
