/**
 * L1 nested fuzz, seed 1994878552 path 267:2:0:0:1:4:7:7:7:5:5 (2026-09-10),
 * shrunk to `[carve, sync, unshare, edit]` — and then, on the bench, to
 * something with no race in it at all. FIXED 2026-09-10; this spec is the
 * permanent regression.
 *
 * A carves `other/`, B adopts it, A unshares it again, everything is delivered
 * and B's absorb has completed (`B mounts: []`). Then A edits the note. A's
 * disk took the edit. B's never did:
 *
 *     A disk: "[m0]\\n# side\\n\\nanother folder\\n"
 *     B disk: "# side\\n\\nanother folder\\n"
 *
 * No partition, no crash, nothing in flight, no review on either side. After
 * an unshare round trip the two devices' copies of a note were simply no
 * longer connected, and every edit from then on was one-sided.
 *
 * Root cause: a SHUT-DOWN session finishing its map-work chain.
 * `MountSession`'s folder-map observer queues two things for one foreign
 * change — the mount-entry hook (which is the adopt/absorb machine) and then
 * its own `scanMap`. The peer's absorb runs INSIDE that hook: it shuts the
 * root down, folds the mount's stores back in, and rebuilds the root. Then the
 * queued `scanMap` ran — on the dead session, whose `docs` map `shutdown()`
 * had just cleared. It saw every entry in the map as a guid it had no doc for
 * and called `adoptEntry` on each:
 *
 *  - a NEVER_ON_DISK LCA record written over the one `absorbMount` had just
 *    copied into the root namespace, and
 *  - a fresh doc instance plus a relay provider for a guid the REBUILT session
 *    already owned — so the room's traffic went to an instance nobody reads
 *    and the live doc was left off the room.
 *
 * The fix is one flag: `MountSession.stopped`, set the instant teardown
 * begins, guarding the observer and both map-work entry points. Teardown is
 * called from the middle of a chain by design (the absorb, the re-key, the
 * re-point), so "no work after shutdown" has to be enforced, not assumed.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo, carveOn, dec } from '../fixture.js'
import { unshareMount } from '../../src/unshare.js'

const FILES: Record<string, string> = {
  'keep.md': '# keep\n',
  'other/side.md': '# side\n\nanother folder\n',
}
const RELAY = 'ws://relay.test'
const ROOM = 'room-0'
const TOKEN = { url: RELAY, token: 'tok' }

describe('crasher 0008 — after an unshare round trip, edits stop reaching the peer', () => {
  it('an edit on the owner still lands on the peer', async () => {
    const duo = await bootDuo({
      files: FILES,
      tokensA: new Map([[ROOM, TOKEN]]),
      tokensB: new Map([[ROOM, TOKEN]]),
    })
    try {
      await duo.deliver()
      await carveOn(duo.a, { path: 'other', room: ROOM, token: 'tok' })
      await duo.deliver()
      expect(duo.b.mounts.has('other')).toBe(true)

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
      await duo.deliver()
      expect([...duo.b.mounts.keys()]).toEqual([]) // B has absorbed too

      duo.a.root.docForPath('other/side.md')!.transact((t) => t.insert(0, '[m0]\n'), 'local')
      await duo.deliver()

      const read = async (dev: typeof duo.a): Promise<string> =>
        dec.decode((await dev.adapter.read('other/side.md')) ?? new Uint8Array())
      expect(await read(duo.a)).toContain('[m0]')
      expect(await read(duo.b)).toBe(await read(duo.a))
    } finally {
      duo.dispose()
    }
  })
})
