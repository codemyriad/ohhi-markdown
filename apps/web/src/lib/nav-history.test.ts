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
