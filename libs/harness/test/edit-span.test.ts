import { describe, expect, it } from 'vitest'
import { editSpan } from '../src/edit-span.js'

const apply = (before: string, s: NonNullable<ReturnType<typeof editSpan>>): string =>
  before.slice(0, s.from) + s.proposedText + before.slice(s.to)

describe('editSpan', () => {
  it('is null for equal texts', () => {
    expect(editSpan('same', 'same')).toBeNull()
  })

  it('narrows a one-word change to that word', () => {
    const before = '# Editor\n\nFiles are canonical.\n'
    const after = '# Editor\n\nFiles are authoritative.\n'
    const s = editSpan(before, after)!
    expect(s).toMatchObject({ baseText: 'canonical', proposedText: 'authoritative' })
    expect(before.slice(s.from, s.to)).toBe('canonical')
    expect(apply(before, s)).toBe(after)
  })

  it('handles pure insertions and deletions, including at either end', () => {
    for (const [before, after] of [
      ['abc', 'abXc'],
      ['abc', 'ac'],
      ['abc', 'Xabc'],
      ['abc', 'abcX'],
      ['', 'new note\n'],
      ['gone\n', ''],
      ['aaaa', 'aa'],
    ]) {
      const s = editSpan(before, after)!
      expect(apply(before, s)).toBe(after)
      expect(before.slice(s.from, s.to)).toBe(s.baseText)
    }
  })

  it('never splits a surrogate pair', () => {
    const s = editSpan('a😀b', 'a😃b')!
    expect(s.baseText).toBe('😀')
    expect(s.proposedText).toBe('😃')
  })

  it('round-trips every pair from a small alphabet', () => {
    const alphabet = ['', 'a', 'b', 'ab', 'ba', 'aab', 'abba', 'x\ny', '😀']
    for (const before of alphabet) for (const after of alphabet) {
      const s = editSpan(before, after)
      if (before === after) expect(s).toBeNull()
      else expect(apply(before, s!)).toBe(after)
    }
  })
})
