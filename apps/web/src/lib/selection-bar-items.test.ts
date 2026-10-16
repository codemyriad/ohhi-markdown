import { describe, expect, it } from 'vitest'
import { selectionItems } from './selection-bar-items.js'

describe('the selection handle’s items', () => {
  it('draws what can run now, in order; separators and repeats dropped', () => {
    const can = new Set(['note.comment', 'ai.ask-selection'])
    expect(selectionItems(['note.comment', '|', 'ai.ask-selection', 'note.comment'], (id) => can.has(id))).toEqual([
      'note.comment',
      'ai.ask-selection',
    ])
  })
  it('without a provider, Ask is left out — Comment alone, no stray divider', () => {
    expect(selectionItems(['note.comment', 'ai.ask-selection'], (id) => id === 'note.comment')).toEqual(['note.comment'])
  })
  it('nothing that can run: nothing to draw', () => {
    expect(selectionItems(['ai.ask-selection'], () => false)).toEqual([])
  })
})
