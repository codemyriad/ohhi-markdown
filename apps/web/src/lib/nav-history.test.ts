import { describe, expect, it } from 'vitest'
import { NavHistory } from './nav-history.js'

describe('NavHistory', () => {
  it('starts empty and refuses to move', () => {
    const h = new NavHistory()
    expect(h.canGoBack()).toBe(false)
    expect(h.back()).toBeNull()
    expect(h.forward()).toBeNull()
  })

  it('walks back and forward through visited paths', () => {
    const h = new NavHistory()
    h.push('a.md')
    h.push('b.md')
    h.push('c.md')
    expect(h.back()).toBe('b.md')
    expect(h.back()).toBe('a.md')
    expect(h.back()).toBeNull()
    expect(h.forward()).toBe('b.md')
    expect(h.forward()).toBe('c.md')
    expect(h.forward()).toBeNull()
  })

  it('ignores a repeat visit to the current path', () => {
    const h = new NavHistory()
    h.push('a.md')
    h.push('a.md')
    expect(h.canGoBack()).toBe(false)
  })

  it('truncates the forward branch when you navigate after going back', () => {
    const h = new NavHistory()
    h.push('a.md')
    h.push('b.md')
    h.back()
    h.push('c.md')
    expect(h.canGoForward()).toBe(false)
    expect(h.back()).toBe('a.md')
  })

  it('drops entries for paths that no longer exist', () => {
    const h = new NavHistory()
    h.push('a.md')
    h.push('gone.md')
    h.push('c.md')
    h.prune(new Set(['a.md', 'c.md']))
    expect(h.back()).toBe('a.md')
    expect(h.snapshot().entries).toEqual(['a.md', 'c.md'])
  })

  it('repoints a renamed file everywhere it appears', () => {
    const h = new NavHistory()
    h.push('a.md')
    h.push('old.md')
    h.push('c.md')
    h.push('old.md')
    h.rename('old.md', 'new.md')
    expect(h.snapshot().entries).toEqual(['a.md', 'new.md', 'c.md', 'new.md'])
  })

  it('repoints every path under a renamed folder, and nothing else', () => {
    const h = new NavHistory()
    h.push('notes/a.md')
    h.push('notes/deep/b.md')
    h.push('notesy/c.md') // a sibling whose name merely starts the same
    h.push('notes')
    h.rename('notes', 'archive/notes')
    expect(h.snapshot().entries).toEqual([
      'archive/notes/a.md',
      'archive/notes/deep/b.md',
      'notesy/c.md',
      'archive/notes',
    ])
  })

  it('leaves back/forward exactly where it was across a rename', () => {
    const h = new NavHistory()
    h.push('a.md')
    h.push('b.md')
    h.push('c.md')
    h.back() // at b.md
    h.rename('b.md', 'renamed.md')
    expect(h.snapshot().at).toBe(1)
    expect(h.back()).toBe('a.md')
    expect(h.forward()).toBe('renamed.md')
    expect(h.forward()).toBe('c.md')
  })

  it('is a no-op for a path it has never seen', () => {
    const h = new NavHistory()
    h.push('a.md')
    h.rename('other.md', 'moved.md')
    expect(h.snapshot().entries).toEqual(['a.md'])
  })

  it('keeps the cursor on the current path when pruning around it', () => {
    const h = new NavHistory()
    h.push('a.md')
    h.push('b.md')
    h.push('c.md')
    h.back() // at b.md
    h.prune(new Set(['a.md', 'b.md', 'c.md']))
    expect(h.snapshot().at).toBe(1)
    expect(h.forward()).toBe('c.md')
  })
})
