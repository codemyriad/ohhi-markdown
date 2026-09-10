/**
 * L1 nested fuzz, seed 1146719437 path 27:3:1:3:7:7:2 (2026-09-10), shrunk to
 * `[renameDir(a), renameDir(a), partition(a)]` and then to the three lines
 * below. SKIPPED: the fix is in `libs/vault/src/session.ts`, outside this
 * slice's ownership. No mount is involved at any point — the nested fuzz was
 * simply the harness that had tree renames turned on when crasher 0004 was
 * fixed and they came back.
 *
 * A renames a folder TWICE before anything is delivered, so its peer receives
 * both `renameDir` transactions in one batch: `other/` → `d0/` → `d1/`, one
 * guid throughout, `other/side.md` and `d0/side.md` hard-deleted, `d1/side.md`
 * set. B applies the batch and ends up with the file at the right path and
 * EMPTY:
 *
 *     A disk: d1/side.md = "# side\n\nanother folder\n"
 *     B disk: d1/side.md = ""
 *
 * Both maps agree, both devices show the note, no review is raised on either
 * side — and one of them has lost its content. The intermediate path `d0/` is
 * the whole of it: it exists in neither device's map by the time B looks (the
 * second rename hard-deleted it), so B's remote-change pass reconstructs a
 * move whose source it cannot find and materializes an empty doc at the
 * destination instead of moving the bytes it already has.
 *
 * Same family as crasher 0002 (a remote rename of a path this device has not
 * materialized) but not the same bug: there the source was never written, here
 * it is on disk under the FIRST name. The fix belongs with the remote rename
 * path — reconstruct the move from the guid's last known disk path, not from
 * the map key that vanished — and it is `libs/vault`'s to make.
 *
 * Until then the nested fuzz keeps tree renames off by default
 * (`NESTED_FUZZ_RENAMES=1` turns them on), alongside crasher 0006.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo, dec, diskSnapshot } from '../fixture.js'

describe.skip('crasher 0009 — two dir renames in one batch empty the file on the peer', () => {
  it('leaves both devices holding the same bytes at the same path', async () => {
    const duo = await bootDuo({
      files: { 'keep.md': '# keep\n', 'other/side.md': '# side\n\nanother folder\n' },
    })
    try {
      await duo.deliver()
      await duo.a.root.renamePath('other', 'd0')
      await duo.a.root.renamePath('d0', 'd1')
      await duo.deliver()

      expect(dec.decode((await duo.b.adapter.read('d1/side.md')) ?? new Uint8Array())).toBe(
        '# side\n\nanother folder\n'
      )
      expect(await diskSnapshot(duo.a.adapter)).toEqual(await diskSnapshot(duo.b.adapter))
    } finally {
      duo.dispose()
    }
  })
})
