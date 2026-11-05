/**
 * `isScratchName`: the names other tools give files they are still writing
 * or keep beside the real one. Live enrol-on-create skips them; a note with
 * an ordinary name, in any folder, is never one.
 */
import { describe, expect, it } from 'vitest'
import { isScratchName } from '../src/index.js'

describe('isScratchName', () => {
  it.each([
    '.note.md.swp', // vim swap
    'dir/.note.md.swx',
    '.syncthing.note.md.tmp', // Syncthing partial
    'note.md.tmp',
    'note.md.part', // browser / sync-client partials
    'note.md.partial',
    'clip.pdf.crdownload',
    'NOTE.MD.SWP',
    'note.md~', // backup
    '.DS_Store',
    'dir/.hidden.md',
  ])('%s is scratch', (path) => {
    expect(isScratchName(path)).toBe(true)
  })

  it.each([
    'note.md',
    'dir/note.md',
    '.trash/note.md', // a dot folder above is not the file's own name
    'a.part.md',
    'tmp.md',
    'swp/notes.md',
    'picture.png',
  ])('%s is not', (path) => {
    expect(isScratchName(path)).toBe(false)
  })
})
