/**
 * L1 nested fuzz, seed 1994878552 path 267:2:0:0:1:4:7:7:7:5:5 (2026-09-10),
 * shrunk to `[carve, sync, unshare, edit]` — and then, on the bench, to
 * something with no race in it at all. SKIPPED: not root-caused, and big
 * enough that it wants the plan open rather than a patch here.
 *
 * A carves `other/`, B adopts it, A unshares it again, everything is delivered
 * and B's absorb has completed (`B mounts: []`). Then A edits the note. A's
 * disk takes the edit. B's never does:
 *
 *     A disk: "[m0]\n# side\n\nanother folder\n"
 *     B disk: "# side\n\nanother folder\n"
 *
 * No partition, no crash, nothing in flight, no review on either side. After
 * an unshare round trip the two devices' copies of a note are simply no longer
 * connected, and every edit from then on is one-sided. Sharing a folder and
 * then stopping sharing it is an ordinary thing to do, and this leaves the
 * vault silently split.
 *
 * Where to look. Both sides rebuild their root session from stores at the end
 * of the absorb (`unshareMount` on the owner, `absorbAdopted`'s `withRootDown`
 * on the peer) and restore the doc from the blob the mount namespace held.
 * Something in that rebuild leaves one side's doc off the room — a provider
 * that is never re-attached for a guid the root did not have when it started,
 * or a doc instance replaced after the subscription was made. Check what
 * `tryDurableReopen` attaches for entries that arrive through `absorbMount`
 * rather than through the folder blob it booted with.
 *
 * The nested fuzz keeps `unshare` off by default (`NESTED_FUZZ_OPEN=1` turns
 * it back on, with the tree renames) so it stops re-reporting this one; the
 * unshare/absorb paths are covered directly in `nested.test.ts`.
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

describe.skip('crasher 0008 — after an unshare round trip, edits stop reaching the peer', () => {
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
