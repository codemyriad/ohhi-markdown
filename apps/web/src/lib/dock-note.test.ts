import { describe, expect, it } from 'vitest'
import { followNote, noteContext, renamedNote, type DockNote } from './dock-note.js'

const all = (): boolean => true
const none = (): boolean => false

describe('followNote', () => {
  it('follows the focused note', () => {
    expect(followNote(null, 'a.md', all)).toEqual({ path: 'a.md', lastFocused: false })
    expect(followNote({ path: 'a.md', lastFocused: true }, 'b.md', all)).toEqual({ path: 'b.md', lastFocused: false })
  })

  it('keeps the last note, flagged, while a non-note has the focus', () => {
    expect(followNote({ path: 'a.md', lastFocused: false }, null, all)).toEqual({ path: 'a.md', lastFocused: true })
  })

  it('forgets a remembered note that is gone, and has nothing before a first note', () => {
    expect(followNote({ path: 'a.md', lastFocused: true }, null, none)).toBeNull()
    expect(followNote(null, null, all)).toBeNull()
  })

  it('returns the same object when nothing changed', () => {
    const focused: DockNote = { path: 'a.md', lastFocused: false }
    const last: DockNote = { path: 'a.md', lastFocused: true }
    expect(followNote(focused, 'a.md', all)).toBe(focused)
    expect(followNote(last, null, all)).toBe(last)
  })
})

describe('renamedNote', () => {
  it('follows a rename of the note or of a folder holding it', () => {
    const note: DockNote = { path: 'Work/a.md', lastFocused: true }
    expect(renamedNote(note, 'Work/a.md', 'Work/b.md')).toEqual({ path: 'Work/b.md', lastFocused: true })
    expect(renamedNote(note, 'Work', 'Jobs')).toEqual({ path: 'Jobs/a.md', lastFocused: true })
    expect(renamedNote(note, 'Workshop', 'X')).toBe(note)
    expect(renamedNote(null, 'a', 'b')).toBeNull()
  })
})

describe('noteContext', () => {
  it('names the note without its extension, its folder beside it', () => {
    expect(noteContext('Competitors/untitled-3.md')).toEqual({ name: 'untitled-3', folder: 'Competitors' })
    expect(noteContext('a/b/Board.base')).toEqual({ name: 'Board', folder: 'a/b' })
    expect(noteContext('top.md')).toEqual({ name: 'top', folder: '' })
  })
})
