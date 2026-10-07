import { describe, expect, it } from 'vitest'
import { countChars, countWords } from './words.js'

describe('countChars (round 3, Q4)', () => {
  it('counts code points, not line breaks', () => {
    expect(countChars('hello quiet world')).toBe(17)
    expect(countChars('a\nb\r\nc')).toBe(3)
    expect(countChars('')).toBe(0)
  })
  it('an emoji is one character', () => {
    expect(countChars('hi 👋')).toBe(4)
  })
  it('counts the same text the word count does', () => {
    const text = '# Title\n\nSome words here.'
    expect(countWords(text)).toBe(4)
    expect(countChars(text)).toBe(23)
  })
})
