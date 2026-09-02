/**
 * Adapter-seam guarantees that must hold for EVERY implementation, not just
 * the two that happen to have been edited.
 */
import { describe, expect, it } from 'vitest'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { IGNORED_DIRS } from '../src/types.js'

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
