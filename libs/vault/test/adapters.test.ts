/**
 * Adapter-seam guarantees that must hold for EVERY implementation, not just
 * the two that happen to have been edited.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { hashBytes } from '../src/hash.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { NodeVaultAdapter } from '../src/node-adapter.js'
import { IGNORED_DIRS, WriteConflictError, type VaultAdapter } from '../src/types.js'

const enc = new TextEncoder()

describe('IGNORED_DIRS', () => {
  it("hides Editor's own directory, and every other app's, from listings", () => {
    // The guarantee has to be a property of the SEAM. `.editor/themes/x.css`
    // getting enrolled means Editor syncs a stylesheet as a note while
    // rendering itself from it — the same bug in each adapter that forgets.
    for (const dir of ['.git', '.obsidian', '.editor', '.editor-cache', '.trash', 'node_modules']) {
      expect(IGNORED_DIRS.has(dir), `${dir} must be ignored`).toBe(true)
    }
  })

  it('excludes ignored paths from list() and listDirs()', async () => {
    const a = new MemVaultAdapter()
    await a.writeAtomic('note.md', enc.encode('hi'))
    await a.mkdir('real')
    await a.writeAtomic('.editor/themes/mine/theme.css', enc.encode(':root{}'))
    await a.writeAtomic('.obsidian/app.json', enc.encode('{}'))
    await a.writeAtomic('.trash/old.md', enc.encode('gone'))
    expect((await a.list()).map((f) => f.path)).toEqual(['note.md'])
    expect(await a.listDirs()).toEqual(['real'])
  })

  it('still READS an ignored path directly — that is how a vault theme loads', async () => {
    const a = new MemVaultAdapter()
    await a.writeAtomic('.editor/themes/mine/theme.css', enc.encode(':root{}'))
    expect(await a.read('.editor/themes/mine/theme.css')).not.toBeNull()
  })
})

/**
 * The compare-and-swap at the write seam (Spike S11 finding F1).
 *
 * This is a SEAM guarantee, so it is asserted over every adapter a test
 * process can build — the in-memory one and the real filesystem one — from one
 * table. `MemVaultAdapter` is what the L1 fixtures race against;
 * `NodeVaultAdapter` is what `ohhi` and the desktop app actually write with,
 * and the only one where "immediately before the rename" is a real instruction.
 */
describe('writeAtomic compare-and-swap', () => {
  const temps: string[] = []
  afterAll(async () => {
    for (const dir of temps) await rm(dir, { recursive: true, force: true })
  })

  const adapters: [string, () => Promise<VaultAdapter & { root?: string }>][] = [
    ['MemVaultAdapter', async () => new MemVaultAdapter()],
    [
      'NodeVaultAdapter',
      async () => {
        const root = await mkdtemp(join(tmpdir(), 'vault-cas-'))
        temps.push(root)
        return Object.assign(new NodeVaultAdapter(root), { root })
      },
    ],
  ]

  for (const [name, make] of adapters) {
    describe(name, () => {
      it('writes when the hash still matches, and reports the conflict when it does not', async () => {
        const a = await make()
        const before = enc.encode('v1\n')
        await a.writeAtomic('note.md', before)

        // Matching expectation: an ordinary write.
        await a.writeAtomic('note.md', enc.encode('v2\n'), { expectHash: hashBytes(before) })
        expect(await a.read('note.md')).toEqual(enc.encode('v2\n'))

        // Stale expectation (somebody else wrote in between): refused, with
        // both hashes named so the caller can reclassify rather than guess.
        const err = await a
          .writeAtomic('note.md', enc.encode('v3\n'), { expectHash: hashBytes(before) })
          .then(() => null, (e: unknown) => e)
        expect(err).toBeInstanceOf(WriteConflictError)
        expect(err).toMatchObject({
          path: 'note.md',
          expected: hashBytes(before),
          actual: hashBytes(enc.encode('v2\n')),
        })
        // Nothing was written: a refused swap leaves the file exactly as the
        // other writer left it (that is the byte the journal never held).
        expect(await a.read('note.md')).toEqual(enc.encode('v2\n'))
      })

      it("spells 'no file there' as the empty hash, both ways", async () => {
        const a = await make()
        // Creating: `''` is the LcaRecord convention for never-on-disk.
        await a.writeAtomic('fresh.md', enc.encode('new\n'), { expectHash: '' })
        expect(await a.read('fresh.md')).toEqual(enc.encode('new\n'))

        // The same create once the file exists is a conflict, not a clobber.
        await expect(
          a.writeAtomic('fresh.md', enc.encode('again\n'), { expectHash: '' })
        ).rejects.toBeInstanceOf(WriteConflictError)

        // And expecting content where there is none reports `actual: ''`.
        const err = await a
          .writeAtomic('gone.md', enc.encode('x\n'), { expectHash: hashBytes(enc.encode('x\n')) })
          .then(() => null, (e: unknown) => e)
        expect(err).toMatchObject({ actual: '' })
        expect(await a.read('gone.md')).toBeNull()
      })

      it('leaves no temp file behind when the swap loses', async () => {
        const a = await make()
        await a.writeAtomic('note.md', enc.encode('theirs\n'))
        await expect(
          a.writeAtomic('note.md', enc.encode('mine\n'), { expectHash: 'deadbeef' })
        ).rejects.toBeInstanceOf(WriteConflictError)
        // list() hides nothing that is not an ignored dir, and the Node
        // adapter's temp names are filtered out of watch but NOT out of a
        // directory read — so check the directory itself.
        const root = (a as { root?: string }).root
        const names = root ? await readdir(root) : (await a.list()).map((f) => f.path)
        expect(names.filter((n) => n.includes('.editor-tmp-'))).toEqual([])
      })

      it('is unconditional when no expectation is passed', async () => {
        const a = await make()
        await a.writeAtomic('note.md', enc.encode('v1\n'))
        await a.writeAtomic('note.md', enc.encode('v2\n'))
        expect(await a.read('note.md')).toEqual(enc.encode('v2\n'))
      })
    })
  }
})
